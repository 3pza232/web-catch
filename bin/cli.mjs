#!/usr/bin/env node
import { run } from '../lib/cli/run.mjs';
import { CliError } from '../lib/errors.mjs';

try {
  await run(process.argv.slice(2));
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
