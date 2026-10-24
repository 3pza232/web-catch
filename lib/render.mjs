/**
 * Render a fetch result as Markdown with a metadata header.
 * @param {object} result
 * @param {boolean} [withLinks]
 * @returns {string}
 */
export function renderPage(result, withLinks = true) {
  const lines = [
    `url: ${result.finalUrl || result.url}`,
    `title: ${result.title || ''}`,
    `fetched: ${result.fetchedAt}`,
    `transport: ${result.transport}`,
    `chars: ${result.chars} (words ${result.words})`,
  ];
  if (result.status) lines.push(`status: ${result.status}`);
  if (result.pages) lines.push(`pages: ${result.pages}`);
  if (result.cached) lines.push('cached: true (revalidated)');
  if (result.cacheNote) lines.push(`cache: ${result.cacheNote}`);
  if (result.truncated) lines.push(`truncated: true (limit ${result.limit} chars)`);
  if (result.note) lines.push(`note: ${result.note}`);
  lines.push('', result.markdown);

  if (withLinks && result.links?.length) lines.push('', '---', '', renderLinks(result.links));
  return lines.join('\n');
}

/**
 * Render the link list block. Standalone when `--links-only` selects it, so it
 * carries no body/link separator of its own.
 * @param {Array<{ href: string, text: string, context: string }>} links
 * @returns {string}
 */
export function renderLinks(links) {
  const lines = [`## Page links (${links.length})`, ''];
  links.forEach((link, index) => {
    const label = link.text && link.text !== link.href ? link.text : link.href;
    lines.push(`${index + 1}. [${label}](${link.href})`);
    if (link.context) lines.push(`   - context: ${link.context}`);
  });
  return lines.join('\n');
}

/**
 * Render an outline as plain Markdown headings (no metadata header).
 * @param {Array<{ level: number, title: string, chars: number }>} sections
 * @returns {string}
 */
export function renderOutlineBody(sections) {
  return sections
    .map((section) => `${'#'.repeat(section.level)} ${section.title} (${section.chars} chars)`)
    .join('\n');
}

/**
 * Render a heading outline for humans: metadata header plus Markdown headings.
 * @param {object} result
 * @param {Array<{ level: number, title: string, chars: number }>} sections
 * @returns {string}
 */
export function renderOutline(result, sections) {
  const lines = [
    `url: ${result.finalUrl || result.url}`,
    `title: ${result.title || ''}`,
    `chars: ${result.chars}`,
    `headings: ${sections.length}`,
    '',
  ];
  lines.push(renderOutlineBody(sections));
  return lines.join('\n');
}

/**
 * Render search results as Markdown, optionally with fetched pages appended.
 * @param {{ query: string, results: Array<object> }} payload
 * @param {Array<{ url: string, title: string, markdown: string }>} [fetched]
 * @returns {string}
 */
export function renderSearch(payload, fetched = []) {
  const lines = [`query: ${payload.query}`, `results: ${payload.results.length}`, ''];

  payload.results.forEach((item, index) => {
    const meta = [
      item.site_name,
      item.date?.slice(0, 10),
      Number.isFinite(item.rerank_score) ? `score ${item.rerank_score.toFixed(2)}` : '',
      item.authority >= 3 ? 'authoritative' : '',
    ].filter(Boolean).join(' · ');
    lines.push(`${index + 1}. ${item.title}${meta ? ` — ${meta}` : ''}`);
    lines.push(`   ${displayUrl(item.url)}`);
    // The upstream summary is written for models; snippet is the short
    // frontend teaser. Prefer one of them instead of spending tokens on both.
    const description = item.summary ? clip(item.summary, SUMMARY_CHARS) : item.snippet;
    if (description) lines.push(`   ${description}`);
    lines.push('');
  });

  for (const page of fetched) {
    lines.push('---', '', `## Fetched: ${page.url}`, '', page.markdown, '');
  }
  return lines.join('\n').trim();
}

/** Summary budget in human-readable output; `--json` keeps the full value. */
const SUMMARY_CHARS = 400;

/** @param {string} text @param {number} limit @returns {string} */
function clip(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
}

/**
 * Drop tracking parameters so terminals and models see a stable URL.
 * @param {string} raw @returns {string}
 */
function displayUrl(raw) {
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_[a-z]+|gspk|gsxid|ps_partner_key|ps_xid|pscd|spm|scm|ref|from)$/i.test(key)) url.searchParams.delete(key);
    }
    if (!url.searchParams.size) url.search = '';
    return url.href;
  } catch {
    return raw;
  }
}
