import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Cached bodies above this size are not stored. */
const MAX_CACHE_BYTES = 5 * 1024 * 1024;

const DIR_NAME = 'web-catch';
let resolvedRoot = null;
let resolvedEnv = null;

/**
 * Cache directory. Resolution order: $WEB_CATCH_CACHE, then
 * $XDG_CACHE_HOME/web-catch, ~/.cache/web-cache, the OS temp dir, and the
 * directory containing the executable (the tool's own install/workspace
 * directory). The first writable candidate wins so sandboxed harnesses that
 * only allow writes next to the binary still get a working cache.
 * @returns {string} writable directory, or an empty string when none works.
 */
export function cacheRoot() {
  const env = process.env.WEB_CATCH_CACHE || '';
  if (resolvedRoot !== null && resolvedEnv === env) return resolvedRoot;
  resolvedEnv = env;
  resolvedRoot = '';
  for (const dir of cacheCandidates(env)) {
    if (isWritableDir(dir)) {
      resolvedRoot = dir;
      break;
    }
  }
  return resolvedRoot;
}

/**
 * @param {string} env @returns {string[]} candidate cache directories.
 */
function cacheCandidates(env) {
  const dirs = [];
  if (env) dirs.push(env);
  if (process.env.XDG_CACHE_HOME) dirs.push(join(process.env.XDG_CACHE_HOME, DIR_NAME));
  dirs.push(join(homedir(), '.cache', DIR_NAME));
  dirs.push(join(tmpdir(), `${DIR_NAME}-cache`));
  dirs.push(join(dirname(process.execPath), `.${DIR_NAME}-cache`));
  return [...new Set(dirs)];
}

/**
 * Probe by creating and removing a file, so read-only or missing parents are
 * skipped rather than failing every later cache operation.
 * @param {string} dir @returns {boolean}
 */
function isWritableDir(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.probe-${process.pid}-${Date.now()}`);
    writeFileSync(probe, '');
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
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
  if (meta.etag !== undefined && meta.etag !== ''
    && (typeof meta.etag !== 'string' || /[\r\n]/.test(meta.etag))) return false;
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
  const root = cacheRoot();
  if (!root) return null;
  const base = join(root, keyOf(url, identity));
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
 * @returns {Promise<'stored'|'skipped'|'unavailable'|'failed'>}
 */
export async function writeCache(url, identity = '', meta = {}, bytes = new Uint8Array()) {
  if (!meta.etag && !meta.lastModified) return 'skipped';
  if (bytes.byteLength > MAX_CACHE_BYTES) return 'skipped';
  const root = cacheRoot();
  if (!root) return 'unavailable';
  const base = join(root, keyOf(url, identity));
  try {
    await mkdir(root, { recursive: true });
    await writeFile(`${base}.body`, bytes);
    await writeFile(`${base}.json`, JSON.stringify({ ...meta, storedAt: new Date().toISOString() }));
    return 'stored';
  } catch {
    // A cache write failure must never fail the request.
    return 'failed';
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
