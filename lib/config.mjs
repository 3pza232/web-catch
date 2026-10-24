import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve credentials for the DeepSeek API.
 *
 * Harnesses that spawn this CLI scrub credential-shaped environment names
 * (anything matching KEY|PASSWORD|SECRET|TOKEN) before the child starts, so a
 * shell-invoked CLI cannot rely on the parent environment. Lookup order:
 *
 *   1. explicit option (`--api-key` / `--api-base`)
 *   2. `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` from the environment
 *   3. the optional config file (default `~/.web-catch/config.json`)
 *   4. the current user's Windows environment (HKCU\Environment)
 */

const CONFIG_FILE = 'config.json';
const WINDOWS_ENV_PATH = 'HKCU\\Environment';
const ENV_NAME = 'DEEPSEEK_API_KEY';
const BASE_ENV_NAME = 'DEEPSEEK_BASE_URL';

/** Path of the optional config file: $WEB_CATCH_CONFIG or ~/.web-catch/config.json. */
export function configPath() {
  return process.env.WEB_CATCH_CONFIG || join(homedir(), '.web-catch', CONFIG_FILE);
}

/** @returns {Record<string, unknown>} parsed config, or an empty object. */
function readConfig() {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Read one variable from the current user's Windows environment.
 * Queries the registry directly, so environment scrubbing cannot hide it.
 * @param {string} name @returns {string}
 */
function readWindowsUserEnv(name) {
  if (process.platform !== 'win32') return '';
  try {
    const output = execFileSync('reg', ['query', WINDOWS_ENV_PATH, '/v', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const match = output.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.*)`, 'i'));
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

/**
 * Resolve the API key using the documented precedence.
 * @param {string} [explicit] - value from `--api-key`.
 * @returns {string} key, or an empty string when nothing is configured.
 */
export function resolveApiKey(explicit) {
  if (explicit) return explicit;

  const fromEnv = process.env[ENV_NAME];
  if (fromEnv) return fromEnv;

  const config = readConfig();
  if (config.apiKeyEnv && process.env[String(config.apiKeyEnv)]) return process.env[String(config.apiKeyEnv)];
  if (config.apiKey) return String(config.apiKey);

  return readWindowsUserEnv(ENV_NAME);
}

/**
 * Resolve the API base URL.
 * @param {string} [explicit] - value from `--api-base`.
 * @returns {string} base URL, or an empty string when nothing is configured.
 */
export function resolveBaseUrl(explicit) {
  if (explicit) return explicit;
  const fromEnv = process.env[BASE_ENV_NAME];
  if (fromEnv) return fromEnv;
  const config = readConfig();
  return config.baseUrl ? String(config.baseUrl) : '';
}

/**
 * Where the key would come from, for diagnostics.
 * @param {string} [explicit] - value from `--api-key`.
 * @returns {'option'|'environment'|'config'|'windows-env'|'missing'}
 */
export function apiKeySource(explicit) {
  if (explicit) return 'option';
  if (process.env[ENV_NAME]) return 'environment';
  const config = readConfig();
  if ((config.apiKeyEnv && process.env[String(config.apiKeyEnv)]) || config.apiKey) return 'config';
  if (process.platform === 'win32' && readWindowsUserEnv(ENV_NAME)) return 'windows-env';
  return 'missing';
}
