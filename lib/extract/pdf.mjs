import { extractText } from 'unpdf';
import { normalize } from '../text.mjs';

/**
 * Extract text from a PDF body.
 * @param {Uint8Array} bytes - raw PDF bytes.
 * @returns {Promise<{ text: string, pages: number }>}
 */
export async function extractPdf(bytes) {
  const { totalPages, text } = await extractText(new Uint8Array(bytes), { mergePages: true });
  return { text: normalize(text), pages: totalPages };
}
