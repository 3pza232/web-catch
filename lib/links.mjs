/**
 * 从 DOM 中提取链接
 * @param {Document} document - linkedom Document
 * @param {string} baseUrl - 页面 URL，用于补全相对链接
 * @returns {Array<{ href: string, text: string, context: string }>}
 */
export function extractLinks(document, baseUrl) {
  // 只在正文区域找链接
  const main = document.querySelector('main, article, [role="main"], .content, .post, .article, #content, #main');
  const root = main || document.body;
  if (!root) return [];

  const anchors = root.querySelectorAll('a[href]');
  const seen = new Set();
  const links = [];

  for (const a of anchors) {
    let href = a.getAttribute('href');
    if (!href || typeof href !== 'string') continue;

    href = href.trim();

    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;

    try {
      href = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    if (seen.has(href)) continue;
    seen.add(href);

    const text = a.textContent?.replace(/\s+/g, ' ').trim() || '';

    const parent = a.parentElement;
    const parentText = parent?.textContent?.replace(/\s+/g, ' ').trim() || '';
    let context = '';
    if (parentText) {
      const idx = parentText.indexOf(text);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(parentText.length, idx + text.length + 40);
        context = (start > 0 ? '...' : '') + parentText.slice(start, end) + (end < parentText.length ? '...' : '');
      }
    }

    links.push({ href, text: text || href, context });
  }

  return links;
}

/**
 * 格式化链接清单为 Markdown
 * @param {Array} links
 * @returns {string}
 */
export function formatLinks(links) {
  if (!links.length) return '';

  const lines = [`---\n\n## 页面链接 (${links.length})\n`];
  links.forEach((link, i) => {
    const display = link.text && link.text !== link.href ? link.text : link.href;
    lines.push(`${i + 1}. [${display}](${link.href})`);
    if (link.context) {
      lines.push(`   - 上下文: ${link.context}`);
    }
  });

  return lines.join('\n');
}
