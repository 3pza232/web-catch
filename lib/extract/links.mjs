import { TRACKING_PARAMS } from '../constants.mjs';
import { collapse } from '../text.mjs';

const CONTAINER = 'main, article, [role="main"], .content, .post, .article, #content, #main';
const SKIP = /^(#|javascript:|mailto:|tel:|data:)/i;
const CONTEXT_RADIUS = 40;

/**
 * Normalize a link for deduplication: drop the fragment and tracking parameters.
 * @param {string} raw @param {string} baseUrl @returns {string|null}
 */
export function normalizeLink(raw, baseUrl) {
  let url;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  if (!url.searchParams.size) url.search = '';
  return url.href;
}

/**
 * Extract unique links from the main content region.
 * @param {Document} document - parsed page DOM.
 * @param {string} baseUrl - final page URL, used to resolve relative links.
 * @param {number} [limit] - maximum number of links.
 * @returns {Array<{ href: string, text: string, context: string }>}
 */
export function extractLinks(document, baseUrl, limit = 50) {
  if (!document.documentElement) return [];
  const root = document.querySelector(CONTAINER) || document.body;
  if (!root) return [];

  const seen = new Set();
  const links = [];

  for (const anchor of root.querySelectorAll('a[href]')) {
    if (links.length >= limit) break;
    const raw = anchor.getAttribute('href')?.trim();
    if (!raw || SKIP.test(raw)) continue;

    const href = normalizeLink(raw, baseUrl);
    if (!href || seen.has(href)) continue;
    seen.add(href);

    const text = collapse(anchor.textContent);
    links.push({ href, text: text || href, context: contextOf(anchor, text) });
  }
  return links;
}

/**
 * Take a short window of surrounding text so the model knows why a link matters.
 * @param {Element} anchor @param {string} text @returns {string}
 */
function contextOf(anchor, text) {
  const parent = anchor.parentElement;
  if (!parent) return '';
  const full = collapse(parent.textContent);
  const at = text ? full.indexOf(text) : -1;
  if (at === -1) return full.slice(0, CONTEXT_RADIUS * 2);
  const start = Math.max(0, at - CONTEXT_RADIUS);
  const end = Math.min(full.length, at + text.length + CONTEXT_RADIUS);
  return `${start > 0 ? '…' : ''}${full.slice(start, end)}${end < full.length ? '…' : ''}`;
}
