import { CliError, upstreamError } from '../errors.mjs';
import { resolveApiKey, resolveBaseUrl } from '../config.mjs';
import { EXIT, DEEPSEEK_BASE_URL, DEFAULT_TIMEOUT_MS, DEFAULT_RETRIES, VERSION } from '../constants.mjs';

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/** setTimeout() overflows above this many milliseconds and fires immediately. */
const MAX_TIMER_MS = 2_147_483_647;

/** Status to human explanation for the Search/Fetch API. */
const EXPLAIN = {
  400: 'request rejected: invalid field or JSON',
  401: 'API key missing or invalid',
  402: 'account balance is insufficient',
  403: 'fetch denied by the upstream security policy',
  404: 'no extractable page content upstream',
  408: 'upstream timed out reading the request',
  413: 'request body too large',
  429: 'rate limit exceeded (Search 100 QPS, Fetch 25 QPS per account)',
};

/** @param {number} status @returns {boolean} whether the status is worth retrying. */
const retryable = (status) => RETRYABLE.has(status);

/**
 * Client for the DeepSeek Search and Fetch APIs.
 * Both endpoints are billed per successful request; see README.
 */
export class DeepSeekClient {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey] - defaults to $DEEPSEEK_API_KEY.
   * @param {string} [options.apiBase] - defaults to $DEEPSEEK_BASE_URL or the public base.
   * @param {number} [options.timeoutMs]
   * @param {number} [options.retries]
   */
  constructor(options = {}) {
    this.apiKey = resolveApiKey(options.apiKey);
    this.baseUrl = (resolveBaseUrl(options.apiBase) || DEEPSEEK_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    if (!this.apiKey) {
      throw new CliError('DeepSeek API key is required for this operation', {
        code: 'MISSING_API_KEY',
        exit: EXIT.UPSTREAM,
        hint: 'set DEEPSEEK_API_KEY, add {"apiKey": "..."} to ~/.web-catch/config.json, or set it in your user environment',
      });
    }
  }

  /**
   * POST /v1/tools/search.
   * @param {{ query: string, count?: number, oriQuestion?: string, localization?: string, needContent?: boolean }} input
   * @returns {Promise<Array<object>>} ranked results.
   */
  async search(input) {
    const body = {
      query: input.query,
      count: input.count,
      need_content: Boolean(input.needContent),
    };
    if (input.oriQuestion) body.ori_question = input.oriQuestion;
    if (input.localization) body.localization = input.localization;
    const data = await this.post('/v1/tools/search', body);
    if (data.results !== undefined && !Array.isArray(data.results)) {
      throw upstreamError('/v1/tools/search: unexpected response shape', 'UPSTREAM_SHAPE',
        'expected a "results" array');
    }
    return Array.isArray(data.results) ? data.results : [];
  }

  /**
   * POST /v1/tools/fetch.
   * @param {string} url @returns {Promise<{ title: string, content: string }>}
   */
  async fetchPage(url) {
    const data = await this.post('/v1/tools/fetch', { url });
    return { title: data.title || '', content: data.content || '' };
  }

  /**
   * Send one JSON request with retries.
   * @param {string} path @param {object} body @returns {Promise<any>}
   */
  async post(path, body) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** (attempt - 1), 4000)));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('timeout')), Math.min(this.timeoutMs, MAX_TIMER_MS));
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': `web-catch/${VERSION}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (response.ok) {
          const text = await response.text();
          try {
            return JSON.parse(text);
          } catch {
            // A malformed 200 is not transient: surface it instead of retrying.
            throw new CliError(`${path}: upstream returned malformed JSON`, {
              code: 'UPSTREAM_SHAPE',
              exit: EXIT.UPSTREAM,
              hint: 'the API response body was not valid JSON',
            });
          }
        }

        const detail = await response.text().catch(() => '');
        const explanation = EXPLAIN[response.status] || `HTTP ${response.status}`;
        const error = upstreamError(`${path}: ${explanation}`, `UPSTREAM_${response.status}`,
          extractMessage(detail));
        if (retryable(response.status) && attempt < this.retries) {
          lastError = error;
          continue;
        }
        throw error;
      } catch (error) {
        if (error instanceof CliError) throw error;
        lastError = new CliError(`${path}: ${error.message || error}`, {
          code: 'UPSTREAM_NETWORK',
          exit: EXIT.UPSTREAM,
        });
        if (attempt >= this.retries) break;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }
}

/** @param {string} text @returns {string} the upstream `error.message`, when present. */
function extractMessage(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message || '';
  } catch {
    return text.slice(0, 200);
  }
}
