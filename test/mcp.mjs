#!/usr/bin/env node
/**
 * MCP handshake and tool tests against a local HTTP fixture server.
 * No external network is needed; pass --live to additionally hit example.com
 * and the DeepSeek Search API. Pass --exe to test a compiled web-catch.exe.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ARTICLE_HTML = `<!doctype html><html><head><title>Fixture</title></head><body><article>
<h1>Fixture article</h1>
<p>${'Paragraph text that is long enough for readability to keep the article body. '.repeat(8)}</p>
<h2>Data</h2>
<p><a href="/next?utm_source=x">next page</a> and <a href="https://b.example/page?utm_medium=y">outer</a></p>
</article></body></html>`;

let flakyHits = 0;

/** @param {import('node:http').IncomingMessage} req @returns {Promise<any>} */
async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://127.0.0.1');
  if (pathname === '/v1/tools/search') {
    const body = await readJson(req);
    if (body.query === 'slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ results: [] }));
      }, 300);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      results: [
        { title: 'Long result', url: `${base}/long`, snippet: 'first snippet', summary: 'first summary' },
        { title: 'Second result', url: `${base}/article#second`, snippet: 'second snippet' },
      ],
    }));
    return;
  }
  if (pathname === '/v1/tools/fetch') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ title: 'API fixture', content: 'API body text. '.repeat(40) }));
    return;
  }
  if (pathname === '/article') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(ARTICLE_HTML);
    return;
  }
  if (pathname === '/long') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>Long</title></head><body><article><h1>Long article</h1><p>${
      'Long article body sentence. '.repeat(1500)
    }</p></article></body></html>`);
    return;
  }
  if (pathname === '/echo') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ headers: req.headers }));
    return;
  }
  if (pathname === '/flaky-once') {
    flakyHits++;
    if (flakyHits === 1) {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('busy');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body><article><h1>Recovered</h1><p>Eventually served.</p></article></body></html>');
    return;
  }
  if (pathname === '/always-503') {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end('down');
    return;
  }
  if (pathname === '/slow') {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><article><h1>Slow</h1></article></body></html>');
    }, 300);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const cookieFile = join(mkdtempSync(join(tmpdir(), 'web-catch-mcp-')), 'cookies.txt');
writeFileSync(cookieFile, '127.0.0.1\tFALSE\t/\tFALSE\t0\tsession\tabc123\n');

const liveMode = process.argv.includes('--live');
const useExe = process.argv.includes('--exe') || Boolean(process.env.WEB_CATCH_EXE);
const exePath = process.env.WEB_CATCH_EXE || 'web-catch.exe';
// Offline runs point the API client at the local fixture; --live must reach the real API.
const childEnv = liveMode
  ? { ...process.env }
  : { ...process.env, DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: base };
const child = useExe
  ? spawn(exePath, ['--mcp'], { stdio: ['pipe', 'pipe', 'inherit'], env: childEnv })
  : spawn(process.execPath, ['bin/cli.mjs', '--mcp'], { stdio: ['pipe', 'pipe', 'inherit'], env: childEnv });

let buffer = '';
const pending = new Map();
const failures = [];

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      failures.push(`non-JSON stdout: ${line.slice(0, 120)}`);
      continue;
    }
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  }
});

/** @param {string} method @param {object} [params] @param {number} id @returns {Promise<object>} */
function call(method, params, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 20_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

/**
 * Run one tools/call and return its text content plus the error flag.
 * @param {string} name @param {object} args @param {number} id
 * @returns {Promise<{ text: string, isError: boolean }>}
 */
async function tool(name, args, id) {
  const response = await call('tools/call', { name, arguments: args }, id);
  return {
    text: response.result?.content?.[0]?.text || '',
    isError: Boolean(response.result?.isError),
  };
}

try {
  const init = await call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'web-catch-test', version: '1.0.0' },
  }, 1);
  assert.equal(init.result?.serverInfo?.name, 'web-catch');
  console.log('ok   initialize:', init.result.serverInfo.version);

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const list = await call('tools/list', {}, 2);
  const tools = list.result?.tools || [];
  const names = tools.map((tool_) => tool_.name).sort();
  assert.deepEqual(names, ['fetch', 'search']);
  console.log('ok   tools/list:', names.join(', '));

  const fetchProps = Object.keys(tools.find((tool_) => tool_.name === 'fetch').inputSchema.properties);
  const expectedFetch = [
    'url', 'maxChars', 'links', 'linksOnly', 'outlineOnly', 'json', 'raw', 'via', 'cache',
    'timeout', 'retries', 'userAgent', 'headers', 'cookieFile', 'charset',
  ];
  assert.deepEqual(fetchProps.sort(), expectedFetch.sort());
  const searchProps = Object.keys(tools.find((tool_) => tool_.name === 'search').inputSchema.properties);
  assert.deepEqual(searchProps.sort(), [
    'query', 'count', 'needContent', 'fetchTop', 'maxChars', 'json', 'timeout', 'retries',
  ].sort());
  console.log('ok   tools/list schemas expose the CLI parity options');

  const article = `${base}/article`;

  const linksOnly = await tool('fetch', { url: article, linksOnly: true }, 3);
  assert.ok(!linksOnly.isError, linksOnly.text);
  assert.match(linksOnly.text, /## Page links/);
  assert.ok(linksOnly.text.includes(`${base}/next`), 'linksOnly missed the resolved link');
  console.log('ok   tools/call fetch linksOnly');

  const structured = await tool('fetch', { url: article, json: true, links: false, outlineOnly: true }, 4);
  assert.ok(!structured.isError, structured.text);
  const page = JSON.parse(structured.text);
  assert.equal(page.url, article);
  assert.equal(page.transport, 'http');
  assert.ok(page.markdown.includes('Fixture article'));
  assert.deepEqual(page.links, []);
  assert.ok(Array.isArray(page.outline) && page.outline.length >= 1);
  console.log('ok   tools/call fetch json');

  const raw = await tool('fetch', { url: article, raw: true }, 5);
  assert.ok(!raw.isError, raw.text);
  assert.match(raw.text, /<article>/);
  console.log('ok   tools/call fetch raw');

  const outlineOnly = await tool('fetch', { url: article, outlineOnly: true }, 6);
  assert.ok(!outlineOnly.isError, outlineOnly.text);
  assert.match(outlineOnly.text, /headings: \d+/);
  assert.match(outlineOnly.text, /## Data/);
  console.log('ok   tools/call fetch outlineOnly');

  const echo = await tool('fetch', {
    url: `${base}/echo`,
    json: true,
    headers: ['X-Test: hello', 'Referer: https://ref.example'],
    cookieFile,
  }, 7);
  assert.ok(!echo.isError, echo.text);
  const seen = JSON.parse(JSON.parse(echo.text).markdown);
  assert.equal(seen.headers['x-test'], 'hello');
  assert.equal(seen.headers.referer, 'https://ref.example');
  assert.match(seen.headers.cookie || '', /session=abc123/);
  console.log('ok   tools/call fetch headers + cookieFile');

  const timeout = await tool('fetch', { url: `${base}/slow`, timeout: 0.15, retries: 0 }, 8);
  assert.ok(timeout.isError, 'timeout was not reported');
  assert.match(timeout.text, /timeout/i);
  console.log('ok   tools/call fetch timeout');

  const retried = await tool('fetch', { url: `${base}/flaky-once`, retries: 1 }, 9);
  assert.ok(!retried.isError, retried.text);
  assert.match(retried.text, /Recovered/);
  console.log('ok   tools/call fetch retries');

  const failed = await tool('fetch', { url: `${base}/always-503`, retries: 0 }, 10);
  assert.ok(failed.isError, 'HTTP 503 was not reported as an error');
  assert.match(failed.text, /HTTP 503/);

  const badLinks = await tool('fetch', { url: `${base}/echo`, linksOnly: true }, 11);
  assert.ok(badLinks.isError, 'linksOnly on a non-HTML body was not rejected');
  assert.match(badLinks.text, /link extraction is only available/);
  assert.match(badLinks.text, /hint:/);
  console.log('ok   tools/call fetch error paths');

  const searchJson = await tool('search', {
    query: 'fixture', count: 2, json: true, fetchTop: 1, maxChars: 400_000,
  }, 12);
  assert.ok(!searchJson.isError, searchJson.text);
  const payload = JSON.parse(searchJson.text);
  assert.equal(payload.query, 'fixture');
  assert.equal(payload.count, 2);
  assert.equal(payload.results.length, 2);
  assert.equal(payload.fetched.length, 1);
  assert.ok(payload.fetched[0].url.endsWith('/long'), 'fetchTop used the wrong result');
  assert.ok(payload.fetched[0].markdown.includes('Long article body'));
  assert.ok(payload.fetched[0].markdown.length <= 20_000, 'fetchTop budget was not capped');

  const searchHuman = await tool('search', { query: 'fixture', count: 2 }, 13);
  assert.ok(!searchHuman.isError, searchHuman.text);
  assert.match(searchHuman.text, /query: fixture/);
  assert.match(searchHuman.text, /Long result/);

  const searchTimeout = await tool('search', { query: 'slow', timeout: 0.15, retries: 0 }, 14);
  assert.ok(searchTimeout.isError, 'search timeout was not reported');
  assert.match(searchTimeout.text, /timeout|abort/i);

  const apiFetch = await tool('fetch', { url: 'https://api.example/page', via: 'api', json: true }, 15);
  assert.ok(!apiFetch.isError, apiFetch.text);
  const apiPage = JSON.parse(apiFetch.text);
  assert.equal(apiPage.transport, 'api');
  assert.equal(apiPage.title, 'API fixture');
  assert.ok(apiPage.markdown.includes('API body text'));

  const apiLinks = await tool('fetch', { url: 'https://api.example/page', via: 'api', linksOnly: true }, 16);
  assert.ok(apiLinks.isError, 'linksOnly over via=api was not rejected');
  assert.match(apiLinks.text, /not available over the API transport/);

  const conflict = await tool('fetch', { url: article, raw: true, linksOnly: true }, 17);
  assert.ok(conflict.isError, 'raw + linksOnly was not rejected');
  assert.match(conflict.text, /cannot be combined/);
  console.log('ok   tools/call search + api transport');

  if (process.argv.includes('--live')) {
    const live = await tool('fetch', { url: 'https://example.com', maxChars: 500 }, 20);
    assert.ok(!live.isError, `fetch failed: ${live.text}`);
    assert.ok(live.text.includes('http'), 'fetch returned no metadata header');
    console.log('ok   tools/call fetch live:', live.text.length, 'chars');

    const search = await tool('search', { query: 'web-catch cli', count: 2 }, 21);
    assert.ok(!search.isError, `search failed: ${search.text}`);
    console.log('ok   tools/call search live');
  }

  assert.deepEqual(failures, []);
  console.log('\nMCP OK');
} catch (error) {
  console.error('MCP FAILED:', error.message);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  child.kill();
  server.close();
}
