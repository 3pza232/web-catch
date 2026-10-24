import { usageError } from '../errors.mjs';

/** Flag specifications: value type, optional long aliases and enum values. */
const FLAGS = {
  'no-links': { type: 'bool' },
  'links-only': { type: 'bool' },
  outline: { type: 'bool' },
  raw: { type: 'bool' },
  json: { type: 'bool' },
  cache: { type: 'bool' },
  'no-cache': { type: 'bool' },
  'need-content': { type: 'bool' },
  'max-chars': { type: 'int' },
  output: { type: 'string', short: 'o' },
  timeout: { type: 'number' },
  retries: { type: 'int' },
  'user-agent': { type: 'string' },
  header: { type: 'string', repeat: true },
  'cookie-file': { type: 'string' },
  charset: { type: 'string' },
  via: { type: 'string', values: ['http', 'api'] },
  count: { type: 'int' },
  'fetch-top': { type: 'int' },
  url: { type: 'string', key: 'stdinUrl' },
  'api-key': { type: 'string' },
  'api-base': { type: 'string' },
  help: { type: 'bool', short: 'h' },
  version: { type: 'bool', short: 'v' },
  mcp: { type: 'bool' },
};

/** kebab-case flag name to camelCase option key. */
const camel = (name) => name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

for (const [name, spec] of Object.entries(FLAGS)) spec.key ??= camel(name);

const BY_SHORT = new Map(
  Object.entries(FLAGS).filter(([, spec]) => spec.short).map(([name, spec]) => [spec.short, name]),
);

/**
 * Read one flag value with validation.
 * @param {string} name - canonical flag name.
 * @param {object} spec - flag specification.
 * @param {string} raw - raw string from argv.
 * @returns {string|number} coerced value.
 */
function coerce(name, spec, raw) {
  if (spec.type === 'int' || spec.type === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw usageError(`--${name} expects a positive number, received "${raw}"`);
    }
    return spec.type === 'int' ? Math.trunc(value) : value;
  }
  if (spec.values && !spec.values.includes(raw)) {
    throw usageError(`--${name} accepts: ${spec.values.join(' | ')}`);
  }
  return raw;
}

/**
 * Parse argv into a command, positional arguments and typed options.
 * Supports `--flag value`, `--flag=value`, short forms `-h -v -o` and `--`.
 * @param {string[]} argv - arguments after the executable.
 * @returns {{ command: 'fetch'|'search', args: string[], options: Record<string, unknown> }}
 */
export function parseArgs(argv) {
  const options = {};
  const positionals = [];
  let command = '';

  for (let index = 0; index < argv.length; index++) {
    let token = argv[index];

    if (token === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (token.startsWith('-') && token !== '-') {
      if (!token.startsWith('--')) {
        const name = BY_SHORT.get(token.slice(1));
        if (!name) throw usageError(`unknown option "${token}"`);
        token = `--${name}`;
      }
      const body = token.slice(2);
      const eq = body.indexOf('=');
      const name = eq === -1 ? body : body.slice(0, eq);
      const spec = FLAGS[name];
      if (!spec) throw usageError(`unknown option "--${name}"`);

      if (spec.type === 'bool') {
        if (eq !== -1) throw usageError(`--${name} does not take a value`);
        options[spec.key] = true;
        continue;
      }

      const raw = eq === -1 ? argv[++index] : body.slice(eq + 1);
      if (raw === undefined) throw usageError(`--${name} needs a value`);
      const value = coerce(name, spec, raw);
      if (spec.repeat) (options[spec.key] ??= []).push(value);
      else options[spec.key] = value;
      continue;
    }

    if (!command && (token === 'fetch' || token === 'search')) {
      command = token;
      continue;
    }
    positionals.push(token);
  }

  return { command: command || 'fetch', args: positionals, options };
}
