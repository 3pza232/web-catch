import { TextDecoder } from 'util';

const DEFAULT_TIMEOUT = 10_000;

export class FetchError extends Error {
  constructor(message, { status, statusText, body } = {}) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

/**
 * 获取页面 HTML
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeout=10000] - 超时毫秒
 * @param {string} [options.userAgent] - 自定义 UA
 * @returns {Promise<{ html: string, url: string, contentType: string }>}
 */
export async function fetchPage(url, options = {}) {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout')), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': options.userAgent || 'web-catch/0.1.0',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || '';
    const status = response.status;

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new FetchError(
        `HTTP ${status}: ${response.statusText}`,
        { status, statusText: response.statusText, body: body.slice(0, 500) }
      );
    }

    const buffer = await response.arrayBuffer();
    const html = decodeHTML(buffer, contentType);

    return {
      html,
      url: response.url,
      contentType,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 根据 Content-Type 或 BOM 检测编码并解码
 */
function decodeHTML(buffer, contentType) {
  const charsetMatch = contentType.match(/charset=([^;]+)/i);
  let encoding = charsetMatch ? charsetMatch[1].trim().toLowerCase() : null;

  if (!encoding) {
    const firstBytes = new Uint8Array(buffer.slice(0, 4));
    if (firstBytes[0] === 0x00 && firstBytes[1] === 0x00 && firstBytes[2] === 0xFE && firstBytes[3] === 0xFF) {
      encoding = 'utf-32be';
    } else if (firstBytes[0] === 0xFF && firstBytes[1] === 0xFE && firstBytes[2] === 0x00 && firstBytes[3] === 0x00) {
      encoding = 'utf-32le';
    } else if (firstBytes[0] === 0xFE && firstBytes[1] === 0xFF) {
      encoding = 'utf-16be';
    } else if (firstBytes[0] === 0xFF && firstBytes[1] === 0xFE) {
      encoding = 'utf-16le';
    } else if (firstBytes[0] === 0xEF && firstBytes[1] === 0xBB && firstBytes[2] === 0xBF) {
      encoding = 'utf-8';
    }
  }

  if (!encoding) {
    encoding = 'utf-8';
  }

  try {
    const decoder = new TextDecoder(encoding, { fatal: false });
    return decoder.decode(buffer);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }
}
