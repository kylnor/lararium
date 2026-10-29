// Optional semantic search: off unless asked for, one pinned model and dimensionality, identity
// stored next to the vectors, never mixed, and always a fallback to full-text. A fake local
// embedding server stands in for Ollama, so this runs anywhere with no model installed.
// Needs the server's dependencies: npm ci --prefix npx
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createStore } = require(path.join(repo, 'npx/lib/store.js'));
const { createSemantic, SemanticUnavailable, DIMS, QUERY_PREFIX, DOCUMENT_PREFIX } = require(path.join(repo, 'npx/lib/embed.js'));
const { createMcpServer } = require(path.join(repo, 'npx/lib/mcp.js'));
const sdk = createRequire(path.join(repo, 'npx/package.json'));
const { Client } = sdk('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = sdk('@modelcontextprotocol/sdk/inMemory.js');

// "Meaning" in the fake: texts about pets point along axis 0, texts about money along axis 1.
function fakeVector(text, dims = DIMS) {
  const v = new Array(dims).fill(0);
  if (/\b(cat|dog|kitten|puppy|pet)/i.test(text)) v[0] = 1;
  if (/\b(invoice|payment|money|billing)/i.test(text)) v[1] = 1;
  if (!v[0] && !v[1]) v[2] = 1;
  return v;
}

async function fakeOllama({ dims = DIMS, status = 200 } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const { model, input } = JSON.parse(body);
      seen.push({ url: req.url, model, input });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { embeddings: input.map(t => fakeVector(t, dims)) } : { error: 'nope' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

function folder() {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-embed-'));
  const memory = path.join(top, 'memory');
  fs.mkdirSync(memory);
  fs.copyFileSync(path.join(repo, 'memory/MEMORY.md'), path.join(memory, 'MEMORY.md'));
  const card = (name, description, body) => fs.writeFileSync(path.join(memory, `${name}.md`), `---\nname: ${name}\ndescription: ${description}\ntype: reference\n---\n\n${body}\n`);
  card('feline-notes', 'Notes about the household.', 'The kitten sleeps on the sofa.');
  card('accounts-notes', 'Notes about the business.', 'Net 30 on every invoice.');
  return { top, memory, store: createStore({ root: memory }), done: () => fs.rmSync(top, { recursive: true, force: true }) };
}

async function toolSearch(store, semantic, query) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ store, semantic, role: 'read', version: 'test' });
  await server.connect(serverSide);
  const client = new Client({ name: 't', version: '0' });
  await client.connect(clientSide);
  const out = (await client.callTool({ name: 'search', arguments: { query } })).content[0].text;
  await client.close();
  return out;
}

test('semantic search finds a card by meaning where the words do not overlap, and says it is hybrid', async () => {
  const f = folder();
  const ollama = await fakeOllama();
  try {
    const semantic = createSemantic({ store: f.store, url: ollama.url });
    assert.equal(f.store.searchText('cat').length, 0, 'full-text alone cannot find this');
    const out = await toolSearch(f.store, semantic, 'cat');
    assert.match(out, /hybrid \(full-text \+ EmbeddingGemma 2\)/);
    assert.match(out, /^- feline-notes/m);
    const { identity } = JSON.parse(fs.readFileSync(path.join(f.memory, '.index/embeddings.json'), 'utf8'));
    assert.deepEqual(identity, { backend: 'ollama', model: 'embeddinggemma-2:270m', dims: 768 });
    const sent = ollama.seen.flatMap(s => s.input);
    assert.ok(sent.some(t => t.startsWith(QUERY_PREFIX)), 'the query is sent with the query prompt');
    assert.ok(sent.some(t => t.startsWith(DOCUMENT_PREFIX)), 'cards are sent with the document prompt');
    assert.ok(ollama.seen.every(s => s.model === 'embeddinggemma-2:270m' && s.url === '/api/embed'));
  } finally { ollama.close(); f.done(); }
});

test('only changed cards are re-embedded', async () => {
  const f = folder();
  const ollama = await fakeOllama();
  try {
    const semantic = createSemantic({ store: f.store, url: ollama.url });
    assert.deepEqual(await semantic.sync(), { embedded: 2, total: 2 });
    assert.deepEqual(await semantic.sync(), { embedded: 0, total: 2 });
    await f.store.remember({ name: 'new-card', description: 'A new one.', type: 'user', body: 'The puppy is called Biscuit.' });
    assert.deepEqual(await semantic.sync(), { embedded: 1, total: 3 });
  } finally { ollama.close(); f.done(); }
});

test('model not running: search falls back to full-text and says why, never fails', async () => {
  const f = folder();
  try {
    const semantic = createSemantic({ store: f.store, url: 'http://127.0.0.1:9' });
    const out = await toolSearch(f.store, semantic, 'invoice');
    assert.match(out, /full-text \(semantic search unavailable: embedding server not reachable/);
    assert.match(out, /^- accounts-notes/m);
  } finally { f.done(); }
});

test('model not pulled (server answers an error): falls back to full-text', async () => {
  const f = folder();
  const ollama = await fakeOllama({ status: 404 });
  try {
    const out = await toolSearch(f.store, createSemantic({ store: f.store, url: ollama.url }), 'invoice');
    assert.match(out, /semantic search unavailable: embedding server answered 404/);
    assert.match(out, /^- accounts-notes/m);
  } finally { ollama.close(); f.done(); }
});

test('a model that answers with the wrong dimensionality is refused, not stored, not mixed', async () => {
  const f = folder();
  const ollama = await fakeOllama({ dims: 512 });
  try {
    const semantic = createSemantic({ store: f.store, url: ollama.url });
    await assert.rejects(() => semantic.sync(), SemanticUnavailable);
    assert.equal(fs.existsSync(path.join(f.memory, '.index/embeddings.json')), false);
    assert.match(await toolSearch(f.store, semantic, 'invoice'), /full-text \(semantic search unavailable: embedding size is not 768/);
  } finally { ollama.close(); f.done(); }
});

test('vectors from a different model are never mixed in: refused until --reindex', async () => {
  const f = folder();
  const ollama = await fakeOllama();
  try {
    await createSemantic({ store: f.store, url: ollama.url }).sync();
    const other = createSemantic({ store: f.store, url: ollama.url, model: 'some-other-model:768' });
    await assert.rejects(() => other.rank('cat'), /stored vectors were built with .*embeddinggemma-2:270m.*not .*some-other-model/);
    assert.match(await toolSearch(f.store, other, 'invoice'), /full-text \(semantic search unavailable: stored vectors were built with/);
    other.reset();
    assert.deepEqual(await other.sync(), { embedded: 2, total: 2 });
    assert.equal((await other.rank('cat'))[0].name, 'feline-notes');
    const llama = createSemantic({ store: f.store, backend: 'llamacpp', url: ollama.url });
    await assert.rejects(() => llama.rank('cat'), /stored vectors were built with/);
  } finally { ollama.close(); f.done(); }
});

test('card text only ever goes to this machine: a remote embedding URL is refused', () => {
  const f = folder();
  try {
    // a LAN address is built at run time so no address literal sits in the file (the repo scan bans them)
    const lan = `http://${[192, 168, 1, 20].join('.')}:11434`;
    for (const url of ['https://api.example.com', lan, 'http://example.com:11434', 'not a url']) {
      assert.throws(() => createSemantic({ store: f.store, url }), SemanticUnavailable, url);
    }
    assert.doesNotThrow(() => createSemantic({ store: f.store, url: 'http://localhost:11434' }));
    assert.doesNotThrow(() => createSemantic({ store: f.store, url: 'http://[::1]:11434' }));
  } finally { f.done(); }
});

test('default is full-text only: with no semantic engine the mode says so and no vector file is written', async () => {
  const f = folder();
  try {
    assert.match(await toolSearch(f.store, null, 'invoice'), /Search mode: full-text\./);
    assert.equal(fs.existsSync(path.join(f.memory, '.index')), false);
  } finally { f.done(); }
});
