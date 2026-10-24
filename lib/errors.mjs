import { EXIT } from './constants.mjs';

/** Error carrying a machine-readable code and the process exit code it maps to. */
export class CliError extends Error {
  /**
   * @param {string} message - user-facing message, printed without a stack.
   * @param {object} [options]
   * @param {string} [options.code] - stable error code for scripting.
   * @param {number} [options.exit] - process exit code.
   * @param {string} [options.hint] - actionable follow-up line.
   */
  constructor(message, { code = 'ERROR', exit = EXIT.NETWORK, hint = '' } = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exit = exit;
    this.hint = hint;
  }
}

/** @returns {CliError} invalid command-line usage. */
export const usageError = (message, hint = '') =>
  new CliError(message, { code: 'USAGE', exit: EXIT.USAGE, hint });

/** @returns {CliError} upstream API failure. */
export const upstreamError = (message, code, hint = '') =>
  new CliError(message, { code, exit: EXIT.UPSTREAM, hint });
