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

/** Minimal single-page PDF with a correct xref table. */
function makePdf() {
  const content = 'BT /F1 18 Tf 72 720 Td (Hello PDF text) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

let flakyHits = 0;
let badJsonHits = 0;
let lastSearchBody = {};

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
    lastSearchBody = body;
    if (body.query === 'slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ results: [] }));
      }, 300);
      return;
    }
    if (body.query === 'bad-shape') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ results: 'nope' }));
      return;
    }
    if (body.query === 'bad-json') {
      badJsonHits++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not json at all');
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
    const body = await readJson(req);
    if (String(body.url || '').includes('/multi')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        title: 'Multi example',
        content: [
          '该域名仅用于文档示例，无需获得许可。',
          'This domain is for use in documentation examples without needing permission\\.',
          'هذا النطاق مخصص للاستخدام في أمثلة التوثيق\\.',
        ].join('\n\n'),
      }));
      return;
    }
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
  if (pathname === '/comment-html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!--leading comment--><html><head><title>Comment page</title></head><body><article><h1>Comment page</h1><p>${
      'Comment page body text. '.repeat(20)
    }</p></article></body></html>`);
    return;
  }
  if (pathname === '/etag') {
    if (req.headers['if-none-match'] === '"v1"') {
      res.writeHead(304, { etag: '"v1"' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', etag: '"v1"' });
    res.end(ARTICLE_HTML);
    return;
  }
  if (pathname === '/pdf') {
    res.writeHead(200, { 'content-type': 'application/pdf' });
    res.end(makePdf());
    return;
  }
  if (pathname === '/pdf-bad') {
    res.writeHead(200, { 'content-type': 'application/pdf' });
    res.end('%PDF-1.4 definitely not a pdf');
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
writeFileSync(cookieFile, [
  '#HttpOnly_127.0.0.1\tFALSE\t/\tFALSE\t0\tsession\tabc123',
  'evil.example\tFALSE\t/\tFALSE\t0\ttoken\tsecret',
].join('\n'));

// WEB_CATCH_TEST_CACHE lets sandboxed environments point the cache at a
// writable path; normal runs use a fresh temp directory.
const cacheRoot = process.env.WEB_CATCH_TEST_CACHE || mkdtempSync(join(tmpdir(), 'web-catch-mcp-cache-'));
const liveMode = process.argv.includes('--live');
const useExe = process.argv.includes('--exe') || Boolean(process.env.WEB_CATCH_EXE);
const exePath = process.env.WEB_CATCH_EXE || 'web-catch.exe';
// Offline runs point the API client at the local fixture; --live must reach the real API.
const childEnv = liveMode
  ? { ...process.env, WEB_CATCH_CACHE: cacheRoot }
  : { ...process.env, WEB_CATCH_CACHE: cacheRoot, DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: base };
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
  if (response.error) {
    return { text: response.error.message || '', isError: true, protocolError: true };
  }
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
    'url', 'maxChars', 'links', 'linkLimit', 'linksOnly', 'outlineOnly', 'json', 'raw', 'via', 'apiLang',
    'unescape', 'cache', 'noCache', 'timeout', 'retries', 'userAgent', 'headers', 'cookieFile', 'charset',
  ];
  assert.deepEqual(fetchProps.sort(), expectedFetch.sort());
  const searchProps = Object.keys(tools.find((tool_) => tool_.name === 'search').inputSchema.properties);
  assert.deepEqual(searchProps.sort(), [
    'query', 'count', 'needContent', 'oriQuestion', 'localization', 'fetchTop', 'maxChars', 'json',
    'timeout', 'retries',
  ].sort());
  console.log('ok   tools/list schemas expose the CLI parity options');

  const article = `${base}/article`;

  const linksOnly = await tool('fetch', { url: article, linksOnly: true }, 3);
  assert.ok(!linksOnly.isError, linksOnly.text);
  assert.ok(linksOnly.text.startsWith('## Page links'), 'linksOnly output has a leading separator');
  assert.match(linksOnly.text, /## Page links/);
  assert.ok(linksOnly.text.includes(`${base}/next`), 'linksOnly missed the resolved link');
  console.log('ok   tools/call fetch linksOnly');

  const structured = await tool('fetch', { url: article, json: true, links: false, outlineOnly: true }, 4);
  assert.ok(!structured.isError, structured.text);
  const page = JSON.parse(structured.text);
  assert.equal(page.url, article);
  assert.equal(page.transport, 'http');
  assert.match(page.markdown, /^#+ /);
  assert.ok(!page.markdown.includes('url:'), 'json outline markdown leaked the metadata header');
  assert.ok(!page.markdown.includes('headings:'), 'json outline markdown leaked the metadata header');
  assert.ok(!page.markdown.includes('Paragraph text'), 'json outlineOnly leaked the full body');
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
    headers: ['X-Test: hello', 'Referer: https://ref.example', 'user-agent: custom-agent/1.0'],
    cookieFile,
  }, 7);
  assert.ok(!echo.isError, echo.text);
  const seen = JSON.parse(JSON.parse(echo.text).markdown);
  assert.equal(seen.headers['x-test'], 'hello');
  assert.equal(seen.headers.referer, 'https://ref.example');
  assert.equal(seen.headers['user-agent'], 'custom-agent/1.0', 'lower-case header override failed');
  assert.match(seen.headers.cookie || '', /session=abc123/);
  assert.ok(!(seen.headers.cookie || '').includes('secret'), 'cookie from another domain leaked');
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
  assert.match(payload.fetched[0].markdown, /\(truncated at 20000 chars\)/);
  const unmarked = payload.fetched[0].markdown.replace(/\n\n\(truncated at \d+ chars\)$/, '');
  assert.ok(unmarked.length <= 20_000, 'fetchTop budget was not capped');

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

  const comment = await tool('fetch', { url: `${base}/comment-html` }, 18);
  assert.ok(!comment.isError, comment.text);
  assert.match(comment.text, /Comment page body text/);
  assert.ok(!comment.text.includes('<html'), 'parameterized HTML content-type leaked raw source');

  const conditional = await tool('fetch', {
    url: `${base}/etag`, headers: ['If-None-Match: "v1"'], retries: 0,
  }, 19);
  assert.ok(conditional.isError, '304 without a cached copy was not reported');
  assert.match(conditional.text, /304/);
  assert.match(conditional.text, /cache/i);

  const cacheFirst = await tool('fetch', { url: `${base}/etag`, cache: true }, 20);
  assert.ok(!cacheFirst.isError, cacheFirst.text);
  const cacheSecond = await tool('fetch', { url: `${base}/etag`, cache: true }, 21);
  assert.ok(!cacheSecond.isError, cacheSecond.text);
  assert.match(cacheSecond.text, /cached: true/);
  const cacheJson = await tool('fetch', { url: `${base}/etag`, cache: true, json: true }, 43);
  assert.ok(!cacheJson.isError, cacheJson.text);
  const cachePayload = JSON.parse(cacheJson.text);
  assert.equal(cachePayload.cached, true);
  assert.match(cachePayload.cachedAt, /^\d{4}-\d{2}-\d{2}T/);

  const badCharset = await tool('fetch', { url: article, charset: 'definitely-not-a-charset' }, 22);
  assert.ok(badCharset.isError, 'invalid charset was not rejected');
  assert.match(badCharset.text, /unknown charset/);

  const ftpUrl = await tool('fetch', { url: 'ftp://example.com/x' }, 23);
  assert.ok(ftpUrl.isError, 'non-http URL was not rejected');
  assert.match(ftpUrl.text, /only http\(s\) URLs/);

  const rawOutline = await tool('fetch', { url: article, raw: true, outlineOnly: true }, 24);
  assert.ok(rawOutline.isError, 'raw + outlineOnly was not rejected');
  assert.match(rawOutline.text, /cannot be combined/);
  const linksOutline = await tool('fetch', { url: article, linksOnly: true, outlineOnly: true }, 25);
  assert.ok(linksOutline.isError, 'linksOnly + outlineOnly was not rejected');
  assert.match(linksOutline.text, /cannot be combined/);

  const badShape = await tool('search', { query: 'bad-shape', retries: 0 }, 26);
  assert.ok(badShape.isError, 'malformed upstream search payload was not reported');
  assert.match(badShape.text, /unexpected response shape|results/i);

  const badJson = await tool('search', { query: 'bad-json', retries: 2 }, 27);
  assert.ok(badJson.isError, 'malformed JSON body was not reported');
  assert.equal(badJsonHits, 1, 'malformed JSON must not be retried');

  const emptyQuery = await tool('search', { query: '   ' }, 28);
  assert.ok(emptyQuery.isError, 'empty search query was not rejected');
  assert.match(emptyQuery.text, /search query is required/);

  const unknownParam = await tool('fetch', { url: article, maxchars: 100 }, 29);
  assert.ok(unknownParam.isError, 'unknown fetch parameter was not rejected');
  assert.match(unknownParam.text, /unrecognized|additional propert/i);
  const unknownSearchParam = await tool('search', { query: 'fixture', fetch_top: 1 }, 30);
  assert.ok(unknownSearchParam.isError, 'unknown search parameter was not rejected');

  const limited = await tool('fetch', { url: article, json: true, linkLimit: 1 }, 31);
  assert.ok(!limited.isError, limited.text);
  assert.equal(JSON.parse(limited.text).links.length, 1, 'linkLimit was not applied');

  const linksJson = await tool('fetch', { url: article, linksOnly: true, json: true }, 32);
  assert.ok(!linksJson.isError, linksJson.text);
  const linksPayload = JSON.parse(linksJson.text);
  assert.equal(linksPayload.title, 'Fixture');
  assert.equal(linksPayload.markdown, '');
  assert.equal(linksPayload.links.length, 2);

  const noCache = await tool('fetch', { url: `${base}/etag`, cache: true, noCache: true }, 33);
  assert.ok(!noCache.isError, noCache.text);
  assert.ok(!/cached: true/.test(noCache.text), 'noCache reused a cached copy');

  const pdf = await tool('fetch', { url: `${base}/pdf`, json: true }, 34);
  assert.ok(!pdf.isError, pdf.text);
  const pdfPage = JSON.parse(pdf.text);
  assert.equal(pdfPage.pages, 1);
  assert.match(pdfPage.markdown, /Hello PDF text/);
  const badPdf = await tool('fetch', { url: `${base}/pdf-bad` }, 35);
  assert.ok(badPdf.isError, 'corrupt pdf was not reported');
  assert.match(badPdf.text, /PDF/);

  const apiMulti = await tool('fetch', { url: 'https://api.example/multi', via: 'api', json: true }, 36);
  assert.ok(!apiMulti.isError, apiMulti.text);
  const multiPage = JSON.parse(apiMulti.text);
  assert.match(multiPage.markdown, /该域名/);
  assert.match(multiPage.markdown, /without needing permission\./);
  assert.ok(!multiPage.markdown.includes('\\.'), 'api punctuation escapes were not removed');

  const apiEnglish = await tool('fetch', {
    url: 'https://api.example/multi', via: 'api', apiLang: 'en', json: true,
  }, 37);
  assert.ok(!apiEnglish.isError, apiEnglish.text);
  const englishPage = JSON.parse(apiEnglish.text);
  assert.match(englishPage.markdown, /This domain/);
  assert.ok(!englishPage.markdown.includes('该域名'), 'apiLang filter kept Chinese content');
  assert.ok(!englishPage.markdown.includes('هذا'), 'apiLang filter kept Arabic content');

  const apiLangBad = await tool('fetch', { url: article, apiLang: 'en' }, 38);
  assert.ok(apiLangBad.isError, 'apiLang without via=api was not rejected');
  assert.match(apiLangBad.text, /only available with via/);

  const apiRaw = await tool('fetch', {
    url: 'https://api.example/multi', via: 'api', json: true, unescape: false,
  }, 41);
  assert.ok(!apiRaw.isError, apiRaw.text);
  assert.ok(JSON.parse(apiRaw.text).markdown.includes('\\.'), 'unescape:false did not keep escapes');
  const unescapeBad = await tool('fetch', { url: article, unescape: false }, 42);
  assert.ok(unescapeBad.isError, 'unescape without via=api was not rejected');
  assert.match(unescapeBad.text, /only available with via/);

  lastSearchBody = {};
  const searchMeta = await tool('search', {
    query: 'fixture', count: 1, oriQuestion: 'original question', localization: '1.2.3.4',
  }, 39);
  assert.ok(!searchMeta.isError, searchMeta.text);
  assert.equal(lastSearchBody.ori_question, 'original question');
  assert.equal(lastSearchBody.localization, '1.2.3.4');

  const longQuery = await tool('search', { query: 'x'.repeat(129) }, 40);
  assert.ok(longQuery.isError, 'oversized search query was not rejected');
  assert.match(longQuery.text, /at most 128/);
  console.log('ok   tools/call robustness edges');

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
