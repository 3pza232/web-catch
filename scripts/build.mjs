#!/usr/bin/env node
/** Compile the CLI into a single executable with Bun. */
import { spawnSync } from 'node:child_process';

const result = spawnSync('bun', [
  'build',
  '--compile',
  '--minify',
  'bin/cli.mjs',
  '--outfile',
  'web-catch.exe',
], { stdio: 'inherit', shell: process.platform === 'win32' });

if (result.error) {
  process.stderr.write(`build failed: ${result.error.message}\n`);
  process.stderr.write('install Bun first: https://bun.sh\n');
  process.exit(1);
}
process.exit(result.status ?? 0);
