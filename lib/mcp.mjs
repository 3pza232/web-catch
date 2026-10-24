import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  VERSION,
  DEFAULT_MAX_CHARS,
  DEFAULT_LINK_LIMIT,
  DEFAULT_SEARCH_COUNT,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RETRIES,
} from './constants.mjs';
import { fetchPage } from './page.mjs';
import { DeepSeekClient } from './net/deepseek.mjs';
import { outline, truncate } from './text.mjs';
import { toJson } from './io.mjs';
import { usageError } from './errors.mjs';
import { serializePage, serializeSearch } from './serialize.mjs';
import { renderPage, renderOutline, renderOutlineBody, renderLinks, renderSearch } from './render.mjs';

/** Per-page budget when a search result set is fetched. */
const FETCH_TOP_BUDGET = 20_000;

/** Request timeout in seconds, mirroring the CLI `--timeout` flag. */
const timeoutSchema = z.number().positive().max(300).optional()
  .describe(`request timeout in seconds (default ${DEFAULT_TIMEOUT_MS / 1000})`);

/** Retry budget, mirroring the CLI `--retries` flag. */
const retriesSchema = z.number().int().min(0).max(10).optional()
  .describe(`retries for network errors and 408/429/5xx responses (default ${DEFAULT_RETRIES})`);

/**
 * Strict input schemas: unknown parameters (for example a `maxchars` typo) are
 * rejected by the SDK instead of being silently dropped.
 */
const fetchInput = z.object({
  url: z.string().describe('absolute http(s) URL'),
  maxChars: z.number().int().min(200).max(400_000).optional()
    .describe(`output character cap (default ${DEFAULT_MAX_CHARS})`),
  links: z.boolean().optional().describe('include the page link list (default true)'),
  linkLimit: z.number().int().min(1).max(1000).optional()
    .describe(`maximum links in the link list (default ${DEFAULT_LINK_LIMIT})`),
  linksOnly: z.boolean().optional()
    .describe('return only the link list (with the page title in json mode) and skip article extraction; http transport only; cannot be combined with raw or outlineOnly'),
  outlineOnly: z.boolean().optional()
    .describe('return only the heading outline; with json=true the markdown field holds that same outline text plus an outline array; cannot be combined with raw or linksOnly'),
  json: z.boolean().optional().describe('return the structured JSON result instead of Markdown'),
  raw: z.boolean().optional()
    .describe('skip article extraction and return the decoded body text (http transport only); cannot be combined with linksOnly or outlineOnly'),
  via: z.enum(['http', 'api']).optional().describe('transport; api requires DEEPSEEK_API_KEY'),
  apiLang: z.string().optional()
    .describe('keep only this language from the Fetch API response, e.g. en, zh, auto (title language); requires via="api"'),
  unescape: z.boolean().optional()
    .describe('remove rendering-equivalent Markdown punctuation escapes from api content (default true)'),
  cache: z.boolean().optional().describe('revalidate a cached copy when the server allows it (http transport only)'),
  noCache: z.boolean().optional().describe('bypass the cache read while still refreshing the stored copy'),
  timeout: timeoutSchema,
  retries: retriesSchema,
  userAgent: z.string().optional().describe('override the User-Agent (http transport only)'),
  headers: z.array(z.string()).optional()
    .describe('extra request headers as "Name: value" lines, e.g. ["Referer: https://example.com"] (http transport only)'),
  cookieFile: z.string().optional()
    .describe('path to a Netscape-format cookie file for authenticated pages (http transport only)'),
  charset: z.string().optional().describe('force the source charset, e.g. gbk or shift_jis'),
}).strict();

const searchInput = z.object({
  query: z.string().describe('search query; operators are passed through'),
  count: z.number().int().min(1).max(50).optional().describe(`results to request (default ${DEFAULT_SEARCH_COUNT})`),
  needContent: z.boolean().optional().describe('ask the API to include full page content'),
  oriQuestion: z.string().optional().describe('original user question that triggered the search (1-128 chars)'),
  localization: z.string().optional().describe('valid IPv4/IPv6 address used by the upstream to prefer localized results; geolocation is approximate'),
  fetchTop: z.number().int().min(1).max(5).optional().describe('also fetch this many top results'),
  maxChars: z.number().int().min(200).max(400_000).optional()
    .describe(`per-page cap for fetchTop (clamped to ${FETCH_TOP_BUDGET})`),
  json: z.boolean().optional().describe('return the structured JSON payload instead of Markdown'),
  timeout: timeoutSchema,
  retries: retriesSchema,
}).strict();

/**
 * Run the MCP server over stdio.
 *
 * Stdout carries JSON-RPC frames only; diagnostics must go to stderr.
 * @returns {Promise<void>} resolves when the transport closes.
 */
export async function runMcpServer() {
  const server = new McpServer({ name: 'web-catch', version: VERSION });

  server.registerTool('fetch', {
    title: 'Fetch a web page',
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      'Fetch one http(s) page and return clean Markdown with a metadata header. ' +
      'Uses direct HTTP with article extraction by default; pass via="api" to fetch through the DeepSeek Fetch API ' +
      'when a site blocks plain clients. Prefer outlineOnly=true to inspect a large page before reading it fully; ' +
      'linksOnly=true returns just the outgoing link list for reconnaissance; json=true returns the structured result object. ' +
      'headers / cookieFile / userAgent carry auth or anti-bot context on the http transport; ' +
      'timeout (seconds) and retries tune flaky networks. Unknown parameters are rejected by the server (some MCP clients drop them before sending).',
    inputSchema: fetchInput,
  }, async (input) => respond(async () => {
    const noLinks = hasNoLinks(input);
    const page = await fetchPage(input.url, fetchOptions(input, noLinks));
    return renderFetched(page, input, noLinks);
  }));

  server.registerTool('search', {
    title: 'Search the web',
    annotations: { readOnlyHint: true, openWorldHint: true },
    description:
      'Search the web through the DeepSeek Search API and return ranked results with titles, URLs, snippets and summaries. ' +
      'Supports operators such as site:, -site:, "exact phrase", lang:zh, after:2025-01-01. ' +
      'Set fetchTop to also fetch and extract the top results in one call; json=true returns the structured payload. ' +
      'Requires DEEPSEEK_API_KEY. Unknown parameters are rejected by the server (some MCP clients drop them before sending).',
    inputSchema: searchInput,
  }, async ({ query, count, needContent, oriQuestion, localization, fetchTop, maxChars, json, timeout, retries }) => respond(async () => {
    const searchQuery = query.trim();
    if (!searchQuery) throw usageError('a search query is required');
    if ([...searchQuery].length > 128) throw usageError('search query must be at most 128 characters');
    if (oriQuestion !== undefined && ([...oriQuestion.trim()].length < 1 || [...oriQuestion.trim()].length > 128)) {
      throw usageError('oriQuestion must be 1-128 characters');
    }
    const resultCount = count ?? DEFAULT_SEARCH_COUNT;
    const client = new DeepSeekClient({ timeoutMs: toTimeoutMs(timeout), retries });
    const results = await client.search({
      query: searchQuery,
      count: resultCount,
      needContent,
      oriQuestion: oriQuestion?.trim(),
      localization,
    });
    const fetched = fetchTop
      ? await fetchTopPages(results, fetchTop, Math.min(maxChars ?? FETCH_TOP_BUDGET, FETCH_TOP_BUDGET), { timeout, retries })
      : [];
    if (json) return toJson(serializeSearch({ query: searchQuery, count: resultCount, results, fetched }));
    return renderSearch({ query: searchQuery, results }, fetched);
  }));

  await server.connect(new StdioServerTransport());
}

/**
 * Whether the caller asked to omit the link list (linksOnly always keeps it).
 * @param {object} input @returns {boolean}
 */
function hasNoLinks(input) {
  return input.links === false && input.linksOnly !== true;
}

/**
 * Translate MCP fetch input into `fetchPage` options.
 * @param {object} input @param {boolean} noLinks @returns {object}
 */
function fetchOptions(input, noLinks) {
  return {
    maxChars: input.maxChars,
    linkLimit: input.linkLimit,
    noLinks,
    linksOnly: input.linksOnly === true,
    outlineOnly: input.outlineOnly === true,
    raw: input.raw === true,
    via: input.via,
    apiLang: input.apiLang,
    unescape: input.unescape,
    cache: input.cache,
    noCache: input.noCache,
    timeout: input.timeout,
    retries: input.retries,
    userAgent: input.userAgent,
    headers: input.headers,
    cookieFile: input.cookieFile,
    charset: input.charset,
  };
}

/**
 * Format a fetched page the way the matching CLI flags would.
 * @param {object} page @param {object} input - original MCP arguments. @param {boolean} noLinks
 * @returns {string}
 */
function renderFetched(page, input, noLinks) {
  if (input.json) {
    const outlineMarkdown = input.outlineOnly ? renderOutlineBody(outline(page.markdown)) : undefined;
    return toJson(serializePage(page, {
      noLinks,
      outline: input.outlineOnly === true,
      markdown: outlineMarkdown,
    }));
  }
  if (input.linksOnly) return renderLinks(page.links);
  if (input.outlineOnly) return renderOutline(page, outline(page.markdown));
  return renderPage(page, !noLinks);
}

/** @param {number|undefined} seconds @returns {number|undefined} */
function toTimeoutMs(seconds) {
  return seconds === undefined ? undefined : seconds * 1000;
}

/**
 * Run one handler and normalize both success and failure into MCP content.
 * @param {() => Promise<string>} handler
 * @returns {Promise<{ content: Array<{ type: 'text', text: string }>, isError?: boolean }>}
 */
async function respond(handler) {
  try {
    return { content: [{ type: 'text', text: await handler() }] };
  } catch (error) {
    const hint = error?.hint ? `\nhint: ${error.hint}` : '';
    return { content: [{ type: 'text', text: `error: ${error?.message || error}${hint}` }], isError: true };
  }
}

/**
 * Fetch the first N search results, tolerating individual failures.
 * @param {Array<object>} results
 * @param {number} limit
 * @param {number} budget
 * @param {{ timeout?: number, retries?: number }} [options]
 * @returns {Promise<Array<{ url: string, title: string, markdown: string }>>}
 */
async function fetchTopPages(results, limit, budget, options = {}) {
  const targets = results.slice(0, limit);
  const settled = await Promise.allSettled(
    targets.map((item) => fetchPage(item.url, {
      maxChars: budget,
      noLinks: true,
      timeout: options.timeout,
      retries: options.retries,
    })),
  );
  return settled.map((outcome, index) => {
    const url = targets[index].url;
    if (outcome.status === 'fulfilled') {
      const body = truncate(outcome.value.markdown, budget);
      return {
        url,
        title: outcome.value.title || '',
        markdown: outcome.value.truncated ? `${body.text}\n\n(truncated at ${budget} chars)` : body.text,
      };
    }
    return { url, title: '', markdown: `(fetch failed: ${outcome.reason?.message || 'unknown error'})` };
  });
}
