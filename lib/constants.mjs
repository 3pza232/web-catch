/** Shared constants: version, defaults, exit codes, content-type classes. */

export const VERSION = '0.3.1';

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_RETRIES = 2;
export const DEFAULT_MAX_CHARS = 60_000;
export const DEFAULT_LINK_LIMIT = 50;
export const DEFAULT_SEARCH_COUNT = 10;
export const DEFAULT_USER_AGENT = `web-catch/${VERSION}`;
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/** Process exit codes, documented in README and SKILL.md. */
export const EXIT = {
  OK: 0,
  NETWORK: 1,
  EXTRACT: 2,
  USAGE: 3,
  UPSTREAM: 4,
};

/** Content types handled as markup and reduced to article markdown. */
export const HTML_TYPES = /^(text\/html|application\/xhtml\+xml|text\/xml)$/i;

/** Content types passed through verbatim after decoding. */
export const PASSTHROUGH_TYPES = /^(application\/(json|[\w.+-]*\+json|xml|[\w.+-]*\+xml|yaml|x-yaml)|text\/(plain|markdown|csv|xml|yaml|x-yaml))/i;

export const PDF_TYPE = /^application\/pdf$/i;

/** Tracking query parameters stripped before deduplicating links. */
export const TRACKING_PARAMS = /^(utm_[a-z]+|spm|scm|ref|ref_src|from|share_token|share_source|fbclid|gclid|igshid|mc_cid|mc_eid)$/i;
