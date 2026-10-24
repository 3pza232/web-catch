import { outline } from './text.mjs';

/**
 * Project a page result into the stable JSON contract shared by `--json` and
 * the MCP `json: true` option.
 * @param {object} result - page result from lib/page.mjs.
 * @param {object} [options]
 * @param {boolean} [options.noLinks] - drop the link list.
 * @param {boolean} [options.outline] - include the heading outline.
 * @returns {object}
 */
export function serializePage(result, options = {}) {
  return {
    url: result.finalUrl,
    title: result.title || '',
    status: result.status,
    transport: result.transport,
    fetchedAt: result.fetchedAt,
    cached: result.cached,
    extracted: result.extracted,
    extractedReason: result.reason || undefined,
    chars: result.chars,
    words: result.words,
    truncated: result.truncated,
    limit: result.limit,
    pages: result.pages,
    markdown: result.markdown,
    links: options.noLinks ? [] : result.links || [],
    outline: options.outline ? outline(result.markdown) : undefined,
  };
}

/**
 * Project a search payload into the stable JSON contract.
 * @param {{ query: string, count: number, results: Array<object>, fetched: Array<object> }} payload
 * @returns {object}
 */
export function serializeSearch({ query, count, results, fetched }) {
  return { query, count, results, fetched };
}
