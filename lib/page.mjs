import { readCookieFile, request } from './net/http.mjs';
import { detectCharset, decodeBytes, normalizeCharset } from './net/decode.mjs';
import { DeepSeekClient } from './net/deepseek.mjs';
import { extractArticle } from './extract/article.mjs';
import { createDom } from './extract/dom.mjs';
import { extractLinks } from './extract/links.mjs';
import { extractPdf } from './extract/pdf.mjs';
import { conditionalHeaders, readCache, writeCache } from './cache.mjs';
import { measure } from './text.mjs';
import { truncate } from './render.mjs';
import { CliError, usageError } from './errors.mjs';
import { assertHttpUrl } from './url.mjs';
import { EXIT, HTML_TYPES, PASSTHROUGH_TYPES, PDF_TYPE, DEFAULT_MAX_CHARS, DEFAULT_LINK_LIMIT } from './constants.mjs';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

/**
 * Fetch one URL and reduce it to the page result contract.
 * @param {string} url
 * @param {object} [options] - timeout, timeoutMs, retries, userAgent, headers, cookieFile, cache, noCache,
 *   charset, maxChars, noLinks, linksOnly, outlineOnly, raw, via, apiKey, apiBase.
 * @returns {Promise<object>} page result consumed by renderers.
 */
export async function fetchPage(url, options = {}) {
  assertHttpUrl(url);
  const settings = normalize(options);
  assertFetchModes(settings);
  if (settings.via === 'api' && settings.linksOnly) {
    throw usageError('link extraction is not available over the API transport',
      'links come from the HTML body; use via="http" (the default) for linksOnly');
  }
  const page = settings.via === 'api' ? null : await download(url, settings);
  if (!page) return fromApi(url, settings);
  return extractPage(page, settings);
}

/**
 * Reject fetch output modes that contradict each other instead of silently
 * picking a winner and discarding the other mode's data.
 * @param {{ raw?: boolean, linksOnly?: boolean, outlineOnly?: boolean }} [options]
 * @returns {void}
 */
export function assertFetchModes(options = {}) {
  if (options.raw && options.linksOnly) {
    throw usageError('raw and linksOnly cannot be combined',
      'raw returns the decoded body; linksOnly returns the link list');
  }
  if (options.raw && options.outlineOnly) {
    throw usageError('raw and outlineOnly cannot be combined',
      'raw returns the decoded body; outlineOnly returns the heading outline of extracted text');
  }
  if (options.linksOnly && options.outlineOnly) {
    throw usageError('linksOnly and outlineOnly cannot be combined',
      'choose one output mode per request');
  }
}

/**
 * Reduce an already-downloaded page to the page result contract.
 * @param {{ url: string, finalUrl: string, status?: number, contentType: string, bytes: Uint8Array,
 *   transport: string, cached?: boolean }} page
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function extractPage(page, options = {}) {
  const settings = normalize(options);
  assertFetchModes(settings);
  const base = {
    url: page.url,
    finalUrl: page.finalUrl || page.url,
    status: page.status,
    transport: page.transport,
    cached: Boolean(page.cached),
    fetchedAt: timestamp(),
    links: [],
    extracted: true,
    reason: '',
  };

  const kind = classify(page.contentType, page.bytes);
  const charset = detectCharset(page.bytes, page.contentType, settings.charset);
  const text = decodeBytes(page.bytes, charset);

  if (settings.linksOnly && kind !== 'html') {
    throw new CliError('link extraction is only available for HTML bodies', {
      code: 'LINKS_UNAVAILABLE',
      exit: EXIT.EXTRACT,
      hint: `received "${page.contentType || kind}"; use raw output to inspect this body instead`,
    });
  }

  if (settings.raw || kind === 'text') return fromPlainText(base, text, settings);
  if (kind === 'pdf') return fromPdf(base, page.bytes, settings);
  if (kind === 'html') return fromHtml(base, text, page.finalUrl || page.url, settings);

  throw new CliError(`unsupported content type "${page.contentType || 'unknown'}"`, {
    code: 'UNSUPPORTED_CONTENT_TYPE',
    exit: EXIT.EXTRACT,
    hint: 'retry with raw output to dump the decoded text',
  });
}

/**
 * Fill defaults for the page-level options.
 * @param {object} options @returns {object}
 */
function normalize(options) {
  if (options.charset) validateCharset(options.charset);
  return {
    ...options,
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
    linkLimit: options.linkLimit ?? DEFAULT_LINK_LIMIT,
  };
}

/**
 * An explicitly requested charset must be a real decoder label; silently
 * decoding with UTF-8 instead would hide a typo.
 * @param {string} charset @returns {void}
 */
function validateCharset(charset) {
  try {
    new TextDecoder(normalizeCharset(charset));
  } catch {
    throw usageError(`unknown charset "${charset}"`,
      'pass a WHATWG label such as utf-8, gbk, big5 or shift_jis');
  }
}

/**
 * Download a URL over HTTP, revalidating a cached copy when asked.
 * @param {string} url @param {object} options @returns {Promise<object>}
 */
async function download(url, options) {
  const cookie = options.cookieFile ? await readCookieFile(options.cookieFile, url) : '';
  const identity = cacheIdentity(cookie, options);
  const cacheEnabled = Boolean(options.cache || options.noCache);
  const cached = cacheEnabled && !options.noCache ? await readCache(url, identity) : null;

  const response = await request(url, {
    timeoutMs: options.timeout ? options.timeout * 1000 : options.timeoutMs,
    retries: options.retries,
    userAgent: options.userAgent,
    headers: options.headers,
    cookie,
    conditional: conditionalHeaders(cached),
  });

  if (response.status === 304 && cached) {
    return { ...cached, url, status: 200, transport: 'http', cached: true };
  }
  if (response.status === 304) {
    throw new CliError('server returned 304 Not Modified but no cached copy is available', {
      code: 'HTTP_304',
      exit: EXIT.NETWORK,
      hint: 'enable cache for this request, or drop the conditional If-None-Match header',
    });
  }
  if (cacheEnabled && response.status === 200) {
    await writeCache(url, identity, {
      etag: response.etag,
      lastModified: response.lastModified,
      contentType: response.contentType,
      finalUrl: response.finalUrl,
    }, response.bytes);
  }
  return { ...response, url, transport: 'http', cached: false };
}

/**
 * Stable fingerprint of the request context that can change the response body.
 * @param {string} cookie @param {object} options @returns {string}
 */
function cacheIdentity(cookie, options) {
  return [
    `ua:${options.userAgent || ''}`,
    `charset:${options.charset || ''}`,
    `cookie:${cookie}`,
    ...(options.headers || []).map((line) => `header:${line}`),
  ].join('\n');
}

/** @returns {string} UTC timestamp with an explicit Z suffix. */
function timestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Classify a body as html, pdf, text or unknown, falling back to magic bytes.
 * Content-Type parameters (e.g. charset) are stripped before matching.
 * @param {string} contentType @param {Uint8Array} bytes @returns {'html'|'pdf'|'text'|'unknown'}
 */
function classify(contentType, bytes) {
  const mime = String(contentType || '').split(';')[0].trim();
  if (PDF_TYPE.test(mime)) return 'pdf';
  if (HTML_TYPES.test(mime)) return 'html';
  if (PASSTHROUGH_TYPES.test(mime)) return 'text';
  if (PDF_MAGIC.every((byte, index) => bytes[index] === byte)) return 'pdf';
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
    .replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || /<html[\s>]/.test(head)) return 'html';
  return 'unknown';
}

/**
 * Build a result for HTML input: article markdown plus links.
 * @param {object} base @param {string} html @param {string} url @param {object} options
 * @returns {object}
 */
function fromHtml(base, html, url, options) {
  const { document } = createDom(html, url);
  const links = options.noLinks && !options.linksOnly ? [] : extractLinks(document, url, options.linkLimit);

  if (options.linksOnly) {
    return { ...base, title: '', markdown: '', links, stats: measure(''), chars: 0, words: 0,
      truncated: false, limit: options.maxChars };
  }

  const article = extractArticle(html, url);
  if (!article.markdown) {
    throw new CliError('no extractable content', {
      code: 'EXTRACT_EMPTY',
      exit: EXIT.EXTRACT,
      hint: 'retry with raw output, or use the api transport',
    });
  }

  const body = truncate(article.markdown, options.maxChars);
  return {
    ...base,
    title: article.title,
    markdown: body.text,
    stats: article.stats,
    chars: article.stats.chars,
    words: article.stats.words,
    truncated: body.truncated,
    limit: options.maxChars,
    links,
    extracted: article.extracted,
    reason: article.reason || '',
  };
}

/**
 * Build a result for non-markup bodies (JSON, text, XML, …).
 * @param {object} base @param {string} text @param {object} options @returns {object}
 */
function fromPlainText(base, text, options) {
  const body = truncate(text, options.maxChars);
  const stats = measure(text);
  return { ...base, title: '', markdown: body.text, stats, chars: stats.chars, words: stats.words,
    truncated: body.truncated, limit: options.maxChars };
}

/**
 * Build a result for PDF bodies.
 * @param {object} base @param {Uint8Array} bytes @param {object} options @returns {Promise<object>}
 */
async function fromPdf(base, bytes, options) {
  let extracted;
  try {
    extracted = await extractPdf(bytes);
  } catch (error) {
    throw new CliError(`cannot extract PDF text: ${error?.message || error}`, {
      code: 'EXTRACT_PDF',
      exit: EXIT.EXTRACT,
      hint: 'the PDF may be corrupt or encrypted; retry with raw output to inspect it',
    });
  }
  const { text, pages } = extracted;
  const body = truncate(text, options.maxChars);
  const stats = measure(text);
  return { ...base, title: '', markdown: body.text, stats, chars: stats.chars, words: stats.words,
    truncated: body.truncated, limit: options.maxChars, pages };
}

/**
 * Build a result from the DeepSeek Fetch API.
 * @param {string} url @param {object} options @returns {Promise<object>}
 */
async function fromApi(url, options) {
  const client = new DeepSeekClient({
    apiKey: options.apiKey,
    apiBase: options.apiBase,
    timeoutMs: options.timeout ? options.timeout * 1000 : options.timeoutMs,
    retries: options.retries,
  });
  const page = await client.fetchPage(url);
  if (!page.content) throw new CliError('upstream returned no page content', { code: 'EXTRACT_EMPTY', exit: EXIT.EXTRACT });

  const body = truncate(page.content, options.maxChars);
  const stats = measure(page.content);
  return {
    url,
    finalUrl: url,
    status: undefined,
    transport: 'api',
    cached: false,
    fetchedAt: timestamp(),
    title: page.title,
    markdown: body.text,
    stats,
    chars: stats.chars,
    words: stats.words,
    truncated: body.truncated,
    limit: options.maxChars,
    links: [],
    extracted: true,
    reason: '',
  };
}
