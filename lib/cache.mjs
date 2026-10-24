import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Cached bodies above this size are not stored. */
const MAX_CACHE_BYTES = 5 * 1024 * 1024;

/**
 * Cache directory: $WEB_CATCH_CACHE or ~/.cache/web-catch.
 * @returns {string}
 */
export function cacheRoot() {
  return process.env.WEB_CATCH_CACHE || join(homedir(), '.cache', 'web-catch');
}

/** @param {string} url @returns {string} stable key for a URL. */
const keyOf = (url) => createHash('sha1').update(url).digest('hex');

/**
 * Read a cached response, if any.
 * @param {string} url
 * @returns {Promise<null | { etag: string, lastModified: string, contentType: string, finalUrl: string, bytes: Uint8Array }>}
 */
export async function readCache(url) {
  const base = join(cacheRoot(), keyOf(url));
  try {
    const meta = JSON.parse(await readFile(`${base}.json`, 'utf8'));
    const bytes = new Uint8Array(await readFile(`${base}.body`));
    return { ...meta, bytes };
  } catch {
    return null;
  }
}

/**
 * Store a 200 response for conditional revalidation.
 * @param {string} url
 * @param {{ etag?: string, lastModified?: string, contentType?: string, finalUrl?: string }} meta
 * @param {Uint8Array} bytes
 * @returns {Promise<void>}
 */
export async function writeCache(url, meta, bytes) {
  if (!meta.etag && !meta.lastModified) return;
  if (bytes.byteLength > MAX_CACHE_BYTES) return;
  const base = join(cacheRoot(), keyOf(url));
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
