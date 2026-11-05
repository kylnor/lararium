// Card states, owner-held changes and read tracking. Set LARARIUM_TEST_LIB to a copied older lib
// directory to prove these regressions fail there, without changing the checkout under test.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = process.env.LARARIUM_TEST_LIB || path.join(repo, 'npx/lib');
const { createStore, parseJournal } = createRequire(import.meta.url)(path.join(lib, 'store.js'));
const fact = (name, extra = {}) => ({ name, description: `${name} preference.`, type: 'feedback', body: `${name} is the selected setting.`, relation: 'new', ...extra });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-contested-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'MEMORY.md'), '# Memory\n');
  const store = createStore({ root, ...options });
  const bytes = (name, held = false) => fs.readFileSync(path.join(root, held ? '_held' : '', `${name}.md`));
  const card = (name, held = false) => held ? store.list({ status: 'held' }).find(c => c.name === name) : store.loadCard(`${name}.md`);
  return { root, store, bytes, card, index: () => fs.readFileSync(path.join(root, 'MEMORY.md'), 'utf8') };
}

async function conflict(f, extra = {}) {
  await f.store.remember(fact('tea', { origin: 'agent' }));
  return f.store.remember(fact('coffee', { relation: 'conflicts_with', target: 'tea', ...extra }));
}

test('explicit conflict marks both cards contested and retains both index lines', async t => {
  const f = fixture(t);
  await conflict(f);
  assert.equal(f.card('tea').status, 'contested');
  assert.equal(f.card('coffee').status, 'contested');
  assert.deepEqual(f.card('tea').conflicts_with, ['coffee']);
  assert.deepEqual(f.card('coffee').conflicts_with, ['tea']);
  assert.equal(f.store.list({ status: 'contested' }).length, 2);
  assert.match(f.index(), /- tea.md/);
  assert.match(f.index(), /- coffee.md/);
});

test('an agent superseding user evidence is held and the user card hash and root files stay unchanged', async t => {
  const f = fixture(t);
  await f.store.remember(fact('tea', { origin: 'user' }));
  const before = Object.fromEntries(fs.readdirSync(f.root).map(n => [n, hash(fs.readFileSync(path.join(f.root, n)))]));
  const result = await f.store.remember(fact('coffee', { relation: 'supersedes', target: 'tea', origin: 'agent' }));
  assert.equal(result.held, true);
  for (const [n, checksum] of Object.entries(before)) assert.equal(hash(fs.readFileSync(path.join(f.root, n))), checksum);
  assert.match(f.bytes('coffee', true).toString(), /relation: supersedes\ntarget: tea/);
  assert.equal(f.store.list().length, 1);
  assert.equal(f.store.list({ status: 'held' }).length, 1);
  assert.equal(f.store.searchText('coffee').length, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'coffee.md')), false);
});

test('resolve makes one contested card active and supersedes the other with the reason', async t => {
  const f = fixture(t);
  await conflict(f);
  const body = f.card('tea').body;
  await f.store.resolve({ winner: 'coffee', loser: 'tea', reason: 'Owner confirmed: coffee # today' });
  assert.equal(f.store.list({ status: 'active' }).length, 1);
  assert.equal(f.store.list({ status: 'superseded' }).length, 1);
  assert.equal(f.card('tea').superseded_by, 'coffee');
  assert.equal(f.card('tea').resolved_reason, 'Owner confirmed: coffee # today');
  assert.equal(f.card('tea').body, body);
  assert.deepEqual(f.card('tea').conflicts_with, []);
  assert.deepEqual(f.card('coffee').conflicts_with, []);
  assert.doesNotMatch(f.index(), /- tea.md/);
  assert.match(fs.readFileSync(path.join(f.root, 'DEMOTED.md'), 'utf8'), /- tea.md - superseded by coffee.md/);
});

test('read leaves card bytes unchanged and records time in the atomic sidecar', async t => {
  const f = fixture(t);
  await f.store.remember(fact('tea'));
  const before = hash(f.bytes('tea'));
  f.store.read('tea');
  assert.equal(hash(f.bytes('tea')), before);
  const times = JSON.parse(fs.readFileSync(path.join(f.root, '.lararium-reads.json'), 'utf8'));
  assert.ok(times.tea > Date.now() - 10000);
});

test('a ref retry with a different name writes nothing and returns the original card', async t => {
  const f = fixture(t);
  await f.store.remember(fact('tea', { ref: 'example-call: 1' }));
  const before = f.index();
  const retry = await f.store.remember(fact('coffee', { ref: 'example-call: 1' }));
  assert.equal(retry.name, 'tea');
  assert.equal(retry.alreadyExists, true);
  assert.equal(f.store.list().length, 1);
  assert.equal(f.index(), before);
});

test('v3.1 cards default active and an unrelated no-relation remember still writes a card and pointer', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'legacy.md'), '---\nname: legacy\ndescription: Amber lanterns.\ntype: user\n---\n\nAmber lanterns.\n');
  assert.equal(f.card('legacy').status, 'active');
  assert.equal(f.store.read('legacy').status, 'active');
  const result = await f.store.remember(fact('cobalt', { relation: undefined, description: 'Cobalt upholstery.', body: 'Cobalt upholstery.' }));
  assert.equal(result.file, 'cobalt.md');
  assert.match(f.index(), /- cobalt.md - Cobalt upholstery./);
  assert.equal(f.store.list({ status: 'active' }).length, 2);
});

test('rewritten journaled contested cards retain provenance and converge restores dropped pointers', async t => {
  const f = fixture(t);
  await f.store.remember(fact('tea'));
  const nonce = f.card('tea').id;
  await f.store.remember(fact('coffee', { relation: 'conflicts_with', target: 'tea' }));
  assert.equal(f.card('tea').status, 'contested');
  assert.equal(f.card('tea').id, nonce);
  const records = parseJournal(fs.readFileSync(path.join(f.root, '.lararium-remembered'), 'utf8'));
  assert.ok(records.some(r => r.file === 'tea.md' && r.nonce === nonce && r.hash === hash(f.bytes('tea'))));
  fs.writeFileSync(path.join(f.root, 'MEMORY.md'), '# Memory\n');
  assert.equal(await f.store.heal(), 2);
  assert.match(f.index(), /- tea.md/);
  await f.store.resolve({ winner: 'coffee', loser: 'tea', reason: 'Confirmed' });
  fs.writeFileSync(path.join(f.root, 'MEMORY.md'), '# Memory\n');
  assert.equal(await f.store.heal(), 1);
  assert.doesNotMatch(f.index(), /- tea.md/);
});

test('a near match without relation returns candidates and writes no files', async t => {
  const f = fixture(t);
  const content = { description: 'Amber lanterns illuminate the workshop.', body: 'Amber lanterns illuminate the workshop every evening.' };
  await f.store.remember(fact('amber-lanterns', content));
  const before = Object.fromEntries(fs.readdirSync(f.root).map(n => [n, hash(fs.readFileSync(path.join(f.root, n)))]));
  const result = await f.store.remember(fact('workshop-lighting', { ...content, relation: undefined }));
  assert.equal(result.candidates[0].name, 'amber-lanterns');
  assert.equal(result.candidates[0].status, 'active');
  for (const [n, checksum] of Object.entries(before)) assert.equal(hash(fs.readFileSync(path.join(f.root, n))), checksum);
  assert.equal(f.store.list().length, 1);
});

test('pins sort first and remain above new and healed index lines', async t => {
  const f = fixture(t);
  await f.store.remember(fact('zebra', { pinned: true }));
  await f.store.remember(fact('alpha'));
  await f.store.remember(fact('beta'));
  assert.equal(f.store.list()[0].name, 'zebra');
  assert.ok(f.index().indexOf('- zebra.md') < f.index().indexOf('- beta.md'));
  fs.writeFileSync(path.join(f.root, 'MEMORY.md'), '# Memory\n- zebra.md - pin\n');
  await f.store.heal();
  assert.ok(f.index().indexOf('- zebra.md') < f.index().indexOf('- alpha.md'));
});

test('superseding demotes the target and refuses later relations against it with the successor name', async t => {
  const f = fixture(t);
  await f.store.remember(fact('tea'));
  await f.store.remember(fact('coffee', { relation: 'supersedes', target: 'tea' }));
  assert.equal(f.card('tea').status, 'superseded');
  assert.equal(f.card('coffee').supersedes, 'tea');
  assert.doesNotMatch(f.index(), /- tea.md/);
  assert.match(fs.readFileSync(path.join(f.root, 'DEMOTED.md'), 'utf8'), /- tea.md - superseded by coffee.md/);
  for (const relation of ['supersedes', 'conflicts_with']) {
    await assert.rejects(f.store.remember(fact('water', { relation, target: 'tea' })), /superseded by coffee/);
  }
  await f.store.heal();
  assert.doesNotMatch(f.index(), /- tea.md/);
});

for (const relation of ['supersedes', 'conflicts_with']) {
  for (const heldWins of [true, false]) {
    test(`resolve held ${relation}, held card ${heldWins ? 'wins' : 'loses'}`, async t => {
      const f = fixture(t);
      await f.store.remember(fact('tea', { origin: 'user' }));
      const before = hash(f.bytes('tea'));
      const held = await f.store.remember(fact('coffee', { relation, target: 'tea', origin: 'third_party', ref: 'held-call' }));
      assert.equal(held.held, true);
      assert.equal(hash(f.bytes('tea')), before);
      const again = await f.store.remember(fact('water', { ref: 'held-call' }));
      assert.equal(again.name, 'coffee');
      await f.store.resolve({ winner: heldWins ? 'coffee' : 'tea', loser: heldWins ? 'tea' : 'coffee', reason: 'Owner chose' });
      assert.equal(f.card(heldWins ? 'coffee' : 'tea').status, 'active');
      assert.equal(f.card(heldWins ? 'tea' : 'coffee', !heldWins).status, 'superseded');
      assert.equal(f.store.list({ status: 'active' }).length, 1);
      if (heldWins) {
        assert.equal(fs.existsSync(path.join(f.root, '_held/coffee.md')), false);
        assert.match(f.index(), /- coffee.md/);
        fs.writeFileSync(path.join(f.root, 'MEMORY.md'), '# Memory\n');
        assert.equal(await f.store.heal(), 1);
      } else {
        assert.equal(f.store.list().length, 1);
        assert.equal(f.store.list({ status: 'held' }).length, 1);
      }
    });
  }
}

test('multiple conflicts use a YAML flow list and resolution preserves unrelated conflicts', async t => {
  const f = fixture(t);
  await conflict(f);
  await f.store.remember(fact('water', { relation: 'conflicts_with', target: 'tea' }));
  assert.match(f.bytes('tea').toString(), /conflicts_with: \[coffee, water\]/);
  await f.store.resolve({ winner: 'tea', loser: 'coffee', reason: 'Confirmed' });
  assert.equal(f.card('tea').status, 'contested');
  assert.deepEqual(f.card('tea').conflicts_with, ['water']);
  assert.deepEqual(f.card('water').conflicts_with, ['tea']);
});

test('rewrites preserve CRLF body bytes and do not journal handwritten cards', async t => {
  const f = fixture(t);
  const suffix = '\r\nRaw body.  \r\n\r\n---\r\nTrailing spaces.  ';
  fs.writeFileSync(path.join(f.root, 'tea.md'), '---\r\nname: tea\r\ndescription: Tea preference.\r\ntype: feedback\r\n---\r\n' + suffix);
  await f.store.remember(fact('coffee', { relation: 'conflicts_with', target: 'tea' }));
  assert.equal(f.bytes('tea').toString().slice(-suffix.length), suffix);
  assert.equal(f.card('tea').status, 'contested');
  const records = parseJournal(fs.readFileSync(path.join(f.root, '.lararium-remembered'), 'utf8'));
  assert.equal(records.some(r => r.file === 'tea.md'), false);
});

test('stale_days uses read time or mtime and excludes pins, contested, superseded and held cards', async t => {
  const f = fixture(t);
  for (const name of ['old', 'fresh', 'pinned']) await f.store.remember(fact(name, { pinned: name === 'pinned' }));
  await conflict(f);
  const ancient = new Date(Date.now() - 40 * 86400000);
  for (const name of ['old', 'fresh', 'pinned', 'tea', 'coffee']) fs.utimesSync(path.join(f.root, `${name}.md`), ancient, ancient);
  assert.deepEqual(f.store.list({ stale_days: 30 }).map(c => c.name), ['fresh', 'old']);
  f.store.read('fresh');
  assert.deepEqual(f.store.list({ stale_days: 30 }).map(c => c.name), ['old']);
});

test('read-only stores and read-tier reads never create the sidecar', async t => {
  const f = fixture(t);
  await f.store.remember(fact('tea'));
  f.store.read('tea', { recordRead: false });
  createStore({ root: f.root, readOnly: true }).read('tea');
  assert.equal(fs.existsSync(path.join(f.root, '.lararium-reads.json')), false);
});

test('a symlink or malformed read sidecar is logged and never fails the read', async t => {
  const logs = [];
  const f = fixture(t, { log: line => logs.push(line) });
  await f.store.remember(fact('tea'));
  const sidecar = path.join(f.root, '.lararium-reads.json');
  fs.symlinkSync(path.join(f.root, 'tea.md'), sidecar);
  const before = hash(f.bytes('tea'));
  assert.match(f.store.read('tea').text, /tea/);
  assert.ok(fs.lstatSync(sidecar).isSymbolicLink());
  assert.equal(hash(f.bytes('tea')), before);
  fs.unlinkSync(sidecar);
  fs.writeFileSync(sidecar, '{bad');
  assert.match(f.store.read('tea').text, /tea/);
  assert.equal(logs.length, 2);
});

test('search ranks active above contested and superseded cards while retaining state metadata', async t => {
  const f = fixture(t);
  await conflict(f);
  await f.store.remember(fact('water', { description: 'Tea beverage.' }));
  await f.store.remember(fact('cocoa', { description: 'Tea beverage.', relation: 'supersedes', target: 'coffee' }));
  const found = f.store.searchText('tea coffee beverage');
  assert.equal(found[0].status, 'active');
  assert.equal(found.at(-1).status, 'superseded');
  assert.equal(f.card('tea').status, 'active');
  assert.deepEqual(f.card('tea').conflicts_with, []);
});

async function clientFor(t, store, role = 'write') {
  const sdk = createRequire(path.join(repo, 'npx/package.json'));
  const { Client } = sdk('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = sdk('@modelcontextprotocol/sdk/inMemory.js');
  const { createMcpServer } = createRequire(import.meta.url)(path.join(lib, 'mcp.js'));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ store, role, version: 'test' });
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  t.after(() => client.close());
  return client;
}
const call = async (client, name, args) => {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, result.content[0].text);
  return result.content[0].text;
};

test('MCP exposes resolution only to writers and read-tier calls never track reads', async t => {
  const f = fixture(t);
  await f.store.remember(fact('tea'));
  const reader = await clientFor(t, f.store, 'read');
  const writer = await clientFor(t, f.store);
  assert.deepEqual((await reader.listTools()).tools.map(c => c.name).sort(), ['list', 'read', 'search']);
  const tools = (await writer.listTools()).tools;
  assert.ok(tools.some(c => c.name === 'resolve'));
  assert.match(tools.find(c => c.name === 'remember').description, /cannot verify/);
  await call(reader, 'read', { name: 'tea' });
  assert.equal(fs.existsSync(path.join(f.root, '.lararium-reads.json')), false);
  await call(writer, 'read', { name: 'tea' });
  assert.ok(fs.existsSync(path.join(f.root, '.lararium-reads.json')));
});

test('MCP surfaces candidates, held writes and ref retries with instructions', async t => {
  const f = fixture(t);
  const client = await clientFor(t, f.store);
  await call(client, 'remember', fact('amber-lanterns', { origin: 'user', description: 'Amber lanterns illuminate the workshop.', body: 'Amber lanterns illuminate the workshop every evening.' }));
  const near = await call(client, 'remember', fact('workshop-lighting', { relation: undefined, description: 'Amber lanterns illuminate the workshop.', body: 'Amber lanterns illuminate the workshop every evening.' }));
  assert.match(near, /Nothing was written.*relation/s);
  assert.match(near, /amber-lanterns \[active\]/);
  const held = await call(client, 'remember', fact('coffee', { relation: 'supersedes', target: 'amber-lanterns', ref: 'example-ref' }));
  assert.match(held, /Held.*for the owner/);
  assert.match(await call(client, 'remember', fact('water', { ref: 'example-ref' })), /already exists/);
  assert.match(await call(client, 'list', { status: 'held' }), /coffee.*\[held\]/);
  await call(client, 'resolve', { winner: 'coffee', loser: 'amber-lanterns', reason: 'Owner confirmed' });
  assert.equal(f.card('coffee').status, 'active');
});

test('MCP search labels contested and superseded matches and stale lists advise manual demotion', async t => {
  const f = fixture(t);
  await conflict(f);
  const client = await clientFor(t, f.store);
  assert.match(await call(client, 'search', { query: 'tea' }), /\[contested with coffee\]/);
  await call(client, 'resolve', { winner: 'coffee', loser: 'tea', reason: 'Confirmed' });
  assert.match(await call(client, 'search', { query: 'tea' }), /\[superseded by coffee\]/);
  assert.match(await call(client, 'list', { stale_days: 30 }), /owner.*DEMOTED.md/);
});

test('invalid relations and unrelated resolution leave cards unchanged', async t => {
  const f = fixture(t);
  await f.store.remember(fact('tea'));
  await f.store.remember(fact('coffee'));
  const before = [hash(f.bytes('tea')), hash(f.bytes('coffee'))];
  await assert.rejects(f.store.resolve({ winner: 'tea', loser: 'coffee', reason: 'No conflict' }), /contested pair/);
  for (const extra of [{ relation: 'unknown' }, { relation: 'supersedes' }, { relation: 'conflicts_with', target: '../tea' }, { origin: 'unknown' }, { evidence: 'a\nb' }]) {
    await assert.rejects(f.store.remember(fact('water', extra)));
  }
  assert.deepEqual([hash(f.bytes('tea')), hash(f.bytes('coffee'))], before);
});

test('identical retries recognise renewed journal provenance without resurrecting superseded cards', async t => {
  const f = fixture(t);
  await f.store.remember(fact('tea'));
  await f.store.remember(fact('coffee', { relation: 'conflicts_with', target: 'tea' }));
  const bytes = hash(f.bytes('tea'));
  await f.store.remember(fact('tea'));
  assert.equal(hash(f.bytes('tea')), bytes);
  await f.store.resolve({ winner: 'coffee', loser: 'tea', reason: 'Confirmed' });
  const retry = await f.store.remember(fact('tea'));
  assert.equal(retry.alreadyExists, true);
  assert.doesNotMatch(f.index(), /- tea.md/);
});

test('rewriting preserves even non-UTF8 body bytes verbatim', async t => {
  const f = fixture(t);
  const body = Buffer.from([10, 255, 0, 254, 10, 32]);
  fs.writeFileSync(path.join(f.root, 'tea.md'), Buffer.concat([Buffer.from('---\nname: tea\ndescription: Tea.\ntype: user\n---\n'), body]));
  await f.store.remember(fact('coffee', { relation: 'supersedes', target: 'tea' }));
  assert.equal(f.card('tea').status, 'superseded');
  assert.deepEqual(f.bytes('tea').subarray(-body.length), body);
});

test('near matches are bounded at five and superseded cards do not block new writes', async t => {
  const f = fixture(t);
  const content = { description: 'Amber lanterns illuminate the workshop.', body: 'Amber lanterns illuminate the workshop every evening.' };
  for (let i = 0; i < 6; i += 1) await f.store.remember(fact(`lantern-${i}`, content));
  const near = await f.store.remember(fact('workshop', { ...content, relation: undefined }));
  assert.equal(near.candidates.length, 5);
  for (let i = 0; i < 6; i += 1) await f.store.remember(fact(`cobalt-${i}`, { description: 'Cobalt upholstery.', body: 'Cobalt upholstery.', relation: 'supersedes', target: `lantern-${i}` }));
  const saved = await f.store.remember(fact('workshop', { ...content, relation: undefined }));
  assert.equal(saved.file, 'workshop.md');
});

test('held directory links are refused without touching the user card or link destination', async t => {
  const f = fixture(t);
  await f.store.remember(fact('tea', { origin: 'user' }));
  const outside = path.join(f.root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.root, '_held'));
  const before = hash(f.bytes('tea'));
  await assert.rejects(f.store.remember(fact('coffee', { relation: 'supersedes', target: 'tea' })), /symbolic link/);
  assert.equal(hash(f.bytes('tea')), before);
  assert.deepEqual(fs.readdirSync(outside), []);
});

// The same fs mock seam used by serve-store tests. Fail a single real I/O boundary, then
// reopen the store to ensure recovery depends on canonical files rather than process state.
async function interrupted(f, point, operation) {
  let fired = false;
  const failure = () => { fired = true; throw Object.assign(new Error('injected I/O failure'), { code: 'EIO' }); };
  const [kind, file, phase = 'before', occurrence = '1'] = point.split(':');
  let seen = 0;
  const realRename = fs.renameSync;
  const realWrite = fs.writeSync;
  const rename = mock.method(fs, 'renameSync', (from, to) => {
    const matches = !fired && kind === 'rename' && to === path.join(f.root, file) && ++seen === Number(occurrence);
    if (matches && phase === 'before') failure();
    const result = realRename(from, to);
    if (matches && phase === 'after') failure();
    return result;
  });
  const write = mock.method(fs, 'writeSync', (fd, data, ...rest) => {
    const journal = path.join(f.root, path.dirname(file), '.lararium-remembered');
    const matchingJournal = fs.existsSync(journal) && fs.fstatSync(fd).ino === fs.statSync(journal).ino;
    if (!fired && kind === 'journal' && matchingJournal && Buffer.isBuffer(data) && data.toString().startsWith(`#\nL1 ${path.basename(file)} `) && ++seen === Number(occurrence)) {
      if (phase === 'short') realWrite(fd, data.subarray(0, 3));
      if (phase === 'after') realWrite(fd, data, ...rest);
      failure();
    }
    return realWrite(fd, data, ...rest);
  });
  try {
    await assert.rejects(operation(), /injected I\/O failure/);
    assert.equal(fired, true, `fault reached: ${point}`);
  } finally { rename.mock.restore(); write.mock.restore(); }
  return createStore({ root: f.root });
}

for (const [label, fields] of [
  ['double quotes', { description: 'Prefers "tea"', evidence: 'Said "tea"' }],
  ['single quotes', { description: "Prefers 'tea'", evidence: "Said 'tea'" }],
  ['quotes and backslashes', { description: 'Prefers "tea" from C:\\notes\\tea', evidence: 'Said: "tea" from C:\\notes\\tea' }],
  ['maximum body', { body: 'x'.repeat(20000) }],
]) {
  for (const relation of ['new', 'conflicts_with', 'supersedes']) {
    test(`round2 blocker 1: reopened ref retry preserves ${label} for ${relation}`, async t => {
      const f = fixture(t);
      const request = fact('coffee', { ...fields, relation, ref: 'saved-request',
        ...(relation !== 'new' ? { target: 'tea' } : {}) });
      let reopened;
      if (relation === 'new') {
        await f.store.remember(request);
        reopened = createStore({ root: f.root });
      } else {
        await f.store.remember(fact('tea'));
        reopened = await interrupted(f, 'rename:tea.md', () => f.store.remember(request));
        assert.equal(f.card('tea').status, 'active');
        assert.equal(f.card('coffee').relation_applied, false);
      }
      const result = await reopened.remember(fact('water', { ref: request.ref }));
      assert.equal(result.name, 'coffee');
      assert.equal(result.alreadyExists, true);
      assert.equal(fs.existsSync(path.join(f.root, 'water.md')), false);
      assert.equal(f.card('coffee').description, request.description);
      assert.equal(f.card('coffee').body, request.body + '\n');
      if (request.evidence) assert.equal(f.card('coffee').evidence, request.evidence);
      assert.match(f.index(), /- coffee.md/);
      if (relation === 'conflicts_with') {
        assert.equal(f.card('tea').status, 'contested');
        assert.deepEqual(f.card('tea').conflicts_with, ['coffee']);
        assert.deepEqual(f.card('coffee').conflicts_with, ['tea']);
      } else if (relation === 'supersedes') {
        assert.equal(f.card('tea').status, 'superseded');
        assert.equal(f.card('tea').superseded_by, 'coffee');
        assert.doesNotMatch(f.index(), /- tea.md/);
        assert.match(fs.readFileSync(path.join(f.root, 'DEMOTED.md'), 'utf8'), /- tea.md - superseded by coffee.md/);
      }
      const before = Object.fromEntries(['coffee.md', 'MEMORY.md', '.lararium-remembered'].map(file =>
        [file, hash(fs.readFileSync(path.join(f.root, file)))]));
      await createStore({ root: f.root }).remember(request);
      for (const [file, checksum] of Object.entries(before)) assert.equal(hash(fs.readFileSync(path.join(f.root, file))), checksum);
    });
  }
}

test('round2 blocker 2: an unrelated resolution leaves the winning remember pending for ref recovery', async t => {
  const f = fixture(t);
  await f.store.remember(fact('alpha'));
  const request = fact('bravo', { relation: 'conflicts_with', target: 'alpha', ref: 'pending-bravo' });
  const reopened = await interrupted(f, 'rename:alpha.md', () => f.store.remember(request));
  await reopened.remember(fact('charlie', { relation: 'conflicts_with', target: 'bravo' }));
  await reopened.resolve({ winner: 'bravo', loser: 'charlie', reason: 'Confirmed bravo' });
  assert.equal(f.card('alpha').status, 'active');
  assert.deepEqual(f.card('alpha').conflicts_with, []);
  const pending = !f.card('bravo').relation_applied;
  const result = await createStore({ root: f.root }).remember(fact('water', { ref: request.ref }));
  assert.equal(result.name, 'bravo');
  assert.equal(result.alreadyExists, true);
  for (const [name, opponent] of [['alpha', 'bravo'], ['bravo', 'alpha']]) {
    assert.equal(f.card(name).status, 'contested');
    assert.deepEqual(f.card(name).conflicts_with, [opponent]);
    assert.match(f.index(), new RegExp(`- ${name}.md`));
  }
  assert.equal(pending, true, 'the unrelated resolution did not complete the recorded relation');
  assert.equal(f.card('bravo').relation_applied, true);
  assert.equal(f.card('charlie').status, 'superseded');
  assert.doesNotMatch(f.index(), /- charlie.md/);
});

test('round2 blocker 3: non-ref supersession and identical retry skip an unrelated symlink', async t => {
  const f = fixture(t);
  await f.store.remember(fact('tea'));
  fs.symlinkSync('tea.md', path.join(f.root, 'linked.md'));
  const request = fact('coffee', { relation: 'supersedes', target: 'tea' });
  await f.store.remember(request);
  await createStore({ root: f.root }).remember(request);
  assert.equal(f.card('tea').status, 'superseded');
  assert.equal(f.card('tea').superseded_by, 'coffee');
  assert.equal(f.card('coffee').status, 'active');
  assert.equal(f.card('coffee').relation_applied, true);
  assert.doesNotMatch(f.index(), /- tea.md|- linked.md/);
  assert.match(f.index(), /- coffee.md/);
  assert.match(fs.readFileSync(path.join(f.root, 'DEMOTED.md'), 'utf8'), /- tea.md - superseded by coffee.md/);
  assert.equal(fs.readlinkSync(path.join(f.root, 'linked.md')), 'tea.md');
});

test('round2 watch-out: an unvouched ref reply does not claim interrupted writes are complete', async t => {
  const f = fixture(t);
  await f.store.remember(fact('tea'));
  const request = fact('coffee', { relation: 'conflicts_with', target: 'tea', ref: 'edited-request' });
  await interrupted(f, 'rename:tea.md', () => f.store.remember(request));
  fs.appendFileSync(path.join(f.root, 'coffee.md'), 'Local edit.\n');
  const before = Object.fromEntries(fs.readdirSync(f.root).map(file =>
    [file, hash(fs.readFileSync(path.join(f.root, file)))]));
  const client = await clientFor(t, createStore({ root: f.root }));
  const reply = await call(client, 'remember', fact('water', { ref: request.ref }));
  assert.match(reply, /coffee already exists/);
  assert.doesNotMatch(reply, /any interrupted write is complete/);
  assert.match(reply, /locally edited cards.*without.*repair/i);
  assert.equal(f.card('tea').status, 'active');
  assert.equal(f.card('coffee').relation_applied, false);
  assert.deepEqual(fs.readdirSync(f.root), Object.keys(before));
  for (const [file, checksum] of Object.entries(before)) assert.equal(hash(fs.readFileSync(path.join(f.root, file))), checksum);
});

for (const changed of ['target', 'relation']) {
  test(`round1 blocker 1: changed ${changed} is refused before any target changes`, async t => {
    const f = fixture(t);
    await f.store.remember(fact('tea'));
    await f.store.remember(fact('water'));
    const first = fact('coffee', changed === 'target' ? { relation: 'conflicts_with', target: 'tea' } : {});
    await f.store.remember(first);
    const before = Object.fromEntries(['tea', 'water', 'coffee'].map(n => [n, hash(f.bytes(n))]));
    const retry = { ...first, relation: 'conflicts_with', target: 'water' };
    await assert.rejects(f.store.remember(retry), /already exists/);
    for (const [name, checksum] of Object.entries(before)) assert.equal(hash(f.bytes(name)), checksum);
  });
}

const targetFaults = ['journal:tea.md', 'journal:tea.md:short', 'journal:tea.md:after', 'rename:tea.md', 'rename:tea.md:after'];
const finalFaults = ['rename:DEMOTED.md', 'rename:DEMOTED.md:after', 'rename:MEMORY.md', 'rename:MEMORY.md:after'];
for (const relation of ['supersedes', 'conflicts_with']) {
  for (const point of [...targetFaults, ...finalFaults.filter(p => relation === 'supersedes' || !p.includes('DEMOTED')),
    'journal:coffee.md:before:2', 'rename:coffee.md', 'rename:coffee.md:after']) {
    test(`round1 blocker 2: ref retry completes ${relation} after ${point}`, async t => {
      const f = fixture(t);
      await f.store.remember(fact('tea'));
      const request = fact('coffee', { relation, target: 'tea', ref: 'interrupted-request' });
      const resumed = await interrupted(f, point, () => f.store.remember(request));
      const result = await resumed.remember(fact('water', { ref: request.ref }));
      assert.equal(result.name, 'coffee');
      assert.equal(result.alreadyExists, true);
      if (relation === 'supersedes') {
        assert.equal(f.card('tea').status, 'superseded');
        assert.equal(f.card('tea').superseded_by, 'coffee');
        assert.doesNotMatch(f.index(), /- tea.md/);
        assert.match(fs.readFileSync(path.join(f.root, 'DEMOTED.md'), 'utf8'), /- tea.md - superseded by coffee.md/);
      } else {
        for (const [name, opponent] of [['tea', 'coffee'], ['coffee', 'tea']]) {
          assert.equal(f.card(name).status, 'contested');
          assert.deepEqual(f.card(name).conflicts_with, [opponent]);
        }
        assert.match(f.index(), /- tea.md/);
      }
      assert.match(f.index(), /- coffee.md/);
      const before = fs.readFileSync(path.join(f.root, '.lararium-remembered'), 'utf8');
      await resumed.remember(request);
      assert.equal(fs.readFileSync(path.join(f.root, '.lararium-remembered'), 'utf8'), before);
      fs.writeFileSync(path.join(f.root, 'MEMORY.md'), '# Memory\n');
      assert.equal(await resumed.heal(), relation === 'supersedes' ? 1 : 2);
    });
  }
}

for (const held of [false, true]) {
  const points = [...targetFaults, 'journal:coffee.md', 'rename:coffee.md', 'rename:coffee.md:after', ...finalFaults];
  if (held) points.push('journal:coffee.md:after');
  for (const point of points) {
    test(`round1 blocker 3: ${held ? 'held' : 'contested'} resolution resumes after ${point}`, async t => {
      const f = fixture(t);
      if (held) {
        await f.store.remember(fact('tea', { origin: 'user' }));
        await f.store.remember(fact('coffee', { relation: 'supersedes', target: 'tea' }));
      } else await conflict(f);
      const request = { winner: 'coffee', loser: 'tea', reason: 'Owner confirmed' };
      const resumed = await interrupted(f, point, () => f.store.resolve(request));
      await resumed.resolve(request);
      assert.equal(f.card('coffee').status, 'active');
      assert.equal(f.card('tea').status, 'superseded');
      assert.equal(f.card('tea').resolved_reason, request.reason);
      assert.deepEqual(f.card('coffee').conflicts_with, []);
      assert.deepEqual(f.card('tea').conflicts_with, []);
      assert.doesNotMatch(f.index(), /- tea.md/);
      assert.match(f.index(), /- coffee.md/);
      const demoted = fs.readFileSync(path.join(f.root, 'DEMOTED.md'), 'utf8');
      assert.equal((demoted.match(/- tea.md - superseded by coffee.md/g) || []).length, 1);
      await assert.rejects(resumed.resolve({ ...request, reason: 'Different decision' }));
      await resumed.resolve(request);
      assert.equal(fs.existsSync(path.join(f.root, '_held/coffee.md')), false);
      fs.writeFileSync(path.join(f.root, 'MEMORY.md'), '# Memory\n');
      assert.equal(await resumed.heal(), 1, 'promoted winner retains root provenance');
    });
  }
}

for (const resolve of [false, true]) {
  test(`round1 blocker 4: ${resolve ? 'resolution' : 'supersession'} retires all incident conflicts`, async t => {
    const f = fixture(t);
    await conflict(f);
    await f.store.remember(fact('water', { relation: 'conflicts_with', target: 'tea' }));
    if (resolve) await f.store.resolve({ winner: 'coffee', loser: 'tea', reason: 'Confirmed' });
    else await f.store.remember(fact('cocoa', { relation: 'supersedes', target: 'tea' }));
    assert.equal(f.card('water').status, 'active');
    assert.deepEqual(f.card('water').conflicts_with, []);
    assert.deepEqual(f.card('tea').conflicts_with, []);
    if (!resolve) {
      assert.equal(f.card('coffee').status, 'active');
      assert.deepEqual(f.card('coffee').conflicts_with, []);
    }
    await f.store.remember(fact('milk', { relation: 'conflicts_with', target: 'water' }));
    await f.store.resolve({ winner: 'water', loser: 'milk', reason: 'Confirmed again' });
    assert.equal(f.card('water').status, 'active');
  });
}

test('round1 blocker 5: reconnected MCP readers can inspect held proposals and discover their targets', async t => {
  const f = fixture(t);
  await f.store.remember(fact('tea', { origin: 'user' }));
  await f.store.remember(fact('coffee', { relation: 'supersedes', target: 'tea', evidence: 'Owner said: coffee # today' }));
  const reader = await clientFor(t, createStore({ root: f.root }), 'read');
  const listing = await call(reader, 'list', { status: 'held' });
  assert.match(listing, /supersedes.*tea/);
  const full = await call(reader, 'read', { name: 'coffee', held: true });
  assert.match(full, /coffee is the selected setting/);
  assert.match(full, /evidence: "Owner said: coffee # today"/);
  assert.match(full, /relation: supersedes\ntarget: tea/);
  const before = hash(f.bytes('coffee', true));
  assert.equal(f.store.read('coffee', { held: true }).text, full);
  assert.equal(hash(f.bytes('coffee', true)), before);
  assert.equal(fs.existsSync(path.join(f.root, '.lararium-reads.json')), false);
  for (const name of ['../tea', '_held/coffee', 'MEMORY', '.lararium-remembered']) {
    assert.equal((await reader.callTool({ name: 'read', arguments: { name, held: true } })).isError, true);
  }
  fs.symlinkSync(path.join(f.root, 'tea.md'), path.join(f.root, '_held/linked.md'));
  assert.equal((await reader.callTool({ name: 'read', arguments: { name: 'linked', held: true } })).isError, true);
  fs.unlinkSync(path.join(f.root, '_held/linked.md'));
  fs.renameSync(path.join(f.root, '_held'), path.join(f.root, 'proposals'));
  fs.symlinkSync(path.join(f.root, 'proposals'), path.join(f.root, '_held'));
  assert.equal((await reader.callTool({ name: 'read', arguments: { name: 'coffee', held: true } })).isError, true);
});

test('round1 legacy: original v3.1 requests retry before and after state rewrites', async t => {
  const f = fixture(t);
  const nonce = '0123456789abcdef01234567';
  const text = `---\nname: tea\ndescription: tea preference.\ntype: feedback\nlararium-id: ${nonce}\n---\n\ntea is the selected setting.\n`;
  fs.writeFileSync(path.join(f.root, 'tea.md'), text);
  const { journalRecord } = createRequire(import.meta.url)(path.join(lib, 'store.js'));
  fs.writeFileSync(path.join(f.root, '.lararium-remembered'), journalRecord('tea.md', nonce, hash(Buffer.from(text))));
  const request = fact('tea', { relation: undefined });
  await f.store.remember(request);
  assert.match(f.index(), /- tea.md/);
  await f.store.remember(fact('coffee', { relation: 'conflicts_with', target: 'tea' }));
  await f.store.remember(request);
  assert.equal(f.card('tea').status, 'contested');
  await f.store.resolve({ winner: 'coffee', loser: 'tea', reason: 'Confirmed' });
  assert.equal((await f.store.remember(request)).alreadyExists, true);
  assert.doesNotMatch(f.index(), /- tea.md/);
});

for (const relation of ['conflicts_with', 'supersedes']) {
  test(`round1 blocker 2: held ${relation} ref retry after resolution preserves the decision`, async t => {
    const f = fixture(t);
    await f.store.remember(fact('tea', { origin: 'user' }));
    await f.store.remember(fact('coffee', { relation, target: 'tea', ref: 'held-resolution' }));
    await f.store.resolve({ winner: 'coffee', loser: 'tea', reason: 'Confirmed' });
    const before = hash(f.bytes('tea'));
    assert.equal((await createStore({ root: f.root }).remember(fact('water', { ref: 'held-resolution' }))).name, 'coffee');
    assert.equal(hash(f.bytes('tea')), before);
    assert.equal(f.card('coffee').status, 'active');
  });
}

for (const point of ['journal:_held/coffee.md', 'rename:_held/coffee.md', 'rename:_held/coffee.md:after', 'rename:MEMORY.md', 'rename:MEMORY.md:after']) {
  test(`round1 blocker 3: held loser resolution resumes after ${point}`, async t => {
    const f = fixture(t);
    await f.store.remember(fact('tea', { origin: 'user' }));
    await f.store.remember(fact('coffee', { relation: 'conflicts_with', target: 'tea' }));
    const request = { winner: 'tea', loser: 'coffee', reason: 'Retain owner evidence' };
    const resumed = await interrupted(f, point, () => f.store.resolve(request));
    await resumed.resolve(request);
    await resumed.resolve(request);
    assert.equal(f.card('tea').status, 'active');
    assert.equal(f.card('coffee', true).status, 'superseded');
    assert.match(f.index(), /- tea.md/);
    assert.doesNotMatch(f.index(), /- coffee.md/);
  });
}

for (const resolve of [false, true]) {
  for (const point of ['journal:water.md', 'rename:water.md', 'rename:water.md:after']) {
    test(`round1 blocker 4: interrupted incident cleanup resumes during ${resolve ? 'resolution' : 'supersession'} at ${point}`, async t => {
      const f = fixture(t);
      await conflict(f);
      await f.store.remember(fact('water', { relation: 'conflicts_with', target: 'tea' }));
      const decision = { winner: 'coffee', loser: 'tea', reason: 'Confirmed' };
      const request = fact('cocoa', { relation: 'supersedes', target: 'tea', ref: 'cleanup-request' });
      const resumed = await interrupted(f, point, () => resolve ? f.store.resolve(decision) : f.store.remember(request));
      if (resolve) await resumed.resolve(decision);
      else await resumed.remember(request);
      assert.equal(f.card('water').status, 'active');
      assert.deepEqual(f.card('water').conflicts_with, []);
      assert.equal(f.card('tea').status, 'superseded');
      assert.doesNotMatch(f.index(), /- tea.md/);
    });
  }
}
