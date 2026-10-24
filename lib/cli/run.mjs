import { parseArgs } from './args.mjs';
import { HELP } from './help.mjs';
import { VERSION } from '../constants.mjs';

/**
 * Dispatch one command line. Command modules are imported lazily so flag-only
 * and single-command invocations do not load unrelated dependencies.
 * @param {string[]} argv - arguments after the executable.
 * @returns {Promise<void>}
 */
export async function run(argv) {
  // `--help` must win over unknown flags instead of parsing failing first.
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  const { command, args, options } = parseArgs(argv);

  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (options.mcp) {
    const { runMcpServer } = await import('../mcp.mjs');
    await runMcpServer();
    return;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === 'search') {
    const { searchCommand } = await import('../commands/search.mjs');
    await searchCommand(args, options);
    return;
  }
  const { fetchCommand } = await import('../commands/fetch.mjs');
  await fetchCommand(args, options);
}
