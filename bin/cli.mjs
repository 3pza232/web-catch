#!/usr/bin/env node
import { CliError } from '../lib/errors.mjs';

// A closed downstream pipe (`web-catch ... | head`) is not an error.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const argv = process.argv.slice(2);

// Fast paths avoid loading the extraction stack for flag-only invocations.
if (argv.includes('--version') || argv.includes('-v')) {
  const { VERSION } = await import('../lib/constants.mjs');
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}
if (argv.includes('--help') || argv.includes('-h')) {
  const { HELP } = await import('../lib/cli/help.mjs');
  process.stdout.write(HELP);
  process.exit(0);
}

const { run } = await import('../lib/cli/run.mjs');

try {
  await run(argv);
} catch (error) {
  if (error instanceof CliError) {
    process.stderr.write(`error: ${error.message}\n`);
    if (error.hint) process.stderr.write(`  ${error.hint}\n`);
    process.exitCode = error.exit;
  } else {
    process.stderr.write(`error: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
