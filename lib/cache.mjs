import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Cached bodies above this size are not stored. */
const MAX_CACHE_BYTES = 5 * 1024 * 1024;

/** Valid ETag value (entity-tag, optionally weak). */
const ETAG = /^(W\/)?"[\x21-\x7e]*"$/;

/**
 * Cache directory: $WEB_CATCH_CACHE or ~/.cache/web-catch.
 * @returns {string}
 */
export function cacheRoot() {
  return process.env.WEB_CATCH_CACHE || join(homedir(), '.cache', 'web-catch');
}

/**
 * Stable cache key for a URL plus the request identity (cookies and custom
 * headers), so an authenticated cached body is never reused for another
 * credential context.
 * @param {string} url @param {string} [identity] @returns {string}
 */
export const keyOf = (url, identity = '') =>
  createHash('sha256').update(identity ? `${url}\u0000${identity}` : url).digest('hex');

/**
 * Whether stored metadata is safe to use for conditional requests.
 * @param {object} meta @returns {boolean}
 */
function validMeta(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (!meta.etag && !meta.lastModified) return false;
  if (meta.etag !== undefined && meta.etag !== '' && (typeof meta.etag !== 'string' || !ETAG.test(meta.etag))) return false;
  if (meta.lastModified !== undefined && meta.lastModified !== ''
    && (typeof meta.lastModified !== 'string' || Number.isNaN(Date.parse(meta.lastModified)))) return false;
  if (meta.finalUrl !== undefined && typeof meta.finalUrl !== 'string') return false;
  if (meta.contentType !== undefined && typeof meta.contentType !== 'string') return false;
  return true;
}

/**
 * Read a cached response, if any.
 * @param {string} url @param {string} [identity] - cookies/custom headers fingerprint.
 * @returns {Promise<null | { etag: string, lastModified: string, contentType: string, finalUrl: string, bytes: Uint8Array }>}
 */
export async function readCache(url, identity = '') {
  const base = join(cacheRoot(), keyOf(url, identity));
  try {
    const meta = JSON.parse(await readFile(`${base}.json`, 'utf8'));
    if (!validMeta(meta)) return null;
    const bytes = new Uint8Array(await readFile(`${base}.body`));
    return { ...meta, bytes };
  } catch {
    return null;
  }
}

/**
 * Store a 200 response for conditional revalidation.
 * @param {string} url
 * @param {string} [identity] - cookies/custom headers fingerprint.
 * @param {{ etag?: string, lastModified?: string, contentType?: string, finalUrl?: string }} meta
 * @param {Uint8Array} bytes
 * @returns {Promise<void>}
 */
export async function writeCache(url, identity = '', meta = {}, bytes = new Uint8Array()) {
  if (!meta.etag && !meta.lastModified) return;
  if (bytes.byteLength > MAX_CACHE_BYTES) return;
  const base = join(cacheRoot(), keyOf(url, identity));
  try {
    await mkdir(cacheRoot(), { recursive: true });
    await writeFile(`${base}.body`, bytes);
    await writeFile(`${base}.json`, JSON.stringify({ ...meta, storedAt: new Date().toISOString() }));
  } catch {
    // A cache write failure must never fail the request.
  }
}

/**
 * Build conditional request headers from a cache entry.
 * @param {{ etag?: string, lastModified?: string }|null} entry
 * @returns {Record<string,string>}
 */
export function conditionalHeaders(entry) {
  const headers = {};
  if (entry?.etag) headers['If-None-Match'] = entry.etag;
  if (entry?.lastModified) headers['If-Modified-Since'] = entry.lastModified;
  return headers;
}
