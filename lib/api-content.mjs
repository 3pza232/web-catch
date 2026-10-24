/**
 * Normalization for content returned by the DeepSeek Fetch API.
 *
 * The upstream endpoint accepts only `url`; it may return concatenated
 * language variants, and it escapes Markdown punctuation. Both are
 * presentation artifacts for an agent, so they are normalized here instead of
 * in the transport layer. The upstream response is also capped at roughly
 * 2500 characters, independently of `maxChars`.
 */

/** Languages with a dedicated script; the value is the script key. */
const SCRIPT_LANGUAGES = {
  zh: 'han',
  ja: 'kana',
  ko: 'hangul',
  ru: 'cyrillic',
  ar: 'arabic',
  el: 'greek',
  he: 'hebrew',
  hi: 'devanagari',
  th: 'thai',
};

/** Latin-script languages detected by function-word frequency. */
const LATIN_STOPWORDS = {
  en: 'the and of to in is that for it as with be this on are or by not from at a an'.split(' '),
  fr: 'le la les des du de et est pour dans un une que qui pas au sur avec ce'.split(' '),
  de: 'der die und das ist nicht ein eine zu den von mit sich auf für im dem'.split(' '),
  es: 'el la los las de y que en un una es por con para del se al no'.split(' '),
  pt: 'o a os as de e que em um uma é do da para com não por se'.split(' '),
  it: 'il lo la gli le di e che in un una è del della per con non si'.split(' '),
};

const LATIN_LANGUAGES = new Set(Object.keys(LATIN_STOPWORDS));

const SCRIPT_PATTERNS = {
  han: /[\u3400-\u4dbf\u4e00-\u9fff]/g,
  kana: /[\u3040-\u30ff]/g,
  hangul: /[\uac00-\ud7af]/g,
  arabic: /[\u0600-\u06ff]/g,
  cyrillic: /[\u0400-\u04ff]/g,
  greek: /[\u0370-\u03ff]/g,
  hebrew: /[\u0590-\u05ff]/g,
  devanagari: /[\u0900-\u097f]/g,
  thai: /[\u0e00-\u0e7f]/g,
};

const LETTER = /[\p{L}]/gu;

/** @param {string} text @param {RegExp} pattern @returns {number} */
const countScript = (text, pattern) => (text.match(pattern) || []).length;

/**
 * Detect the dominant language of a text fragment.
 * Non-Latin scripts need a 15% share of all letters to avoid classifying an
 * English sentence that quotes a few foreign characters.
 * @param {string} text @returns {string} language code, or '' when unknown.
 */
export function detectLanguage(text) {
  const source = String(text || '');
  if (!source.trim()) return '';
  const letters = (source.match(LETTER) || []).length;
  if (!letters) return '';
  const counts = {};
  for (const [script, pattern] of Object.entries(SCRIPT_PATTERNS)) {
    counts[script] = countScript(source, pattern);
  }
  const dominant = Object.entries(SCRIPT_LANGUAGES)
    .map(([lang, script]) => ({ lang, count: counts[script] }))
    .filter((item) => item.count >= 3 && item.count / letters >= 0.15)
    .sort((a, b) => b.count - a.count)[0];
  if (dominant) return dominant.lang;
  return detectLatin(source, letters);
}

/**
 * Score Latin-script text against function-word lists of common languages.
 * Two matching function words are required so a single "a" cannot make a
 * short English block look Portuguese.
 * @param {string} text @param {number} letters @returns {string}
 */
function detectLatin(text, letters) {
  const words = text.toLowerCase().match(/[a-zà-ÿ]+/g) || [];
  if (words.length < 2) return '';
  let best = '';
  let bestScore = 0;
  for (const [lang, stopwords] of Object.entries(LATIN_STOPWORDS)) {
    const set = new Set(stopwords);
    const score = words.reduce((total, word) => total + (set.has(word) ? 1 : 0), 0);
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return bestScore >= 2 && bestScore / words.length >= 0.08 ? best : '';
}

/**
 * Keep only the parts of the content written in `lang`. `auto` uses the title
 * language and falls back to the majority language of the body when the title
 * is too short to classify. Code blocks and blocks of unknown language are
 * kept; filtering never returns an empty document.
 * @param {string} content @param {string} lang @param {string} [title]
 * @returns {string}
 */
export function filterLanguages(content, lang, title = '') {
  const source = String(content);
  const target = lang === 'auto' ? autoLanguage(source, title) : lang.toLowerCase().split('-')[0];
  if (!target) return source;
  // The upstream truncation cap can cut a fenced block in half; filtering the
  // remaining code as prose could delete it, so leave such content untouched.
  const fences = source.split('\n').filter((line) => /^\s*(`{3,}|~{3,})/.test(line)).length;
  if (fences % 2 === 1) return source;
  const parts = source.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/);
  const filtered = parts.map((part, index) => {
    if (index % 2 === 1) return part;
    return part.split(/\n{2,}/).filter((block) => {
      if (!block.trim()) return true;
      const detected = detectLanguage(block);
      return !detected || detected === target;
    }).join('\n\n');
  }).join('');
  return filtered.trim() ? filtered : source;
}

/**
 * @param {string} content @param {string} title @returns {string} language to keep.
 */
function autoLanguage(content, title) {
  const titleLang = detectLanguage(title);
  if (titleLang) return titleLang;
  const detected = String(content)
    .split(/\n{2,}/)
    .map((block) => detectLanguage(block))
    .filter(Boolean);
  if (!detected.length) return '';
  const counts = new Map();
  for (const lang of detected) counts.set(lang, (counts.get(lang) || 0) + 1);
  const [lang, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return count * 2 > detected.length ? lang : '';
}

/**
 * Remove rendering-equivalent punctuation escapes without touching fenced
 * blocks, inline code, or ordered-list markers such as `1\.`.
 * @param {string} content @returns {string}
 */
export function unescapePunctuation(content) {
  const lines = String(content).split('\n');
  let fence = '';
  return lines.map((line) => {
    const opening = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (opening && opening[1][0] === fence[0] && opening[1].length >= fence.length) fence = '';
      return line;
    }
    if (opening) {
      fence = opening[1];
      return line;
    }
    return unescapeLine(line);
  }).join('\n');
}

/**
 * @param {string} line @returns {string}
 */
function unescapeLine(line) {
  return line
    .split(/(`[^`\n]*`)/g)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(/\\([.,;:!?'"/()])/g, (match, char, offset) => {
        if (char === '.' && /^\s*\d+$/.test(part.slice(0, offset))) return match;
        return char;
      });
    })
    .join('');
}

/**
 * Normalize Fetch API content for agent consumption.
 * @param {string} content
 * @param {{ lang?: string, title?: string, unescape?: boolean }} [options]
 * @returns {string}
 */
export function normalizeApiContent(content, options = {}) {
  const source = String(content || '');
  const filtered = options.lang ? filterLanguages(source, options.lang, options.title) : source;
  return options.unescape === false ? filtered : unescapePunctuation(filtered);
}

/** Languages accepted by the `apiLang` option. */
export const SUPPORTED_API_LANGS = ['auto', ...LATIN_LANGUAGES, ...Object.keys(SCRIPT_LANGUAGES)];
