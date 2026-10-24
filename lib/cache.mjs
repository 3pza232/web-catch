import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Cached bodies above this size are not stored. */
const MAX_CACHE_BYTES = 5 * 1024 * 1024;

const DIR_NAME = 'web-catch';
let resolvedRoot = null;
let resolvedEnv = null;

/**
 * Cache directory. An explicit $WEB_CATCH_CACHE is authoritative: if it is not
 * writable, caching stays off and the caller reports it instead of silently
 * writing somewhere else. Otherwise the first writable of
 * $XDG_CACHE_HOME/web-cache, ~/.cache/web-cache, %LOCALAPPDATA%/web-cache,
 * the OS temp dir, and the executable's directory wins.
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
  if (env) return [env];
  const dirs = [];
  if (process.env.XDG_CACHE_HOME) dirs.push(join(process.env.XDG_CACHE_HOME, DIR_NAME));
  dirs.push(join(homedir(), '.cache', DIR_NAME));
  if (process.env.LOCALAPPDATA) dirs.push(join(process.env.LOCALAPPDATA, DIR_NAME, 'cache'));
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
  if (meta.size !== undefined && (typeof meta.size !== 'number' || !Number.isFinite(meta.size))) return false;
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
    if (meta.size !== undefined && meta.size !== bytes.byteLength) return null;
    return { ...meta, bytes };
  } catch {
    return null;
  }
}

/**
 * Store a 200 response for conditional revalidation. The body is renamed into
 * place before the metadata, and the metadata records its size, so a crash or
 * a concurrent reader never pairs a new body with stale headers.
 * @param {string} url
 * @param {string} [identity] - cookies/custom headers fingerprint.
 * @param {{ etag?: string, lastModified?: string, contentType?: string, finalUrl?: string }} meta
 * @param {Uint8Array} bytes
 * @returns {Promise<'stored'|'skipped'|'too-large'|'unavailable'|'failed'>}
 */
export async function writeCache(url, identity = '', meta = {}, bytes = new Uint8Array()) {
  if (!meta.etag && !meta.lastModified) return 'skipped';
  if (bytes.byteLength > MAX_CACHE_BYTES) return 'too-large';
  const root = cacheRoot();
  if (!root) return 'unavailable';
  const base = join(root, keyOf(url, identity));
  const suffix = `${process.pid}-${Date.now()}`;
  try {
    await mkdir(root, { recursive: true });
    await writeFile(`${base}.${suffix}.body.tmp`, bytes);
    await rename(`${base}.${suffix}.body.tmp`, `${base}.body`);
    await writeFile(`${base}.${suffix}.json.tmp`, JSON.stringify({
      ...meta,
      size: bytes.byteLength,
      storedAt: new Date().toISOString(),
    }));
    await rename(`${base}.${suffix}.json.tmp`, `${base}.json`);
    return 'stored';
  } catch {
    // A cache write failure must never fail the request.
    await Promise.allSettled([
      unlink(`${base}.${suffix}.body.tmp`),
      unlink(`${base}.${suffix}.json.tmp`),
    ]);
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
