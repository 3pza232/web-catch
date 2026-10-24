#!/usr/bin/env node
/** Offline smoke tests; pass --live to also hit the network. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from '../lib/cli/args.mjs';
import { detectCharset, decodeBytes } from '../lib/net/decode.mjs';
import { normalizeLink, extractLinks } from '../lib/extract/links.mjs';
import { createDom } from '../lib/extract/dom.mjs';
import { extractArticle } from '../lib/extract/article.mjs';
import { extractPage, fetchPage } from '../lib/page.mjs';
import { outline, measure, normalize } from '../lib/text.mjs';
import { truncate } from '../lib/render.mjs';
import { serializePage, serializeSearch } from '../lib/serialize.mjs';
import { CliError } from '../lib/errors.mjs';
import { apiKeySource, resolveApiKey } from '../lib/config.mjs';
import { DEFAULT_TIMEOUT_MS, DEFAULT_RETRIES } from '../lib/constants.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const GBK = new Uint8Array(Buffer.concat([
  Buffer.from('<meta charset="gbk"><title>', 'latin1'),
  Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4]),
  Buffer.from('</title></html>', 'latin1'),
]));

const ARTICLE_HTML = `<!doctype html><html><head><title>Fixture</title></head><body><article>
<h1>Fixture article</h1>
<p>${'Paragraph text that is long enough for readability to keep the article body. '.repeat(6)}</p>
<h2>Data</h2>
<table><thead><tr><th>name</th><th>value</th></tr></thead><tbody><tr><td>a</td><td>1</td></tr></tbody></table>
<h2>Code</h2>
<pre><code class="language-js">const x = 1;</code></pre>
<p><a href="/relative?utm_source=x#frag">inner link</a> and <a href="https://b.example/page?utm_medium=y">outer</a></p>
</article></body></html>`;

test('parseArgs: positional URL', () => {
  const parsed = parseArgs(['https://example.com/a']);
  assert.equal(parsed.command, 'fetch');
  assert.deepEqual(parsed.args, ['https://example.com/a']);
});

test('parseArgs: search command with flags', () => {
  const parsed = parseArgs(['search', 'deepseek', 'v3', '--count=5', '--fetch-top', '2']);
  assert.equal(parsed.command, 'search');
  assert.deepEqual(parsed.args, ['deepseek', 'v3']);
  assert.equal(parsed.options.count, 5);
  assert.equal(parsed.options.fetchTop, 2);
});

test('parseArgs: short output flag and max-chars', () => {
  const parsed = parseArgs(['https://a.example', '--max-chars', '1200', '-o', 'page.md']);
  assert.equal(parsed.options.maxChars, 1200);
  assert.equal(parsed.options.output, 'page.md');
});

test('parseArgs: unknown flag rejects', () => {
  assert.throws(() => parseArgs(['--nope']), CliError);
});

test('parseArgs: --retries 0 disables retries, timeout stays positive', () => {
  const parsed = parseArgs(['https://a.example', '--retries', '0']);
  assert.equal(parsed.options.retries, 0);
  assert.throws(() => parseArgs(['https://a.example', '--timeout', '0']), CliError);
});

test('decode: meta charset gbk detected', () => {
  assert.equal(detectCharset(GBK, ''), 'gb18030');
  assert.match(decodeBytes(GBK, 'gb18030'), /中文测试/);
});

test('decode: header charset wins over meta', () => {
  assert.equal(detectCharset(GBK, 'text/html; charset=utf-8'), 'utf-8');
});

test('decode: BOM utf-16le', () => {
  const bytes = new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文', 'utf16le')]));
  assert.equal(detectCharset(bytes, ''), 'utf-16le');
  assert.equal(decodeBytes(bytes, 'utf-16le').replace(/^\uFEFF/, ''), '中文');
});

test('links: normalize strips tracking and fragment', () => {
  assert.equal(normalizeLink('/p?a=1&utm_source=x#f', 'https://ex.com/base'), 'https://ex.com/p?a=1');
  assert.equal(normalizeLink('mailto:x@y.z', 'https://ex.com'), null);
});

test('links: extraction dedupes and keeps context', () => {
  const { document } = createDom(ARTICLE_HTML, 'https://ex.com/post');
  const links = extractLinks(document, 'https://ex.com/post', 10);
  const hrefs = links.map((link) => link.href);
  assert.ok(hrefs.includes('https://ex.com/relative'));
  assert.ok(hrefs.includes('https://b.example/page'));
  assert.equal(new Set(hrefs).size, hrefs.length);
  assert.ok(links.every((link) => typeof link.context === 'string'));
});

test('article: keeps gfm table and fenced code', () => {
  const article = extractArticle(ARTICLE_HTML, 'https://ex.com/post');
  assert.equal(article.extracted, true);
  assert.match(article.markdown, /\| name \| value \|/);
  assert.match(article.markdown, /```js\nconst x = 1;\n```/);
  assert.ok(article.stats.words > 20);
});

test('text: normalize collapses blank runs', () => {
  assert.equal(normalize('a\n\n\n\nb  \n'), 'a\n\nb');
});

test('text: measure counts CJK per character', () => {
  const stats = measure('hello 世界');
  assert.equal(stats.cjk, 2);
  assert.equal(stats.words, 3);
});

test('text: outline skips fenced code', () => {
  const sections = outline('# A\ntext\n## B\n```\n# not a heading\n```\n');
  assert.deepEqual(sections.map((section) => section.title), ['A', 'B']);
});

test('render: truncate respects limit', () => {
  const body = truncate('x'.repeat(100), 40);
  assert.equal(body.truncated, true);
  assert.ok(body.text.length <= 40);
  assert.equal(truncate('short', 40).truncated, false);
});

test('page: plain text passthrough', async () => {
  const result = await extractPage({
    url: 'https://ex.com/data.json',
    finalUrl: 'https://ex.com/data.json',
    contentType: 'application/json',
    bytes: new TextEncoder().encode('{"ok":true}'),
    transport: 'http',
  });
  assert.equal(result.markdown, '{"ok":true}');
});

test('page: unsupported type rejects', async () => {
  await assert.rejects(
    extractPage({
      url: 'https://ex.com/blob',
      finalUrl: 'https://ex.com/blob',
      contentType: 'application/octet-stream',
      bytes: new Uint8Array([0, 1, 2, 3, 4, 5]),
      transport: 'http',
    }),
    (error) => error instanceof CliError && error.code === 'UNSUPPORTED_CONTENT_TYPE',
  );
});

/** @returns {object} HTML page input for extractPage. */
function htmlPage() {
  return {
    url: 'https://ex.com/post',
    finalUrl: 'https://ex.com/post',
    contentType: 'text/html; charset=utf-8',
    bytes: new TextEncoder().encode(ARTICLE_HTML),
    transport: 'http',
  };
}

test('page: linksOnly returns links and skips article extraction', async () => {
  const result = await extractPage(htmlPage(), { linksOnly: true });
  assert.equal(result.markdown, '');
  assert.equal(result.chars, 0);
  assert.ok(result.links.length >= 2, 'linksOnly returned no links');
  assert.ok(result.links.every((link) => link.href.startsWith('https://')));
});

test('page: linksOnly implies links even with noLinks', async () => {
  const result = await extractPage(htmlPage(), { linksOnly: true, noLinks: true });
  assert.ok(result.links.length >= 2);
});

test('page: linksOnly rejects non-HTML bodies', async () => {
  await assert.rejects(
    extractPage({
      url: 'https://ex.com/data.json',
      finalUrl: 'https://ex.com/data.json',
      contentType: 'application/json',
      bytes: new TextEncoder().encode('{"ok":true}'),
      transport: 'http',
    }, { linksOnly: true }),
    (error) => error instanceof CliError && error.code === 'LINKS_UNAVAILABLE',
  );
});

test('page: linksOnly over the api transport is a usage error', async () => {
  await assert.rejects(
    fetchPage('https://ex.com/post', { via: 'api', linksOnly: true }),
    (error) => error instanceof CliError && error.code === 'USAGE',
  );
});

test('page: raw and linksOnly cannot be combined', async () => {
  await assert.rejects(
    extractPage(htmlPage(), { raw: true, linksOnly: true }),
    (error) => error instanceof CliError && error.code === 'USAGE',
  );
});

test('page: raw returns the decoded source instead of markdown', async () => {
  const result = await extractPage(htmlPage(), { raw: true });
  assert.match(result.markdown, /<article>/);
  assert.match(result.markdown, /<h1>Fixture article<\/h1>/);
});

test('serialize: page contract carries links and outline', async () => {
  const result = await extractPage(htmlPage());
  const json = serializePage(result, { outline: true });
  assert.equal(json.url, 'https://ex.com/post');
  assert.equal(json.title, 'Fixture');
  assert.ok(json.markdown.length > 0);
  assert.ok(json.links.length >= 2);
  assert.ok(json.outline.some((section) => section.title === 'Data'));
  assert.equal(json.extracted, true);

  const withoutLinks = serializePage(result, { noLinks: true });
  assert.deepEqual(withoutLinks.links, []);
});

test('serialize: search contract keeps query, count and fetched pages', () => {
  const json = serializeSearch({
    query: 'q',
    count: 2,
    results: [{ url: 'https://a.example', title: 'A' }],
    fetched: [{ url: 'https://a.example', title: 'A', markdown: 'body' }],
  });
  assert.deepEqual(Object.keys(json), ['query', 'count', 'results', 'fetched']);
  assert.equal(json.count, 2);
});

test('constants: network defaults stay practical', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 15_000);
  assert.equal(DEFAULT_RETRIES, 2);
});

test('config: explicit key wins', () => {
  assert.equal(resolveApiKey('explicit-key'), 'explicit-key');
  assert.equal(apiKeySource('explicit-key'), 'option');
});

test('config: file supplies the key when the environment is empty', () => {
  const savedEnv = process.env.DEEPSEEK_API_KEY;
  const savedConfig = process.env.WEB_CATCH_CONFIG;
  delete process.env.DEEPSEEK_API_KEY;
  const file = join(mkdtempSync(join(tmpdir(), 'web-catch-')), 'config.json');
  writeFileSync(file, JSON.stringify({ apiKey: 'file-key' }));
  process.env.WEB_CATCH_CONFIG = file;
  try {
    assert.equal(resolveApiKey(), 'file-key');
    assert.equal(apiKeySource(), 'config');
  } finally {
    if (savedEnv === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = savedEnv;
    if (savedConfig === undefined) delete process.env.WEB_CATCH_CONFIG;
    else process.env.WEB_CATCH_CONFIG = savedConfig;
  }
});

test('page: default maxChars applies when omitted', async () => {
  const result = await extractPage({
    url: 'https://ex.com/short.txt',
    finalUrl: 'https://ex.com/short.txt',
    contentType: 'text/plain',
    bytes: new TextEncoder().encode('short body'),
    transport: 'http',
  });
  assert.equal(typeof result.limit, 'number');
  assert.equal(result.limit, 60_000);
  assert.equal(result.truncated, false);
});

/** @returns {Promise<void>} */
async function live() {
  const { fetchPage } = await import('../lib/page.mjs');
  const page = await fetchPage('https://example.com', { maxChars: 5000 });
  assert.ok(page.chars > 0, 'live fetch returned no text');
  console.log('  live fetch: chars=', page.chars, 'title=', page.title);

  if (process.env.DEEPSEEK_API_KEY) {
    const { DeepSeekClient } = await import('../lib/net/deepseek.mjs');
    const results = await new DeepSeekClient().search({ query: 'web-catch cli', count: 2 });
    assert.ok(Array.isArray(results), 'search did not return an array');
    console.log('  live search: results=', results.length);
  } else {
    console.log('  live search: skipped (DEEPSEEK_API_KEY is not set)');
  }
}

const main = async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${name}\n     ${error.message}`);
    }
  }
  if (process.argv.includes('--live')) {
    try {
      await live();
      console.log('ok   live');
    } catch (error) {
      failed++;
      console.error(`FAIL live\n     ${error.message}`);
    }
  }
  console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main();
