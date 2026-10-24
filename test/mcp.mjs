#!/usr/bin/env node
/** MCP handshake test; pass --live to exercise a real tools/call. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const useExe = process.argv.includes('--exe');
const child = useExe
  ? spawn('web-catch.exe', ['--mcp'], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env } })
  : spawn(process.execPath, ['bin/cli.mjs', '--mcp'], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env } });

let buffer = '';
const pending = new Map();
const failures = [];

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      failures.push(`non-JSON stdout: ${line.slice(0, 120)}`);
      continue;
    }
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  }
});

/** @param {string} method @param {object} [params] @param {number} id @returns {Promise<object>} */
function call(method, params, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 20_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

try {
  const init = await call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'web-catch-test', version: '1.0.0' },
  }, 1);
  assert.equal(init.result?.serverInfo?.name, 'web-catch');
  console.log('ok   initialize:', init.result.serverInfo.version);

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const list = await call('tools/list', {}, 2);
  const names = (list.result?.tools || []).map((tool) => tool.name).sort();
  assert.deepEqual(names, ['fetch', 'search']);
  console.log('ok   tools/list:', names.join(', '));

  if (process.argv.includes('--live')) {
    const result = await call('tools/call', { name: 'fetch', arguments: { url: 'https://example.com', maxChars: 500 } }, 3);
    const text = result.result?.content?.[0]?.text || '';
    assert.ok(text.includes('http'), 'fetch returned no metadata header');
    assert.ok(!result.result.isError, `fetch failed: ${text}`);
    console.log('ok   tools/call fetch:', text.length, 'chars');

    const search = await call('tools/call', { name: 'search', arguments: { query: 'web-catch cli', count: 2 } }, 4);
    assert.ok(!search.result?.isError, `search failed: ${search.result?.content?.[0]?.text}`);
    console.log('ok   tools/call search');
  }

  assert.deepEqual(failures, []);
  console.log('\nMCP OK');
} catch (error) {
  console.error('MCP FAILED:', error.message);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  child.kill();
}
