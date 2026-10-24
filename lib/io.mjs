import { writeFile } from 'node:fs/promises';

/**
 * Emit text to stdout or a file.
 * @param {string} text @param {string|undefined} target - file path, or undefined for stdout.
 * @returns {Promise<void>}
 */
export async function emit(text, target) {
  const output = text.endsWith('\n') ? text : `${text}\n`;
  if (!target) {
    process.stdout.write(output);
    return;
  }
  await writeFile(target, output, 'utf8');
}

/**
 * Serialize a value as pretty JSON.
 * @param {unknown} value @returns {string}
 */
export const toJson = (value) => JSON.stringify(value, null, 2);
