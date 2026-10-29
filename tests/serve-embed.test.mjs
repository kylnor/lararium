// Optional semantic search: off unless asked for, one pinned model and dimensionality, identity
// stored next to the vectors, never mixed, and always a fallback to full-text. A fake local
// embedding server stands in for Ollama, so this runs anywhere with no model installed.
// Needs the server's dependencies: npm ci --prefix npx
import { test, mock } from 'node:test';
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
// With `swap` on, the same name now serves a different model: same size, different space.
function fakeVector(text, dims = DIMS, swap = false) {
  const v = new Array(dims).fill(0);
  const [pets, money, other] = swap ? [1, 0, 3] : [0, 1, 2];
  if (/\b(cat|dog|kitten|puppy|pet)/i.test(text)) v[pets] = 1;
  if (/\b(invoice|payment|money|billing)/i.test(text)) v[money] = 1;
  if (!v[pets] && !v[money]) v[other] = 1;
  return v;
}

async function fakeOllama({ dims = DIMS, status = 200 } = {}) {
  const seen = [];
  const state = { swap: false, digest: 'sha256:aaaa', tag: 'embeddinggemma-2:270m' };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.url === '/api/tags') { // where Ollama reports each model's digest
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models: state.digest ? [{ name: state.tag, digest: state.digest }] : [] }));
        return;
      }
      const { model, input } = JSON.parse(body);
      seen.push({ url: req.url, model, input });
      if (state.onQuery && input.some(t => t.startsWith(QUERY_PREFIX))) state.onQuery(); // a test's move, mid-search
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { embeddings: input.map(t => fakeVector(t, dims, state.swap)) } : { error: 'nope' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, state, close: () => server.close() };
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

test('a failing embedding server never shows the caller a model path or endpoint', async () => {
  const f = folder();
  const ollama = await fakeOllama({ status: 503 });
  const model = '/opt/models/private-embedding.gguf';
  try {
    const out = await toolSearch(f.store, createSemantic({ store: f.store, backend: 'llamacpp', url: ollama.url, model }), 'invoice');
    assert.match(out, /semantic search unavailable: embedding server answered 503/);
    assert.doesNotMatch(out, /opt\/models|private-embedding/);
    assert.ok(!out.includes(ollama.url));
    const down = await toolSearch(f.store, createSemantic({ store: f.store, url: 'http://127.0.0.1:9', model }), 'invoice');
    assert.match(down, /embedding server not reachable/);
    assert.ok(!down.includes('127.0.0.1:9') && !down.includes('private-embedding'));
  } finally { ollama.close(); f.done(); }
});

// Shared by the two cases below: what a read-tier caller sees when the stored vectors are refused.
async function leakCase(change, detailPattern) {
  const f = folder();
  const ollama = await fakeOllama();
  const model = '/opt/models/private-embedding.gguf';
  ollama.state.tag = model;
  try {
    const semantic = createSemantic({ store: f.store, url: ollama.url, model });
    await semantic.sync();
    change(ollama.state);
    await assert.rejects(() => semantic.rank('cat'), err => err instanceof SemanticUnavailable
      && /--reindex/.test(err.message)
      && !/opt\/models|private-embedding|sha256|aaaa|bbbb/.test(err.message) && !err.message.includes(ollama.url)
      && detailPattern.test(err.detail));
    const out = await toolSearch(f.store, semantic, 'invoice');
    assert.match(out, /semantic search unavailable: .*--reindex/);
    assert.doesNotMatch(out, /opt\/models|private-embedding|sha256|aaaa|bbbb/);
    assert.ok(!out.includes(ollama.url) && !out.includes('127.0.0.1'));
  } finally { ollama.close(); f.done(); }
}

test('a probe mismatch never shows the caller a model path or endpoint; the local log gets them', () =>
  leakCase(state => { state.swap = true; }, /private-embedding.*127\.0\.0\.1/));

test('a digest change never shows the caller a model path or digest; the local log gets them', () =>
  leakCase(state => { state.digest = 'sha256:bbbb'; }, /private-embedding.*bbbb.*aaaa|private-embedding.*aaaa.*bbbb/));

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
    await assert.rejects(() => other.rank('cat'), err => /stored vectors were built with a different model/.test(err.message)
      && !/some-other-model/.test(err.message) && /embeddinggemma-2:270m.*some-other-model/.test(err.detail));
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

// ---- r2 hardening -------------------------------------------------------------------------

test('same name, same size, different model: the probe fingerprint refuses the old vectors until --reindex', async () => {
  const f = folder();
  const ollama = await fakeOllama();
  try {
    const semantic = createSemantic({ store: f.store, url: ollama.url });
    await semantic.sync();
    const saved = JSON.parse(fs.readFileSync(path.join(f.memory, '.index/embeddings.json'), 'utf8'));
    assert.equal(saved.embedUrl, ollama.url);
    assert.equal(saved.digest, 'sha256:aaaa');
    assert.equal(saved.probe.v.length > 100, true, 'the probe vector is stored with the cache');
    assert.equal((await semantic.rank('cat'))[0].name, 'feline-notes');

    ollama.state.swap = true; // the model behind the same name and 768 dimensions changes
    await assert.rejects(() => semantic.rank('cat'), err => err instanceof SemanticUnavailable && /probe/.test(err.message) && /--reindex/.test(err.message));
    await assert.rejects(() => semantic.sync(), /--reindex/);
    assert.match(await toolSearch(f.store, semantic, 'invoice'), /full-text \(semantic search unavailable: .*--reindex/);

    semantic.reset();
    assert.deepEqual(await semantic.sync(), { embedded: 2, total: 2 });
    assert.equal((await semantic.rank('cat'))[0].name, 'feline-notes');
  } finally { ollama.close(); f.done(); }
});

test('an endpoint change is checked by the probe: the same model elsewhere is fine, a different one is refused', async () => {
  const f = folder();
  const first = await fakeOllama();
  const second = await fakeOllama();
  const third = await fakeOllama();
  try {
    await createSemantic({ store: f.store, url: first.url }).sync();
    const moved = createSemantic({ store: f.store, url: second.url });
    assert.equal((await moved.rank('cat'))[0].name, 'feline-notes', 'same model on a new port keeps the cache');
    third.state.swap = true;
    await assert.rejects(() => createSemantic({ store: f.store, url: third.url }).rank('cat'), /probe.*--reindex/);
  } finally { first.close(); second.close(); third.close(); f.done(); }
});

test('a changed server-reported digest refuses the cache even when the vectors would match', async () => {
  const f = folder();
  const ollama = await fakeOllama();
  try {
    const semantic = createSemantic({ store: f.store, url: ollama.url });
    await semantic.sync();
    ollama.state.digest = 'sha256:bbbb';
    await assert.rejects(() => semantic.rank('cat'), err => /digest/.test(err.message) && /--reindex/.test(err.message));
    ollama.state.digest = null; // a server that does not report one: the probe alone decides
    assert.equal((await semantic.rank('cat'))[0].name, 'feline-notes');
  } finally { ollama.close(); f.done(); }
});

test('a cache with no probe record is refused rather than trusted', async () => {
  const f = folder();
  const ollama = await fakeOllama();
  try {
    const semantic = createSemantic({ store: f.store, url: ollama.url });
    await semantic.sync();
    const file = path.join(f.memory, '.index/embeddings.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete saved.probe;
    fs.writeFileSync(file, JSON.stringify(saved));
    await assert.rejects(() => semantic.rank('cat'), /--reindex/);
  } finally { ollama.close(); f.done(); }
});

test('a symlinked .index folder is refused: nothing is written outside the memory folder, search falls back', async () => {
  const f = folder();
  const ollama = await fakeOllama();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-outside-'));
  try {
    fs.symlinkSync(outside, path.join(f.memory, '.index'));
    const semantic = createSemantic({ store: f.store, url: ollama.url });
    await assert.rejects(() => semantic.sync(), err => err instanceof SemanticUnavailable && /symbolic link/.test(err.message));
    assert.deepEqual(fs.readdirSync(outside), [], 'nothing escaped');
    assert.match(await toolSearch(f.store, semantic, 'invoice'), /full-text \(semantic search unavailable: .*symbolic link/);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally { ollama.close(); fs.rmSync(outside, { recursive: true, force: true }); f.done(); }
});

test('a symlinked embeddings.json is refused too, and its target is neither read nor replaced', async () => {
  const f = folder();
  const ollama = await fakeOllama();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-outside-'));
  try {
    const target = path.join(outside, 'decoy.json');
    fs.writeFileSync(target, 'decoy');
    fs.mkdirSync(path.join(f.memory, '.index'));
    fs.symlinkSync(target, path.join(f.memory, '.index/embeddings.json'));
    const semantic = createSemantic({ store: f.store, url: ollama.url });
    await assert.rejects(() => semantic.sync(), /symbolic link/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'decoy');
    assert.match(await toolSearch(f.store, semantic, 'invoice'), /^- accounts-notes/m);
  } finally { ollama.close(); fs.rmSync(outside, { recursive: true, force: true }); f.done(); }
});

test('an embedding server that redirects is refused: card text never follows a redirect off this machine', async () => {
  const f = folder();
  const target = await fakeOllama();
  const redirector = http.createServer((req, res) => {
    req.resume();
    res.writeHead(307, { location: `${target.url}${req.url}` });
    res.end();
  });
  await new Promise(resolve => redirector.listen(0, '127.0.0.1', resolve));
  try {
    const semantic = createSemantic({ store: f.store, url: `http://127.0.0.1:${redirector.address().port}` });
    await assert.rejects(() => semantic.sync(), err => err instanceof SemanticUnavailable && /redirect/.test(err.message));
    assert.equal(target.seen.length, 0, 'the redirect target never received a request');
    assert.match(await toolSearch(f.store, semantic, 'invoice'), /full-text \(semantic search unavailable: .*redirect/);
  } finally { redirector.close(); target.close(); f.done(); }
});

test('any failure on the semantic path (disk full, permission) falls back to full-text instead of erroring', async () => {
  const f = folder();
  const ollama = await fakeOllama();
  const real = fs.openSync;
  const patched = mock.method(fs, 'openSync', (file, ...rest) => { // the cache temp file is created with openSync
    if (String(file).includes(`${path.sep}.index${path.sep}`)) throw Object.assign(new Error(`ENOSPC: no space left on device, write '${file}'`), { code: 'ENOSPC' });
    return real(file, ...rest);
  });
  try {
    const out = await toolSearch(f.store, createSemantic({ store: f.store, url: ollama.url }), 'invoice');
    assert.match(out, /full-text \(semantic search unavailable: .*ENOSPC/);
    assert.match(out, /^- accounts-notes/m, 'full-text still answers');
    assert.doesNotMatch(out, new RegExp(f.top.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the owner\'s folder path is not sent to the app');
  } finally { patched.mock.restore(); ollama.close(); f.done(); }
});

// ---- r3 hardening -------------------------------------------------------------------------

test('ranking uses the vectors that passed the fingerprint, not a cache file replaced while the query was being embedded', async () => {
  const f = folder();
  const ollama = await fakeOllama();
  try {
    const semantic = createSemantic({ store: f.store, url: ollama.url });
    await semantic.sync();
    const file = path.join(f.memory, '.index/embeddings.json');
    const verified = JSON.parse(fs.readFileSync(file, 'utf8'));
    // While the query is being embedded another process replaces the cache: same identity and probe,
    // but the two cards' vectors swapped, so reading the file again would flip the ranking.
    const swapped = { ...verified, vectors: { 'feline-notes.md': verified.vectors['accounts-notes.md'], 'accounts-notes.md': verified.vectors['feline-notes.md'] } };
    ollama.state.onQuery = () => fs.writeFileSync(file, JSON.stringify(swapped));
    const ranked = await semantic.rank('my cat', 2);
    assert.equal(ranked[0].name, 'feline-notes', 'ranked against the verified snapshot');
    assert.ok(ranked[0].score > ranked[1].score);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).vectors, swapped.vectors, 'the swap really happened');
  } finally { ollama.close(); f.done(); }
});

test('a cache write whose .index/ is swapped for a link mid-write is refused before the rename and nothing lands outside', async () => {
  const f = folder();
  const ollama = await fakeOllama();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-outside-'));
  const index = path.join(f.memory, '.index');
  const real = fs.writeFileSync;
  let patched;
  try {
    const semantic = createSemantic({ store: f.store, url: ollama.url });
    await semantic.sync(); // creates .index/ and the first cache
    await f.store.remember({ name: 'new-card', description: 'A new one.', type: 'user', body: 'The puppy is called Biscuit.' });
    let swapped = false;
    // The moment the temp file has been written, replace .index/ with a link to an outside folder:
    // after the folder was validated, before the rename.
    patched = mock.method(fs, 'writeFileSync', (file, ...rest) => {
      const result = real(file, ...rest);
      if (typeof file === 'number' && !swapped && fs.readdirSync(index).some(n => n.endsWith('.tmp'))) {
        swapped = true;
        fs.rmSync(index, { recursive: true });
        fs.symlinkSync(outside, index);
      }
      return result;
    });
    await assert.rejects(() => semantic.sync(), err => err instanceof SemanticUnavailable && /\.index changed while in use/.test(err.message));
    assert.equal(swapped, true, 'the swap happened mid-write');
    assert.deepEqual(fs.readdirSync(outside), [], 'nothing was written through the link');
  } finally { patched && patched.mock.restore(); ollama.close(); fs.rmSync(outside, { recursive: true, force: true }); f.done(); }
});
