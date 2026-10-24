/**
 * Charset detection and decoding.
 * Order: explicit override, BOM, Content-Type header, <meta charset>, utf-8.
 */

const BOM = [
  { bytes: [0xef, 0xbb, 0xbf], charset: 'utf-8' },
  { bytes: [0xff, 0xfe, 0x00, 0x00], charset: 'utf-32le' },
  { bytes: [0x00, 0x00, 0xfe, 0xff], charset: 'utf-32be' },
  { bytes: [0xff, 0xfe], charset: 'utf-16le' },
  { bytes: [0xfe, 0xff], charset: 'utf-16be' },
];

/** Map legacy or vendor labels onto WHATWG decoder labels. */
const ALIASES = {
  gb2312: 'gb18030',
  gbk: 'gb18030',
  'x-gbk': 'gb18030',
  'gb_2312-80': 'gb18030',
  big5: 'big5',
  utf8: 'utf-8',
  'utf-8': 'utf-8',
  latin1: 'windows-1252',
  'iso-8859-1': 'windows-1252',
  ascii: 'utf-8',
  'us-ascii': 'utf-8',
};

/** @param {string} label @returns {string} normalized decoder label. */
export function normalizeCharset(label) {
  const key = String(label || '').trim().toLowerCase();
  return ALIASES[key] || key || 'utf-8';
}

/** @param {Uint8Array} bytes @returns {string|null} charset implied by a BOM. */
function detectBom(bytes) {
  for (const { bytes: prefix, charset } of BOM) {
    if (prefix.every((byte, index) => bytes[index] === byte)) return charset;
  }
  return null;
}

/** @param {string} source - HTML head decoded as latin1. @returns {string|null} */
function detectMeta(source) {
  const meta = source.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i) ||
    source.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([\w.:-]+)/i);
  return meta ? normalizeCharset(meta[1]) : null;
}

/**
 * Resolve the charset for a response body.
 * @param {Uint8Array} bytes - raw body.
 * @param {string} contentType - response Content-Type header.
 * @param {string} [override] - explicit charset from the caller.
 * @returns {string} decoder label.
 */
export function detectCharset(bytes, contentType = '', override) {
  if (override) return normalizeCharset(override);
  const bom = detectBom(bytes);
  if (bom) return bom;

  const header = contentType.match(/charset\s*=\s*["']?([\w.:-]+)/i);
  if (header) return normalizeCharset(header[1]);

  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  return detectMeta(head) || 'utf-8';
}

/**
 * Decode bytes with a fallback chain that never throws.
 * @param {Uint8Array} bytes @param {string} charset @returns {string}
 */
export function decodeBytes(bytes, charset) {
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}
