// The memory server's store: what `remember` writes must be exactly the v3 card format, so the
// shipped validator (hooks/memory-check.mjs) accepts it and any agent reading the files finds it.
// Needs the server's dependencies: npm ci --prefix npx
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createStore, InputError, GuardError } = require(path.join(repo, 'npx/lib/store.js'));
const check = path.join(repo, 'hooks/memory-check.mjs');

// A stack-shaped folder: brain/ files the validator wants, and the SHIPPED memory/ files.
function stack() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-store-'));
  fs.mkdirSync(path.join(root, 'brain'));
  for (const f of ['CLAUDE.md', 'now.md']) fs.writeFileSync(path.join(root, 'brain', f), 'x');
  fs.mkdirSync(path.join(root, 'memory'));
  for (const f of ['MEMORY.md', 'DEMOTED.md']) fs.copyFileSync(path.join(repo, 'memory', f), path.join(root, 'memory', f));
  const validate = () => spawnSync(process.execPath, [check, root], { encoding: 'utf8', env: { ...process.env, LARARIUM_ROOT: root } });
  return { root, memory: path.join(root, 'memory'), validate, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const fact = (name, extra = {}) => ({ name, description: `One line about ${name}.`, type: 'feedback', body: `The fact for ${name}.\n\n**Why:** a reason.\n\n**How to apply:** a rule.`, ...extra });

test('remember writes one card file plus a newest-first index line that the shipped validator accepts', async () => {
  const s = stack();
  try {
    assert.equal(s.validate().status, 0);
    const store = createStore({ root: s.memory });
    const first = await store.remember(fact('prefers-short-replies'));
    const second = await store.remember(fact('uses-tabs-not-spaces', { type: 'user' }));
    assert.equal(first.file, 'prefers-short-replies.md');
    assert.equal(second.indexOverBudget, false);

    const card = fs.readFileSync(path.join(s.memory, 'prefers-short-replies.md'), 'utf8');
    assert.equal(card, '---\nname: prefers-short-replies\ndescription: One line about prefers-short-replies.\ntype: feedback\n---\n\nThe fact for prefers-short-replies.\n\n**Why:** a reason.\n\n**How to apply:** a rule.\n');

    const index = fs.readFileSync(path.join(s.memory, 'MEMORY.md'), 'utf8');
    const entries = index.split('\n').filter(l => /^- \S+\.md - /.test(l) && !l.startsWith('- card-name.md'));
    assert.deepEqual(entries, ['- uses-tabs-not-spaces.md - One line about uses-tabs-not-spaces.', '- prefers-short-replies.md - One line about prefers-short-replies.']);
    assert.ok(index.startsWith('<!-- THE MEMORY INDEX'), 'the header comment stays first');

    const verdict = s.validate();
    assert.equal(verdict.status, 0, verdict.stdout);
    assert.match(verdict.stdout, /2 card\(s\): 2 pointered, 0 demoted on purpose/);
  } finally { s.done(); }
});

test('remember never overwrites, and refuses malformed input', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    await store.remember(fact('a-claim'));
    await assert.rejects(() => store.remember(fact('a-claim', { body: 'different' })), /already exists/);
    assert.match(fs.readFileSync(path.join(s.memory, 'a-claim.md'), 'utf8'), /The fact for a-claim/);
    const bad = [
      fact('Not Kebab'), fact('under_score'), fact('x'.repeat(81)), fact('ok-name', { type: 'note' }),
      fact('ok-name', { description: '   ' }), fact('ok-name', { body: '' }), fact('ok-name', { body: 'x'.repeat(20001) }),
    ];
    for (const input of bad) await assert.rejects(() => store.remember(input), InputError);
    assert.deepEqual(fs.readdirSync(s.memory).sort(), ['DEMOTED.md', 'MEMORY.md', 'a-claim.md']);
  } finally { s.done(); }
});

test('a multi-line description is folded to one line so the frontmatter and index stay valid', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    await store.remember(fact('folded', { description: 'first line\nsecond: line\n---\nthird' }));
    // Folded to one line; the ": " makes it unsafe as a plain YAML scalar, so it is double-quoted.
    assert.match(fs.readFileSync(path.join(s.memory, 'folded.md'), 'utf8'), /^---\nname: folded\ndescription: "first line second: line --- third"\ntype: feedback\n---\n/);
    assert.equal(store.list().find(c => c.name === 'folded').description, 'first line second: line --- third');
    assert.equal(s.validate().status, 0);
  } finally { s.done(); }
});

test('a missing index is created, and an index past the budget is reported, not refused', async () => {
  const s = stack();
  try {
    fs.rmSync(path.join(s.memory, 'MEMORY.md'));
    const store = createStore({ root: s.memory });
    await store.remember(fact('first-card'));
    assert.match(fs.readFileSync(path.join(s.memory, 'MEMORY.md'), 'utf8'), /- first-card\.md - /);
    fs.writeFileSync(path.join(s.memory, 'MEMORY.md'), `${Array.from({ length: 205 }, (_, i) => `- old-${i}.md - x`).join('\n')}\n`);
    const result = await store.remember(fact('late-card'));
    assert.equal(result.indexOverBudget, true);
  } finally { s.done(); }
});

test('concurrent remembers all land in the index', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.remember(fact(`card-${i}`))));
    const verdict = s.validate();
    assert.equal(verdict.status, 0, verdict.stdout);
    assert.match(verdict.stdout, /12 card\(s\): 12 pointered/);
  } finally { s.done(); }
});

test('full-text search ranks by name, description and body, drops filler words, and finds cards the CLIs wrote', async () => {
  const s = stack();
  try {
    // A card written by another tool, straight to disk, the way a coding agent does it.
    fs.writeFileSync(path.join(s.memory, 'deploys-go-through-the-staging-tunnel.md'),
      '---\nname: deploys-go-through-the-staging-tunnel\ndescription: Releases ship via the staging tunnel first.\ntype: reference\n---\n\nThe zebra-widget service is released through staging.\n');
    const store = createStore({ root: s.memory });
    await store.remember(fact('prefers-short-replies', { description: 'Keep replies under five lines.' }));

    const hit = store.searchText('what do you remember about the zebra-widget?');
    assert.equal(hit[0].name, 'deploys-go-through-the-staging-tunnel');
    assert.match(hit[0].snippet, /zebra-widget/);
    assert.equal(store.searchText('staging tunnel')[0].name, 'deploys-go-through-the-staging-tunnel');
    assert.equal(store.searchText('short replies')[0].name, 'prefers-short-replies');
    assert.deepEqual(store.searchText('nothing-matches-this-xyzzy'), []);

    const all = store.list();
    assert.deepEqual(all.map(c => [c.name, c.inIndex]), [['deploys-go-through-the-staging-tunnel', false], ['prefers-short-replies', true]]);
    assert.equal(store.list({ type: 'reference' }).length, 1);
  } finally { s.done(); }
});

// Found by a real client round trip: a description like "Test fact: the kayak is blue" was written
// as a plain YAML scalar, which strict parsers reject ("mapping values are not allowed here"). The
// shipped validator only checks the field is non-empty, so it never noticed. Any description must
// come back from a real YAML parser as exactly the string that was saved.
const py = spawnSync('python3', ['-c', 'import yaml'], { encoding: 'utf8' });
const needPyYaml = process.env.CI === 'true' ? false : py.status !== 0 && 'python3 with PyYAML not available';
test('descriptions that are awkward as plain YAML are saved so a real YAML parser reads them back unchanged', { skip: needPyYaml }, async () => {
  if (process.env.CI === 'true') assert.equal(py.status, 0, 'CI=true needs python3 with PyYAML (pip install pyyaml)');
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    const descriptions = [
      'Test fact: the kayak is blue',
      'Uses a # in the middle of a sentence like this # one',
      'says "quoted" things and \'single\' ones',
      '- starts with a dash',
      '[starts with a bracket] and {braces}',
      '@at-sign first',
      '*star first',
      'yes',
      '2026-10-28',
      '1234',
      'null',
      'ends with a colon:',
      'back\\slash and tab\there',
      'plain sentence with no trouble.',
    ];
    for (const [i, description] of descriptions.entries()) {
      const name = `yaml-case-${i}`;
      await store.remember({ name, description, type: 'reference', body: 'Body.' });
      const text = fs.readFileSync(path.join(s.memory, `${name}.md`), 'utf8');
      const parsed = spawnSync('python3', ['-I', '-c', [
        'import sys, json, yaml',
        't = sys.stdin.read()',
        'print(json.dumps(yaml.safe_load(t[4:t.index("\\n---", 4)])))',
      ].join('\n')], { input: text, encoding: 'utf8' });
      assert.equal(parsed.status, 0, `PyYAML rejected the card for ${JSON.stringify(description)}: ${parsed.stderr}`);
      const front = JSON.parse(parsed.stdout);
      assert.equal(front.description, description.replace(/\s+/g, ' ').trim());
      assert.equal(front.name, name);
      assert.equal(front.type, 'reference');
      // and the server's own reader agrees with the parser
      assert.equal(store.list().find(c => c.name === name).description, description.replace(/\s+/g, ' ').trim());
    }
    assert.equal(s.validate().status, 0);
  } finally { s.done(); }
});

// ---- r2 hardening -------------------------------------------------------------------------

test('a symlinked MEMORY.md is refused: its target is never read into the index, never replaced, no card is left behind', async () => {
  const s = stack();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-outside-'));
  try {
    const target = path.join(outside, 'notes.txt');
    fs.writeFileSync(target, 'top secret outside text\n');
    fs.rmSync(path.join(s.memory, 'MEMORY.md'));
    fs.symlinkSync(target, path.join(s.memory, 'MEMORY.md'));
    const store = createStore({ root: s.memory });
    await assert.rejects(() => store.remember(fact('a-claim')), err => err instanceof GuardError && /symbolic link/.test(err.message));
    assert.equal(fs.readFileSync(target, 'utf8'), 'top secret outside text\n', 'the outside file is untouched');
    assert.equal(fs.lstatSync(path.join(s.memory, 'MEMORY.md')).isSymbolicLink(), true, 'the link was not replaced');
    assert.equal(fs.existsSync(path.join(s.memory, 'a-claim.md')), false, 'no orphan card');
    assert.throws(() => store.read('MEMORY'), GuardError);
    assert.throws(() => store.list(), GuardError);
    assert.deepEqual(fs.readdirSync(s.memory).filter(f => f.endsWith('.tmp')), []);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); s.done(); }
});

// Several stdio servers on one folder are separate processes (Phase 5). Each child below is a
// whole store of its own; the in-process queue cannot see the others.
const WRITER = `
const { createStore } = require(process.argv[1]);
const [root, prefix, count] = [process.argv[2], process.argv[3], Number(process.argv[4])];
(async () => {
  const store = createStore({ root });
  for (let i = 0; i < count; i += 1) {
    await store.remember({ name: prefix + '-' + i, description: 'One line.', type: 'user', body: 'A fact.' });
  }
})().catch(e => { console.error(e.stack); process.exit(1); });
`;
const runWriter = (memory, prefix, count) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['-e', WRITER, path.join(repo, 'npx/lib/store.js'), memory, prefix, String(count)], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', c => { err += c; });
  child.on('close', code => (code === 0 ? resolve() : reject(new Error(err))));
});

test('separate processes writing one folder at once never lose an index pointer', async () => {
  const s = stack();
  try {
    await Promise.all([runWriter(s.memory, 'alpha', 40), runWriter(s.memory, 'beta', 40), runWriter(s.memory, 'gamma', 40)]);
    const verdict = s.validate();
    assert.equal(verdict.status, 0, verdict.stdout);
    assert.match(verdict.stdout, /120 card\(s\): 120 pointered/);
    assert.equal(fs.existsSync(path.join(s.memory, '.memory-index.lock')), false, 'the lock is released');
  } finally { s.done(); }
});

test('a held index lock makes remember wait, then refuse with a clear error and leave no card; a stale lock is broken', async () => {
  const s = stack();
  try {
    const lock = path.join(s.memory, '.memory-index.lock');
    fs.writeFileSync(lock, 'someone else');
    const impatient = createStore({ root: s.memory, lockWaitMs: 150, lockStaleMs: 60000 });
    await assert.rejects(() => impatient.remember(fact('blocked')), err => err instanceof InputError && /busy/.test(err.message));
    assert.equal(fs.existsSync(path.join(s.memory, 'blocked.md')), false, 'no orphan card when the index could not be updated');
    assert.equal(fs.existsSync(lock), true, 'a live lock is not stolen');

    const old = new Date(Date.now() - 120000);
    fs.utimesSync(lock, old, old);
    const patient = createStore({ root: s.memory, lockWaitMs: 2000, lockStaleMs: 1000 });
    await patient.remember(fact('after-stale'));
    assert.match(fs.readFileSync(path.join(s.memory, 'MEMORY.md'), 'utf8'), /- after-stale\.md - /);
    assert.equal(fs.existsSync(lock), false);
  } finally { s.done(); }
});

// ---- r3 hardening -------------------------------------------------------------------------

test('a dangling MEMORY.md symlink (it looks absent to a path check) is refused: nothing is created through it, no card is left', async () => {
  const s = stack();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-outside-'));
  try {
    const target = path.join(outside, 'not-yet.txt');
    fs.rmSync(path.join(s.memory, 'MEMORY.md'));
    fs.symlinkSync(target, path.join(s.memory, 'MEMORY.md'));
    const store = createStore({ root: s.memory });
    await assert.rejects(() => store.remember(fact('a-claim')), err => err instanceof GuardError && /symbolic link/.test(err.message));
    assert.equal(fs.existsSync(target), false, 'nothing was created at the link target');
    assert.equal(fs.existsSync(path.join(s.memory, 'a-claim.md')), false);
    assert.equal(fs.lstatSync(path.join(s.memory, 'MEMORY.md')).isSymbolicLink(), true);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); s.done(); }
});

test('a card with no index line (an earlier call stopped halfway) is finished by retrying the same call, once', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    const indexPath = path.join(s.memory, 'MEMORY.md');
    const before = fs.readFileSync(indexPath, 'utf8');
    await store.remember(fact('half-done'));
    fs.writeFileSync(indexPath, before); // the crash: the card is on disk, the index never got its line
    assert.deepEqual(store.list().map(c => [c.name, c.inIndex]), [['half-done', false]]);

    const retried = await store.remember(fact('half-done'));
    assert.equal(retried.file, 'half-done.md');
    assert.deepEqual(store.list().map(c => [c.name, c.inIndex]), [['half-done', true]]);
    const lines = fs.readFileSync(indexPath, 'utf8').split('\n').filter(l => l.startsWith('- half-done.md'));
    assert.equal(lines.length, 1, 'exactly one index line');
    assert.equal(s.validate().status, 0);

    await assert.rejects(() => store.remember(fact('half-done')), /already exists/); // now it is a real duplicate
    assert.equal(fs.readFileSync(indexPath, 'utf8').split('\n').filter(l => l.startsWith('- half-done.md')).length, 1);
  } finally { s.done(); }
});

test('an unindexed card with different content is somebody else\'s card: refused, never overwritten, never indexed', async () => {
  const s = stack();
  try {
    fs.writeFileSync(path.join(s.memory, 'hand-written.md'), '---\nname: hand-written\ndescription: Written by an agent.\ntype: user\n---\n\nTheir text.\n');
    const store = createStore({ root: s.memory });
    const index = fs.readFileSync(path.join(s.memory, 'MEMORY.md'), 'utf8');
    await assert.rejects(() => store.remember(fact('hand-written')), /already exists/);
    assert.match(fs.readFileSync(path.join(s.memory, 'hand-written.md'), 'utf8'), /Their text/);
    assert.equal(fs.readFileSync(path.join(s.memory, 'MEMORY.md'), 'utf8'), index, 'the index is untouched');
  } finally { s.done(); }
});

test('a lock whose owner changed before the commit stops the write: the index is not replaced', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    const real = fs.writeFileSync;
    const index = fs.readFileSync(path.join(s.memory, 'MEMORY.md'), 'utf8');
    const lockFile = path.join(s.memory, '.memory-index.lock');
    // someone takes over the lock file after our temp index is written and before we commit it
    const { mock } = await import('node:test');
    let swapped = false;
    const patched = mock.method(fs, 'writeFileSync', (file, ...rest) => {
      const result = real(file, ...rest);
      if (typeof file === 'number' && !swapped && fs.readdirSync(s.memory).some(f => f.startsWith('MEMORY.md.') && f.endsWith('.tmp'))) {
        swapped = true;
        fs.rmSync(lockFile);
        real(lockFile, `${'a'.repeat(32)}\n${process.pid}\nsomewhere\n`);
      }
      return result;
    });
    try {
      await assert.rejects(() => store.remember(fact('late-write')), err => err instanceof InputError && /send the same request again/.test(err.message));
    } finally { patched.mock.restore(); }
    assert.equal(swapped, true);
    assert.equal(fs.readFileSync(path.join(s.memory, 'MEMORY.md'), 'utf8'), index, 'the index was not replaced');
    assert.deepEqual(fs.readdirSync(s.memory).filter(f => f.endsWith('.tmp')), []);
  } finally { s.done(); }
});
