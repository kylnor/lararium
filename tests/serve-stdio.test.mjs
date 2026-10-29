// `npx lararium serve --stdio` end to end: the real CLI entry point, launched the way Claude
// Desktop launches it, spoken to with the official MCP client. Also pins that stdout carries only
// protocol (a stray log line there would corrupt the stream) and that scaffolding still works
// without the server's dependencies being loaded.
// Needs the server's dependencies: npm ci --prefix npx
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(repo, 'npx/index.js');
const sdk = createRequire(path.join(repo, 'npx/package.json'));
const { Client } = sdk('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = sdk('@modelcontextprotocol/sdk/client/stdio.js');

function memoryFolder() {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-stdio-'));
  const memory = path.join(top, 'memory');
  fs.mkdirSync(memory);
  fs.copyFileSync(path.join(repo, 'memory/MEMORY.md'), path.join(memory, 'MEMORY.md'));
  return { top, memory, done: () => fs.rmSync(top, { recursive: true, force: true }) };
}

async function open(memory, extra = []) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry, 'serve', '--stdio', '--memory', memory, ...extra], stderr: 'pipe' }));
  return client;
}

test('stdio: a fact written to the files is found, a fact saved over stdio lands in the files', async () => {
  const f = memoryFolder();
  try {
    fs.writeFileSync(path.join(f.memory, 'launch-codename.md'), '---\nname: launch-codename\ndescription: The launch codename is bluefin.\ntype: project\n---\n\nbluefin, decided 2026-10-01.\n');
    const client = await open(f.memory);
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['list', 'read', 'remember', 'search']);
    assert.match((await client.callTool({ name: 'search', arguments: { query: 'what do you remember about bluefin' } })).content[0].text, /launch-codename/);
    const saved = await client.callTool({ name: 'remember', arguments: { name: 'owner-prefers-tea', description: 'The owner prefers tea.', type: 'user', body: 'Tea, not coffee.' } });
    assert.notEqual(saved.isError, true, saved.content[0].text);
    assert.equal((await client.callTool({ name: 'read', arguments: { name: '../outside' } })).isError, true);
    await client.close();
    assert.match(fs.readFileSync(path.join(f.memory, 'owner-prefers-tea.md'), 'utf8'), /Tea, not coffee\./);
    assert.match(fs.readFileSync(path.join(f.memory, 'MEMORY.md'), 'utf8'), /- owner-prefers-tea\.md - The owner prefers tea\./);
  } finally { f.done(); }
});

test('stdio --read-only does not offer remember', async () => {
  const f = memoryFolder();
  try {
    const client = await open(f.memory, ['--read-only']);
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['list', 'read', 'search']);
    await client.close();
  } finally { f.done(); }
});

test('serve --help and bad input finish cleanly, and requiring the scaffolder loads no MCP code', () => {
  const loaded = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(entry)}); console.log(Object.keys(require.cache).some(k => k.includes('modelcontextprotocol') || k.includes('serve.js')))`], { encoding: 'utf8' });
  assert.equal(loaded.stdout.trim(), 'false');
  const help = spawnSync(process.execPath, [entry, 'serve', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /lararium serve/);
  const missing = spawnSync(process.execPath, [entry, 'serve', '--stdio', '--memory', path.join(os.tmpdir(), 'no-such-memory-folder')], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /memory folder not found/);
  const bad = spawnSync(process.execPath, [entry, 'serve', '--bogus'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown argument/);
});

test('token commands: created private (0600), stable between runs, rotated on request, read and write differ', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-tokens-'));
  const env = { ...process.env, LARARIUM_SERVE_HOME: home, LARARIUM_READ_TOKEN: '', LARARIUM_WRITE_TOKEN: '' };
  const parse = out => Object.fromEntries(out.trim().split('\n').map(l => l.split(/:\s+/)));
  try {
    const first = spawnSync(process.execPath, [entry, 'serve', '--print-tokens'], { encoding: 'utf8', env });
    const a = parse(first.stdout);
    assert.match(a.read, /^lrr_/);
    assert.match(a.write, /^lrw_/);
    assert.notEqual(a.read, a.write);
    assert.equal(fs.statSync(path.join(home, 'serve.json')).mode & 0o777, 0o600);
    assert.deepEqual(parse(spawnSync(process.execPath, [entry, 'serve', '--print-tokens'], { encoding: 'utf8', env }).stdout), a);
    const rotated = parse(spawnSync(process.execPath, [entry, 'serve', '--rotate-tokens'], { encoding: 'utf8', env }).stdout);
    assert.notEqual(rotated.read, a.read);
    assert.notEqual(rotated.write, a.write);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
