import { parseHTML } from 'linkedom';

/**
 * 将 HTML 字符串解析为 Readability 可用的 DOM 环境
 * @param {string} html - 原始 HTML
 * @param {string} url - 页面 URL（用于 Readability 的 baseURI）
 * @returns {{ document: Document, window: Window }}
 */
export function createReadabilityEnv(html, url) {
  const { document, window } = parseHTML(html);

  // linkedom 默认不设置 baseURI，手动设置
  Object.defineProperty(document, 'baseURI', { value: url });

  // linkedom 的 window 已有 Node/HTMLElement/Document/DOMParser 等
  // Readability 需要的全局变量已存在，无需额外适配。

  return { document, window };
}

/**
 * 从 document 提取纯文本长度（用于估算字数）
 */
export function getTextLength(doc) {
  return doc?.textContent?.replace(/\s+/g, ' ').trim().length || 0;
}
