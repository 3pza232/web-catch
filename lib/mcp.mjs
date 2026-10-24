import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { VERSION, DEFAULT_MAX_CHARS, DEFAULT_SEARCH_COUNT } from './constants.mjs';
import { fetchPage } from './page.mjs';
import { DeepSeekClient } from './net/deepseek.mjs';
import { outline } from './text.mjs';
import { renderPage, renderOutline, renderSearch, truncate } from './render.mjs';

/** Per-page budget when a search result set is fetched. */
const FETCH_TOP_BUDGET = 20_000;

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
    description:
      'Fetch one http(s) page and return clean Markdown with a metadata header. ' +
      'Uses direct HTTP with article extraction by default; pass via="api" to fetch through the DeepSeek Fetch API ' +
      'when a site blocks plain clients. Prefer outlineOnly=true to inspect a large page before reading it fully.',
    inputSchema: {
      url: z.string().describe('absolute http(s) URL'),
      maxChars: z.number().int().min(200).max(400_000).optional()
        .describe(`output character cap (default ${DEFAULT_MAX_CHARS})`),
      links: z.boolean().optional().describe('include the page link list (default true)'),
      outlineOnly: z.boolean().optional().describe('return only the heading outline'),
      via: z.enum(['http', 'api']).optional().describe('transport; api requires DEEPSEEK_API_KEY'),
      cache: z.boolean().optional().describe('revalidate a cached copy when the server allows it'),
    },
  }, async ({ url, maxChars, links, outlineOnly, via, cache }) => respond(async () => {
    const page = await fetchPage(url, { maxChars, noLinks: links === false, via, cache });
    return outlineOnly ? renderOutline(page, outline(page.markdown)) : renderPage(page, links !== false);
  }));

  server.registerTool('search', {
    title: 'Search the web',
    description:
      'Search the web through the DeepSeek Search API and return ranked results with titles, URLs, snippets and summaries. ' +
      'Supports operators such as site:, -site:, "exact phrase", lang:zh, after:2025-01-01. ' +
      'Set fetchTop to also fetch and extract the top results in one call. Requires DEEPSEEK_API_KEY.',
    inputSchema: {
      query: z.string().describe('search query; operators are passed through'),
      count: z.number().int().min(1).max(50).optional().describe(`results to request (default ${DEFAULT_SEARCH_COUNT})`),
      needContent: z.boolean().optional().describe('ask the API to include full page content'),
      fetchTop: z.number().int().min(1).max(5).optional().describe('also fetch this many top results'),
      maxChars: z.number().int().min(200).max(400_000).optional().describe('per-page cap for fetchTop'),
    },
  }, async ({ query, count, needContent, fetchTop, maxChars }) => respond(async () => {
    const client = new DeepSeekClient();
    const results = await client.search({ query, count: count ?? DEFAULT_SEARCH_COUNT, needContent });
    const fetched = fetchTop ? await fetchTopPages(results, fetchTop, maxChars ?? FETCH_TOP_BUDGET) : [];
    return renderSearch({ query, results }, fetched);
  }));

  await server.connect(new StdioServerTransport());
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
    return { content: [{ type: 'text', text: `error: ${error?.message || error}` }], isError: true };
  }
}

/**
 * Fetch the first N search results, tolerating individual failures.
 * @param {Array<object>} results @param {number} limit @param {number} budget
 * @returns {Promise<Array<{ url: string, markdown: string }>>}
 */
async function fetchTopPages(results, limit, budget) {
  const targets = results.slice(0, limit);
  const settled = await Promise.allSettled(
    targets.map((item) => fetchPage(item.url, { maxChars: budget, noLinks: true })),
  );
  return settled.map((outcome, index) => {
    const url = targets[index].url;
    if (outcome.status === 'fulfilled') {
      return { url, markdown: truncate(outcome.value.markdown, budget).text };
    }
    return { url, markdown: `(fetch failed: ${outcome.reason?.message || 'unknown error'})` };
  });
}
