import { readFile } from 'node:fs/promises';
import { CliError, usageError } from '../errors.mjs';
import { EXIT, DEFAULT_TIMEOUT_MS, DEFAULT_RETRIES, DEFAULT_USER_AGENT } from '../constants.mjs';

/** Bodies above this size are rejected instead of buffered. */
const MAX_BODY_BYTES = 20 * 1024 * 1024;

/** Status codes worth retrying. */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/** @param {number} ms @returns {Promise<void>} */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parse a Netscape cookie file into a Cookie header value.
 * @param {string} file @returns {Promise<string>}
 */
export async function readCookieFile(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw usageError(`cannot read cookie file "${file}"`, error.message);
  }
  const pairs = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const fields = trimmed.split('\t');
    if (fields.length >= 7) pairs.push(`${fields[5]}=${fields[6]}`);
  }
  if (!pairs.length) throw usageError(`cookie file "${file}" contains no cookies`);
  return pairs.join('; ');
}

/**
 * Perform a GET request with retries and a hard deadline.
 * Returns non-2xx responses as data so callers can serve cached copies on 304.
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.retries]
 * @param {string} [options.userAgent]
 * @param {string[]} [options.headers] - raw `Name: value` lines.
 * @param {string} [options.cookie] - Cookie header value.
 * @param {Record<string,string>} [options.conditional] - If-None-Match / If-Modified-Since.
 * @returns {Promise<{ status: number, finalUrl: string, contentType: string, bytes: Uint8Array }>}
 */
export async function request(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const headers = {
    'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/pdf,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  if (options.cookie) headers.Cookie = options.cookie;
  Object.assign(headers, parseHeaders(options.headers), options.conditional);

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    try {
      const response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
      if (response.status === 304) {
        return { status: 304, finalUrl: response.url || url, contentType: '', bytes: new Uint8Array() };
      }
      if (!response.ok) {
        if (RETRYABLE.has(response.status) && attempt < retries) {
          lastError = new CliError(`HTTP ${response.status} ${response.statusText}`, {
            code: `HTTP_${response.status}`,
            exit: EXIT.NETWORK,
          });
          const retryAfter = Number(response.headers.get('retry-after'));
          if (Number.isFinite(retryAfter) && retryAfter > 0) await sleep(Math.min(retryAfter * 1000, 5000));
          continue;
        }
        throw new CliError(`HTTP ${response.status} ${response.statusText}`, {
          code: `HTTP_${response.status}`,
          exit: EXIT.NETWORK,
          hint: response.status === 403 ? 'the site may block non-browser clients; retry with --user-agent' : '',
        });
      }
      const bytes = await readBody(response);
      return {
        status: response.status,
        finalUrl: response.url || url,
        contentType: response.headers.get('content-type') || '',
        etag: response.headers.get('etag') || '',
        lastModified: response.headers.get('last-modified') || '',
        bytes,
      };
    } catch (error) {
      lastError = error instanceof CliError ? error : toNetworkError(error, url);
      if (error instanceof CliError) throw error;
      if (attempt >= retries) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/**
 * Buffer a response body while enforcing the size ceiling.
 * @param {Response} response @returns {Promise<Uint8Array>}
 */
async function readBody(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new CliError(`response is larger than ${MAX_BODY_BYTES / 1024 / 1024} MB`, { code: 'BODY_TOO_LARGE' });
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BODY_BYTES) {
    throw new CliError(`response is larger than ${MAX_BODY_BYTES / 1024 / 1024} MB`, { code: 'BODY_TOO_LARGE' });
  }
  return buffer;
}

/**
 * Turn `["A: b"]` into a header object.
 * @param {string[]} [lines] @returns {Record<string,string>}
 */
export function parseHeaders(lines = []) {
  const headers = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon <= 0) throw usageError(`--header expects "Name: value", received "${line}"`);
    headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return headers;
}

/**
 * @param {unknown} error @param {string} url @returns {CliError}
 */
function toNetworkError(error, url) {
  const reason = error?.cause?.code || error?.message || String(error);
  return new CliError(`request failed for ${url}: ${reason}`, {
    code: 'NETWORK',
    exit: EXIT.NETWORK,
    hint: 'check connectivity, or pass --timeout / --retries',
  });
}
