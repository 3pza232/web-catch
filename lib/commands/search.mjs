import { DeepSeekClient } from '../net/deepseek.mjs';
import { fetchPage } from '../page.mjs';
import { emit, toJson } from '../io.mjs';
import { renderSearch } from '../render.mjs';
import { truncate } from '../text.mjs';
import { serializeSearch } from '../serialize.mjs';
import { usageError } from '../errors.mjs';
import { DEFAULT_SEARCH_COUNT, DEFAULT_MAX_CHARS } from '../constants.mjs';

const MAX_COUNT = 50;
const CONCURRENCY = 3;
const FETCH_BUDGET = 20_000;

/**
 * `search`: query the DeepSeek Search API, optionally fetching the top results.
 * @param {string[]} args @param {Record<string, unknown>} options @returns {Promise<void>}
 */
export async function searchCommand(args, options) {
  const query = args.join(' ').trim();
  if (!query) throw usageError('a search query is required', 'usage: web-catch search "<query>"');
  if ([...query].length > 128) throw usageError('search query must be at most 128 characters');
  if (options.oriQuestion !== undefined
    && ([...options.oriQuestion.trim()].length < 1 || [...options.oriQuestion.trim()].length > 128)) {
    throw usageError('--ori-question must be 1-128 characters');
  }

  const count = options.count ?? DEFAULT_SEARCH_COUNT;
  if (count > MAX_COUNT) throw usageError(`--count accepts 1-${MAX_COUNT}`);

  const client = new DeepSeekClient({
    apiKey: options.apiKey,
    apiBase: options.apiBase,
    timeoutMs: options.timeout ? options.timeout * 1000 : undefined,
    retries: options.retries,
  });

  const results = await client.search({
    query,
    count,
    needContent: options.needContent,
    oriQuestion: options.oriQuestion?.trim(),
    localization: options.localization,
  });
  const fetched = options.fetchTop ? await fetchTop(results, options.fetchTop, options) : [];

  const output = options.json
    ? toJson(serializeSearch({ query, count, results, fetched }))
    : renderSearch({ query, results }, fetched);
  await emit(output, options.output);
}

/**
 * Fetch and extract the first N results, keeping output bounded.
 * @param {Array<object>} results
 * @param {number} limit
 * @param {Record<string, unknown>} options
 * @returns {Promise<Array<{ url: string, title: string, markdown: string }>>}
 */
async function fetchTop(results, limit, options) {
  const targets = results.slice(0, Math.max(1, limit));
  const pages = [];

  for (let index = 0; index < targets.length; index += CONCURRENCY) {
    const batch = targets.slice(index, index + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((item) => extractOne(item.url, options)));
    for (const [offset, outcome] of settled.entries()) {
      const url = batch[offset].url;
      if (outcome.status === 'fulfilled') pages.push({ url, ...outcome.value });
      else pages.push({ url, title: '', markdown: `(fetch failed: ${outcome.reason?.message || 'unknown error'})` });
    }
  }
  return pages;
}

/**
 * Fetch and extract one URL for the `--fetch-top` list.
 * @param {string} url @param {Record<string, unknown>} options
 * @returns {Promise<{ title: string, markdown: string }>}
 */
async function extractOne(url, options) {
  const limit = Math.min(options.maxChars ?? DEFAULT_MAX_CHARS, FETCH_BUDGET);
  const page = await fetchPage(url, {
    timeoutMs: options.timeout ? options.timeout * 1000 : undefined,
    retries: options.retries,
    maxChars: limit,
  });
  const body = truncate(page.markdown, FETCH_BUDGET);
  return {
    title: page.title,
    markdown: page.truncated ? `${body.text}\n\n(truncated at ${limit} chars)` : body.text,
  };
}
