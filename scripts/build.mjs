#!/usr/bin/env node
/** Compile the CLI into a single executable with Bun. */
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';

/**
 * Bun writes a `<hash>.bun-build` copy next to the output and removes it on
 * success. A failed replace (for example a locked executable) leaves it behind.
 */
function cleanStaleArtifacts() {
  for (const name of readdirSync('.')) {
    if (!name.endsWith('.bun-build')) continue;
    rmSync(name, { force: true });
    process.stderr.write(`removed stale build artifact: ${name}\n`);
  }
}

cleanStaleArtifacts();

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

if ((result.status ?? 0) !== 0) {
  cleanStaleArtifacts();
  process.stderr.write(
    'build failed. If web-catch.exe is locked, stop the running MCP server first ' +
    '(set disabled: true on its row, wait for the process to exit, then rebuild).\n',
  );
}

process.exit(result.status ?? 0);
