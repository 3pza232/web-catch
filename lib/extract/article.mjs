import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { createDom } from './dom.mjs';
import { normalize, measure } from '../text.mjs';

/** Reusable converter: ATX headings, fenced code, GFM tables and strikethrough. */
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  hr: '---',
});

turndown.use(gfm);
turndown.addRule('fencedCode', {
  filter: (node) => node.nodeName === 'PRE' && node.firstChild?.nodeName === 'CODE',
  replacement: (_content, node) => {
    const code = node.textContent.replace(/\n$/, '');
    const language = node.firstChild.className?.match(/language-([\w-]+)/)?.[1] || '';
    return `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
  },
});

/**
 * Extract the main article as Markdown.
 * Falls back to normalized body text when Readability cannot decide.
 * @param {string} html @param {string} url
 * @returns {{ markdown: string, title: string, stats: object, extracted: boolean, reason?: string }}
 */
export function extractArticle(html, url) {
  const { document } = createDom(html, url);
  // Empty or non-markup input leaves linkedom without a documentElement.
  const titleOf = () => {
    try {
      return (document.title || document.querySelector('title')?.textContent || '').trim();
    } catch {
      return '';
    }
  };

  let parsed = null;
  try {
    parsed = new Readability(document, { charThreshold: 200, keepClasses: true }).parse();
  } catch {
    parsed = null;
  }

  if (parsed?.content) {
    const markdown = normalize(turndown.turndown(parsed.content));
    if (markdown.length < 300) {
      return {
        markdown,
        title: (parsed.title || titleOf()).trim(),
        stats: measure(markdown),
        extracted: false,
        reason: 'very short extraction (link hub, paywall or SPA)',
      };
    }
    return {
      markdown,
      title: (parsed.title || titleOf()).trim(),
      stats: measure(markdown),
      extracted: true,
    };
  }

  let text = '';
  try {
    if (document.documentElement) text = normalize(document.body?.textContent || '');
  } catch {
    text = '';
  }
  return {
    markdown: text,
    title: titleOf(),
    stats: measure(text),
    extracted: false,
    reason: 'readability could not isolate an article (SPA or non-article layout)',
  };
}
