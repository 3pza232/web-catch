import { usageError } from './errors.mjs';

/**
 * Validate an absolute http(s) URL.
 * @param {string} value @returns {URL}
 */
export function assertHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw usageError(`"${value}" is not a valid URL`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw usageError('only http(s) URLs are supported');
  return parsed;
}
