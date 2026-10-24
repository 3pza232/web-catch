import { parseHTML } from 'linkedom';

/**
 * Build a DOM environment that Readability can operate on.
 * linkedom exposes no `defaultView`, so it is attached explicitly.
 * @param {string} html @param {string} url @returns {{ document: Document, window: Window }}
 */
export function createDom(html, url) {
  const { document, window } = parseHTML(html);
  Object.defineProperty(document, 'baseURI', { value: url });
  Object.defineProperty(document, 'defaultView', { value: window, configurable: true });
  return { document, window };
}
