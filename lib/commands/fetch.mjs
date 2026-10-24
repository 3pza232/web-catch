import { extractPage, fetchPage } from '../page.mjs';
import { outline } from '../text.mjs';
import { renderLinks, renderOutline, renderPage } from '../render.mjs';
import { serializePage } from '../serialize.mjs';
import { emit, toJson } from '../io.mjs';
import { usageError } from '../errors.mjs';
import { DEFAULT_MAX_CHARS, DEFAULT_LINK_LIMIT } from '../constants.mjs';

/**
 * `fetch`: resolve one page into Markdown, an outline, or its link list.
 * @param {string[]} args @param {Record<string, unknown>} options @returns {Promise<void>}
 */
export async function fetchCommand(args, options) {
  const source = resolveSource(args, options);
  const settings = {
    ...options,
    headers: options.header,
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
    linkLimit: DEFAULT_LINK_LIMIT,
  };

  const result = source.stdin
    ? await extractPage(await readStdin(source.url), settings)
    : await fetchPage(source.url, settings);

  const output = options.json
    ? toJson(serializePage(result, {
      noLinks: options.noLinks && !options.linksOnly,
      outline: options.outline,
    }))
    : render(result, options);
  await emit(output, options.output);
}

/**
 * Resolve the fetch target: a positional URL, or `--url` with piped HTML.
 * @param {string[]} args @param {Record<string, unknown>} options
 * @returns {{ url: string, stdin: boolean }}
 */
function resolveSource(args, options) {
  if (options.stdinUrl) {
    assertHttpUrl(options.stdinUrl);
    return { url: options.stdinUrl, stdin: true };
  }
  if (!args[0]) throw usageError('a URL is required', 'usage: web-catch <url> [options]');
  if (args[1]) throw usageError(`unexpected argument "${args[1]}"`);
  assertHttpUrl(args[0]);
  return { url: args[0], stdin: false };
}

/** @param {string} value @returns {void} */
function assertHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw usageError(`"${value}" is not a valid URL`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw usageError('only http(s) URLs are supported');
}

/**
 * Read piped HTML from stdin.
 * @param {string} url @returns {Promise<object>}
 */
async function readStdin(url) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (!chunks.length) throw usageError('stdin is empty', 'pipe HTML into it, or pass a URL');
  return {
    url,
    finalUrl: url,
    status: undefined,
    contentType: 'text/html',
    bytes: new Uint8Array(Buffer.concat(chunks)),
    cached: false,
    transport: 'stdin',
  };
}

/**
 * Render a result for humans.
 * @param {object} result @param {Record<string, unknown>} options @returns {string}
 */
function render(result, options) {
  if (options.linksOnly) return renderLinks(result.links || []);
  if (options.outline) return renderOutline(result, outline(result.markdown));
  return renderPage(result, !options.noLinks);
}
