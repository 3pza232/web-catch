import { writeFile } from 'node:fs/promises';
import { CliError } from './errors.mjs';
import { EXIT } from './constants.mjs';

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
  try {
    await writeFile(target, output, 'utf8');
  } catch (error) {
    throw new CliError(`cannot write output file "${target}": ${error.message}`, {
      code: 'OUTPUT_WRITE',
      exit: EXIT.USAGE,
      hint: 'check that the directory exists and is writable',
    });
  }
}

/**
 * Serialize a value as pretty JSON.
 * @param {unknown} value @returns {string}
 */
export const toJson = (value) => JSON.stringify(value, null, 2);
