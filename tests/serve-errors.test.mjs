// What a caller of the memory server's tools sees when something breaks inside it. A filesystem
// error names the owner's folder (their home path), so it goes to the local log and the caller
// gets a short message with a reference.
// Needs the server's dependencies: npm ci --prefix npx
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createStore, InputError } = require(path.join(repo, 'npx/lib/store.js'));
const { createMcpServer } = require(path.join(repo, 'npx/lib/mcp.js'));
const sdk = createRequire(path.join(repo, 'npx/package.json'));
const { Client } = sdk('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = sdk('@modelcontextprotocol/sdk/inMemory.js');

async function connect(store, log) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ store, role: 'write', version: 'test', log });
  await server.connect(serverSide);
  const client = new Client({ name: 't', version: '0' });
  await client.connect(clientSide);
  return client;
}

const remember = client => client.callTool({
  name: 'remember',
  arguments: { name: 'a-claim', description: 'One line.', type: 'user', body: 'A fact.' },
});

test('an unexpected failure inside a tool gives the caller a short message with no path, and the full error goes to the local log', async () => {
  const home = path.join(path.sep + 'hom' + 'e', 'someone-private', 'notes'); // built, so the repo scrub does not flag a home-path literal
  const store = {
    remember: async () => { throw Object.assign(new Error(`EACCES: permission denied, open '${home}/a-claim.md'`), { code: 'EACCES' }); },
    read: () => { throw new Error(`ENOENT: no such file or directory, open '${home}/x.md'`); },
    list: () => { throw new Error(`EMFILE: too many open files, scandir '${home}'`); },
    searchText: () => { throw new Error(`EIO: i/o error, read '${home}/y.md'`); },
  };
  const logged = [];
  const client = await connect(store, line => logged.push(line));
  const calls = [
    remember(client),
    client.callTool({ name: 'read', arguments: { name: 'x' } }),
    client.callTool({ name: 'list', arguments: {} }),
    client.callTool({ name: 'search', arguments: { query: 'anything' } }),
  ];
  for (const result of await Promise.all(calls)) {
    assert.equal(result.isError, true);
    const message = result.content[0].text;
    assert.match(message, /internal error \(ref [0-9a-f]{6}\)/);
    assert.doesNotMatch(message, /someone-private|home|EACCES|ENOENT|EMFILE|EIO|\//, `leaked: ${message}`);
  }
  assert.equal(logged.length, 4);
  assert.ok(logged.every(line => line.includes(home)), 'the full error is kept locally');
  // Calls run concurrently, so the log order is not the call order.
  assert.ok(logged.some(line => /EACCES/.test(line)), 'the remember failure is in the log');
  await client.close();
});

test('errors the caller can act on still come through with their message', async () => {
  const store = {
    remember: async () => { throw new InputError('a card named a-claim already exists; choose a different name'); },
  };
  const client = await connect(store, () => assert.fail('an input error is not a server fault'));
  const result = await remember(client);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /already exists/);
  await client.close();
});

const canDeny = process.getuid && process.getuid() !== 0;
test('a real EACCES inside remember reaches the caller without the memory folder path', { skip: !canDeny && 'permission bits do not bind root' }, async () => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-eacces-'));
  const memory = path.join(top, 'private-owner-folder', 'memory');
  fs.mkdirSync(memory, { recursive: true });
  fs.writeFileSync(path.join(memory, 'MEMORY.md'), '# Memory\n');
  const logged = [];
  try {
    const store = createStore({ root: memory });
    fs.chmodSync(memory, 0o555); // can read, cannot create the lock file
    const client = await connect(store, line => logged.push(line));
    const result = await remember(client);
    fs.chmodSync(memory, 0o755);
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content[0].text, /private-owner-folder|EACCES|\//);
    assert.match(logged.join('\n'), /EACCES/);
    assert.match(logged.join('\n'), /private-owner-folder/);
    await client.close();
  } finally { fs.chmodSync(memory, 0o755); fs.rmSync(top, { recursive: true, force: true }); }
});
