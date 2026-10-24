#!/usr/bin/env node
/** Offline smoke tests; pass --live to also hit the network. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from '../lib/cli/args.mjs';
import { detectCharset, decodeBytes } from '../lib/net/decode.mjs';
import { normalizeLink, extractLinks } from '../lib/extract/links.mjs';
import { createDom } from '../lib/extract/dom.mjs';
import { extractArticle } from '../lib/extract/article.mjs';
import { extractPage, fetchPage } from '../lib/page.mjs';
import { outline, measure, normalize, truncate } from '../lib/text.mjs';
import { renderLinks, renderOutlineBody, renderPage, renderSearch } from '../lib/render.mjs';
import { serializePage, serializeSearch } from '../lib/serialize.mjs';
import { CliError } from '../lib/errors.mjs';
import { apiKeySource, resolveApiKey } from '../lib/config.mjs';
import { parseHeaders, readCookieFile } from '../lib/net/http.mjs';
import { readCache, writeCache, cacheRoot, keyOf } from '../lib/cache.mjs';
import { DeepSeekClient } from '../lib/net/deepseek.mjs';
import { detectLanguage, filterLanguages, normalizeApiContent, unescapePunctuation } from '../lib/api-content.mjs';
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

test('parseArgs: fractional timeout accepted, upper bounds enforced', () => {
  assert.equal(parseArgs(['https://a.example', '--timeout', '0.5']).options.timeout, 0.5);
  assert.throws(() => parseArgs(['https://a.example', '--timeout', '601']), CliError);
  assert.throws(() => parseArgs(['https://a.example', '--retries', '11']), CliError);
  assert.equal(parseArgs(['https://a.example', '--link-limit', '7']).options.linkLimit, 7);
});

test('headers: line breaks are rejected', () => {
  assert.throws(() => parseHeaders(['X-Test: a\nb']), (error) => error.code === 'USAGE');
  assert.equal(parseHeaders(['X-Test: a'])['X-Test'], 'a');
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

test('render: outline body is plain Markdown headings', () => {
  const body = renderOutlineBody([
    { level: 2, title: 'Concepts', chars: 2182 },
    { level: 3, title: 'Usage', chars: 42 },
  ]);
  assert.equal(body, '## Concepts (2182 chars)\n### Usage (42 chars)');
});

test('render: search prefers summary over snippet, falls back to snippet', () => {
  const output = renderSearch({
    query: 'q',
    results: [
      { title: 'A', url: 'https://a.example', snippet: 'shortteaser', summary: 'modelsummary' },
      { title: 'B', url: 'https://b.example', snippet: 'onlysnippet' },
    ],
  });
  assert.match(output, /modelsummary/);
  assert.ok(!output.includes('shortteaser'));
  assert.match(output, /onlysnippet/);
});

test('render: standalone links block has no leading separator', () => {
  const links = [{ href: 'https://ex.com/a', text: 'a', context: '' }];
  const block = renderLinks(links);
  assert.ok(block.startsWith('## Page links (1)'), block.slice(0, 30));
  assert.ok(!block.includes('---'));
  const page = renderPage({
    url: 'https://ex.com/',
    finalUrl: 'https://ex.com/',
    title: 't',
    fetchedAt: '2026-10-24T00:00:00Z',
    transport: 'http',
    chars: 4,
    words: 1,
    markdown: 'body',
    links,
  }, true);
  assert.match(page, /body\n\n---\n\n## Page links \(1\)/);
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
  assert.equal(result.title, 'Fixture');
  assert.equal(result.markdown, '');
  assert.equal(result.chars, 0);
  assert.ok(result.links.length >= 2, 'linksOnly returned no links');
  assert.ok(result.links.every((link) => link.href.startsWith('https://')));
});

test('page: linkLimit caps the link list', async () => {
  const result = await extractPage(htmlPage(), { linkLimit: 1 });
  assert.equal(result.links.length, 1);
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

test('page: content-type parameters do not defeat HTML dispatch', async () => {
  const html = `<!--leading comment--><html><head><title>Param</title></head><body><article><h1>T</h1><p>${
    'dispatch text '.repeat(60)
  }</p></article></body></html>`;
  const result = await extractPage({
    url: 'https://ex.com/param',
    finalUrl: 'https://ex.com/param',
    contentType: 'text/html; charset=utf-8',
    bytes: new TextEncoder().encode(html),
    transport: 'http',
  });
  assert.equal(result.title, 'Param');
  assert.match(result.markdown, /dispatch text/);
  assert.ok(!result.markdown.includes('<html'), 'HTML leaked through as raw text');
});

test('page: xhtml with charset params is extracted, not passed through', async () => {
  const html = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Xhtml</title></head><body><article><h1>T</h1><p>${
    'xhtml body text '.repeat(60)
  }</p></article></body></html>`;
  const result = await extractPage({
    url: 'https://ex.com/x.xhtml',
    finalUrl: 'https://ex.com/x.xhtml',
    contentType: 'application/xhtml+xml; charset=utf-8',
    bytes: new TextEncoder().encode(html),
    transport: 'http',
  });
  assert.equal(result.title, 'Xhtml');
  assert.ok(!result.markdown.includes('<html'), 'XHTML leaked through as raw text');
});

test('page: corrupt pdf maps to extraction error', async () => {
  await assert.rejects(
    extractPage({
      url: 'https://ex.com/bad.pdf',
      finalUrl: 'https://ex.com/bad.pdf',
      contentType: 'application/pdf; charset=binary',
      bytes: new TextEncoder().encode('%PDF-1.4 definitely not a pdf'),
      transport: 'http',
    }),
    (error) => error instanceof CliError && error.code === 'EXTRACT_PDF' && error.exit === 2,
  );
});

test('page: pdf on an unsupported runtime reports a clear error', async () => {
  if (Object.getOwnPropertyDescriptor(globalThis, 'Iterator')?.configurable !== true) return;
  const saved = globalThis.Iterator;
  try {
    delete globalThis.Iterator;
    await assert.rejects(
      extractPage({
        url: 'https://ex.com/x.pdf',
        finalUrl: 'https://ex.com/x.pdf',
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode('%PDF-1.4'),
        transport: 'http',
      }),
      (error) => error instanceof CliError && error.code === 'UNSUPPORTED_RUNTIME',
    );
  } finally {
    globalThis.Iterator = saved;
  }
});

test('page: invalid explicit charset is a usage error', async () => {
  await assert.rejects(
    fetchPage('https://ex.com/page', { charset: 'definitely-not-a-charset' }),
    (error) => error instanceof CliError && error.code === 'USAGE',
  );
});

test('page: non-http url is a usage error', async () => {
  await assert.rejects(
    fetchPage('ftp://example.com/x'),
    (error) => error instanceof CliError && error.code === 'USAGE',
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

test('page: conflicting output modes all reject', async () => {
  await assert.rejects(
    extractPage(htmlPage(), { raw: true, outlineOnly: true }),
    (error) => error instanceof CliError && error.code === 'USAGE',
  );
  await assert.rejects(
    extractPage(htmlPage(), { linksOnly: true, outlineOnly: true }),
    (error) => error instanceof CliError && error.code === 'USAGE',
  );
});

test('page: empty html is a clean extraction error, not a crash', async () => {
  for (const body of ['', '   \n  ']) {
    await assert.rejects(
      extractPage({
        url: 'https://ex.com/empty',
        finalUrl: 'https://ex.com/empty',
        contentType: 'text/html; charset=utf-8',
        bytes: new TextEncoder().encode(body),
        transport: 'http',
      }),
      (error) => error instanceof CliError && error.code === 'EXTRACT_EMPTY',
    );
  }
});

test('page: fetchedAt carries an explicit UTC marker', async () => {
  const result = await extractPage(htmlPage());
  assert.match(result.fetchedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('cookies: HttpOnly lines parse, cookies are host/path/secure scoped', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'web-catch-cookie-')), 'cookies.txt');
  writeFileSync(file, [
    '#HttpOnly_127.0.0.1\tFALSE\t/\tFALSE\t0\tsession\tabc123',
    '.example.com\tFALSE\t/\tFALSE\t0\thostonly\tyes',
    'api.example.com\tFALSE\t/api\tTRUE\t0\tscoped\tsecret',
    'other.example\tFALSE\t/\tFALSE\t0\tleak\tno',
  ].join('\n'));
  assert.equal(await readCookieFile(file, 'http://127.0.0.1/'), 'session=abc123');
  assert.equal(await readCookieFile(file, 'https://api.example.com/api/x'), 'hostonly=yes; scoped=secret');
  assert.equal(await readCookieFile(file, 'https://api.example.com/other'), 'hostonly=yes');
  await assert.rejects(readCookieFile(file, 'https://nothing.invalid/'),
    (error) => error instanceof CliError && error.code === 'USAGE');
});

test('cache: corrupt metadata ignored, entries identity-scoped', async () => {
  const saved = process.env.WEB_CATCH_CACHE;
  process.env.WEB_CATCH_CACHE = mkdtempSync(join(tmpdir(), 'web-catch-cache-'));
  try {
    const url = 'https://ex.com/cached';
    const bytes = new TextEncoder().encode('<html>cached</html>');
    await writeCache(url, 'cookie:a=1', { etag: '"v1"', contentType: 'text/html' }, bytes);
    const hit = await readCache(url, 'cookie:a=1');
    assert.equal(Buffer.from(hit.bytes).toString(), '<html>cached</html>');
    assert.equal(await readCache(url, 'cookie:a=2'), null);

    mkdirSync(cacheRoot(), { recursive: true });
    writeFileSync(join(cacheRoot(), `${keyOf(url, 'broken')}.json`),
      JSON.stringify({ etag: 'bad\nvalue', contentType: 'text/html' }));
    writeFileSync(join(cacheRoot(), `${keyOf(url, 'broken')}.body`), bytes);
    assert.equal(await readCache(url, 'broken'), null);

    await writeCache(url, 'novalidator', {}, bytes);
    assert.equal(await readCache(url, 'novalidator'), null);
  } finally {
    if (saved === undefined) delete process.env.WEB_CATCH_CACHE;
    else process.env.WEB_CATCH_CACHE = saved;
  }
});

test('cache: unquoted ETag values are accepted', async () => {
  const saved = process.env.WEB_CATCH_CACHE;
  process.env.WEB_CATCH_CACHE = mkdtempSync(join(tmpdir(), 'web-catch-cache-'));
  try {
    const url = 'https://ex.com/unquoted';
    const bytes = new TextEncoder().encode('body');
    assert.equal(await writeCache(url, '', { etag: 'abc123', contentType: 'text/html' }, bytes), 'stored');
    assert.equal((await readCache(url)).etag, 'abc123');
  } finally {
    if (saved === undefined) delete process.env.WEB_CATCH_CACHE;
    else process.env.WEB_CATCH_CACHE = saved;
  }
});

test('cache: a body/metadata size mismatch is treated as a miss', async () => {
  const saved = process.env.WEB_CATCH_CACHE;
  process.env.WEB_CATCH_CACHE = mkdtempSync(join(tmpdir(), 'web-catch-cache-'));
  try {
    const url = 'https://ex.com/size';
    const bytes = new TextEncoder().encode('body');
    await writeCache(url, '', { etag: '"v1"', contentType: 'text/html' }, bytes);
    writeFileSync(join(cacheRoot(), keyOf(url, '') + '.body'), new TextEncoder().encode('body!'));
    assert.equal(await readCache(url), null);
  } finally {
    if (saved === undefined) delete process.env.WEB_CATCH_CACHE;
    else process.env.WEB_CATCH_CACHE = saved;
  }
});

test('cache: an unwritable explicit directory disables caching with a status', async () => {
  const saved = process.env.WEB_CATCH_CACHE;
  const file = join(mkdtempSync(join(tmpdir(), 'web-catch-cache-')), 'not-a-dir');
  writeFileSync(file, 'x');
  process.env.WEB_CATCH_CACHE = file;
  try {
    assert.equal(cacheRoot(), '');
    assert.equal(await readCache('https://ex.com/x'), null);
    assert.equal(await writeCache('https://ex.com/x', '', { etag: '"v1"' }, new Uint8Array(1)), 'unavailable');
  } finally {
    if (saved === undefined) delete process.env.WEB_CATCH_CACHE;
    else process.env.WEB_CATCH_CACHE = saved;
  }
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

  const outlineJson = serializePage(result, { outline: true, markdown: '## only outline' });
  assert.equal(outlineJson.markdown, '## only outline');
  assert.ok(outlineJson.outline.length >= 1);
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

test('api content: detects languages by script and function words', () => {
  assert.equal(detectLanguage('这是一个中文段落，用于测试。'), 'zh');
  assert.equal(detectLanguage('This is an English paragraph for testing the detector.'), 'en');
  assert.equal(detectLanguage('هذا النطاق مخصص للاستخدام في أمثلة التوثيق'), 'ar');
  assert.equal(detectLanguage('Этот домен предназначен для примеров документации'), 'ru');
  assert.equal(detectLanguage('This is a long English sentence that mentions 汉字 only.'), 'en');
  assert.equal(detectLanguage('Represents a resource request.'), '');
  assert.equal(detectLanguage('12345 —'), '');
});

test('api content: language filter keeps only target blocks and falls back', () => {
  const content = '中文段落一，用于测试。\n\nThis is an English paragraph for testing.\n\nهذا النطاق مخصص للاستخدام.';
  const english = filterLanguages(content, 'en');
  assert.match(english, /English paragraph/);
  assert.ok(!english.includes('中文'));
  assert.ok(!english.includes('هذا'));
  const chinese = filterLanguages(content, 'zh');
  assert.ok(chinese.includes('中文'));
  assert.ok(!chinese.includes('English'));
  assert.equal(filterLanguages('中文段落一。', 'en'), '中文段落一。');
  const autoTitle = filterLanguages(content, 'auto', '中文标题测试');
  assert.ok(autoTitle.includes('中文'));
  const bodyMajority = 'This is English block one.\n\nThis is English block two.\n\n这是一个中文段落。';
  const autoBody = filterLanguages(bodyMajority, 'auto', 'Ex');
  assert.match(autoBody, /English block one/);
  assert.ok(!autoBody.includes('中文'));
  const openFence = '中文段落。\n\n```js\nconst 中文 = 1;\n';
  assert.equal(filterLanguages(openFence, 'en'), openFence);
});

test('api content: unescapes rendering-equivalent punctuation only', () => {
  assert.equal(
    unescapePunctuation('a\\. b\\, c\\; d\\: e\\! f\\? g\\(h\\) i\\\' j\\/'),
    'a. b, c; d: e! f? g(h) i\' j/',
  );
  assert.equal(unescapePunctuation('1\\. item\\, x'), '1\\. item, x');
  assert.equal(unescapePunctuation('`a\\.b`'), '`a\\.b`');
  assert.equal(unescapePunctuation('```\na\\,b\n```'), '```\na\\,b\n```');
  assert.equal(unescapePunctuation('```\na\\,b'), '```\na\\,b');
  assert.equal(unescapePunctuation('\\# heading and \\- list'), '\\# heading and \\- list');
});

test('api content: normalization combines filtering, unescaping and opt-out', () => {
  const multi = '中文内容段落。\n\nThis is the original English content\\.';
  assert.equal(normalizeApiContent(multi, { lang: 'en', title: 'English title' }).trim(),
    'This is the original English content.');
  assert.ok(normalizeApiContent('中文内容段落。', { lang: 'en' }).includes('中文'));
  assert.equal(normalizeApiContent('a\\. b', { unescape: false }), 'a\\. b');
});

test('search: localization must be an IP address', async () => {
  const client = new DeepSeekClient({ apiKey: 'test-key' });
  await assert.rejects(
    client.search({ query: 'q', localization: 'not-an-ip' }),
    (error) => error instanceof CliError && error.code === 'USAGE',
  );
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
