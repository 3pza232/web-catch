const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g;
const WORD = /[A-Za-z0-9][A-Za-z0-9'’._-]*/g;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * Normalize line endings, trim trailing spaces and collapse blank runs.
 * @param {string} text @returns {string}
 */
export function normalize(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Collapse whitespace. @param {string|null} value @returns {string} */
export function collapse(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Count text units: Latin words plus one unit per CJK character.
 * @param {string} text @returns {{ chars: number, words: number, cjk: number }}
 */
export function measure(text) {
  const cjk = text.match(CJK)?.length || 0;
  const latin = text.replace(CJK, ' ').match(WORD)?.length || 0;
  return { chars: text.length, words: latin + cjk, cjk };
}

/**
 * Keep at most `limit` characters, preferring a paragraph break.
 * @param {string} text @param {number} limit
 * @returns {{ text: string, truncated: boolean, chars: number }}
 */
export function truncate(text, limit) {
  const chars = text.length;
  if (chars <= limit) return { text, truncated: false, chars };
  const cut = text.slice(0, limit);
  const at = cut.lastIndexOf('\n\n');
  return { text: at > limit * 0.6 ? cut.slice(0, at) : cut, truncated: true, chars };
}

/**
 * Build a heading outline with per-section sizes.
 * Headings inside fenced code are ignored.
 * @param {string} markdown @param {number} [depth] - maximum heading level.
 * @returns {Array<{ level: number, title: string, chars: number }>}
 */
export function outline(markdown, depth = 3) {
  const sections = [];
  let fence = false;

  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      fence = !fence;
      continue;
    }
    if (fence) continue;

    const match = line.match(HEADING);
    if (!match) {
      if (sections.length) sections.at(-1).chars += line.length + 1;
      continue;
    }
    const level = match[1].length;
    if (level <= depth) sections.push({ level, title: match[2].trim(), chars: 0 });
  }
  return sections;
}
