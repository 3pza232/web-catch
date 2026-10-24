import { parseArgs } from './args.mjs';
import { HELP } from './help.mjs';
import { VERSION } from '../constants.mjs';
import { fetchCommand } from '../commands/fetch.mjs';
import { searchCommand } from '../commands/search.mjs';
import { runMcpServer } from '../mcp.mjs';

/**
 * Dispatch one command line.
 * @param {string[]} argv - arguments after the executable.
 * @returns {Promise<void>}
 */
export async function run(argv) {
  const { command, args, options } = parseArgs(argv);

  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (options.mcp) {
    await runMcpServer();
    return;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  await (command === 'search' ? searchCommand(args, options) : fetchCommand(args, options));
}
