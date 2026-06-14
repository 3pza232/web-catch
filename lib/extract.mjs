import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { createReadabilityEnv } from './dom.mjs';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  bulletListMarker: '-',
});

turndown.addRule('codeBlock', {
  filter: ['pre', 'code'],
  replacement(_content, node) {
    const text = node.textContent || '';
    if (text.startsWith('```')) return text;
    const lang = node.className?.match(/language-(\w+)/)?.[1] || '';
    return '\n```' + lang + '\n' + text + '\n```\n';
  }
});

/**
 * 从 HTML 提取正文，返回 Markdown
 * @param {string} html - 原始 HTML
 * @param {string} url - 页面 URL
 * @returns {{ markdown: string, title: string, wordCount: number, success: boolean }}
 */
export function extractContent(html, url) {
  const { document, window } = createReadabilityEnv(html, url);

  // linkedom 的 document.defaultView 是 null，Readability 可能需要它
  Object.defineProperty(document, 'defaultView', { value: window, configurable: true });

  const reader = new Readability(document, { debug: false });
  const result = reader.parse();

  if (!result) {
    const bodyText = document.body?.textContent?.replace(/\s+/g, ' ').trim() || '';
    return {
      markdown: bodyText || '无法提取正文内容',
      title: document.title || url,
      wordCount: bodyText.split(/\s+/).length,
      success: false,
    };
  }

  const markdown = turndown.turndown(result.content);
  const wordCount = markdown.split(/\s+/).length;

  return {
    markdown,
    title: result.title || document.title || '',
    wordCount,
    success: true,
  };
}
