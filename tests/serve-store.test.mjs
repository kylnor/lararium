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
    assert.deepEqual(fs.readdirSync(s.memory).sort(), ['.lararium-remembered', 'DEMOTED.md', 'MEMORY.md', 'a-claim.md'], 'refused calls left no card and no journal line');
    assert.equal(fs.readFileSync(path.join(s.memory, '.lararium-remembered'), 'utf8'), '\na-claim.md\n');
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
    const dead = spawnSync(process.execPath, ['-e', '0']).pid; // a pid that has just exited
    const abandoned = `${'b'.repeat(32)}\n${dead}\n${os.hostname()}\n`;
    fs.writeFileSync(lock, abandoned);
    const impatient = createStore({ root: s.memory, lockWaitMs: 150, lockStaleMs: 60000 });
    await assert.rejects(() => impatient.remember(fact('blocked')), err => err instanceof InputError && /busy/.test(err.message));
    assert.equal(fs.existsSync(path.join(s.memory, 'blocked.md')), false, 'no orphan card when the index could not be updated');
    assert.equal(fs.existsSync(lock), true, 'a young lock is not stolen');

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

// ---- round 5: cards are canonical, a lost index line is a short-lived orphan that heals ----------

const journalFile = s => path.join(s.memory, '.lararium-remembered');
const indexFile = s => path.join(s.memory, 'MEMORY.md');
const pointerNames = s => fs.readFileSync(indexFile(s), 'utf8').replace(/<!--[\s\S]*?-->/g, '').split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).split(' ')[0]);

test('remember journals the card it wrote: one whole line per card, in write order, and validate does not call the journal a card', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    await store.remember(fact('first-claim'));
    await store.remember(fact('second-claim'));
    assert.equal(fs.readFileSync(journalFile(s), 'utf8'), '\nfirst-claim.md\n\nsecond-claim.md\n');
    assert.deepEqual(store.cardFiles(), ['first-claim.md', 'second-claim.md']);
    const verdict = s.validate();
    assert.equal(verdict.status, 0, verdict.stdout);
    assert.match(verdict.stdout, /2 card\(s\): 2 pointered/);
  } finally { s.done(); }
});

test('a lost update (the index rewritten without B\'s line after B committed) is restored by the next remember, at the top region, with B\'s own description', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    await store.remember(fact('card-a'));
    const afterA = fs.readFileSync(indexFile(s), 'utf8');
    await store.remember(fact('card-b', { description: 'B\'s own hook line.' }));
    fs.writeFileSync(indexFile(s), afterA); // Codex round 4, reduced to its effect: A's stale rename lands over B's commit
    assert.deepEqual(pointerNames(s), ['card-a.md']);
    assert.match(s.validate().stdout, /ORPHANED card-b.md/, 'in between, the checker shows it as orphaned');

    await store.remember(fact('card-c'));
    assert.deepEqual(pointerNames(s), ['card-b.md', 'card-c.md', 'card-a.md'], 'B is back in the top region (a repaired line goes on top, so it is read first by the 200 line cut)');
    assert.match(fs.readFileSync(indexFile(s), 'utf8'), /^- card-b\.md - B's own hook line\.$/m);
    const verdict = s.validate();
    assert.equal(verdict.status, 0, verdict.stdout);
    assert.match(verdict.stdout, /3 card\(s\): 3 pointered/);
  } finally { s.done(); }
});

test('a fresh store start restores a dropped line (heal), and does nothing, not even take the lock, when nothing is missing', async () => {
  const s = stack();
  try {
    const first = createStore({ root: s.memory });
    await first.remember(fact('survivor'));
    const withLine = fs.readFileSync(indexFile(s), 'utf8');
    assert.equal(await createStore({ root: s.memory }).heal(), 0);
    assert.equal(fs.readFileSync(indexFile(s), 'utf8'), withLine, 'nothing to do, nothing rewritten');

    fs.writeFileSync(indexFile(s), '# Memory\n\n'); // the line is lost
    const restarted = createStore({ root: s.memory });
    assert.equal(await restarted.heal(), 1);
    assert.deepEqual(pointerNames(s), ['survivor.md']);
    assert.equal(s.validate().status, 0);
    assert.equal(fs.existsSync(path.join(s.memory, '.memory-index.lock')), false);
  } finally { s.done(); }
});

test('repair puts back several lines newest first, ahead of the entries that survived, and stops at once when it is complete', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    await store.remember(fact('one'));
    await store.remember(fact('two'));
    await store.remember(fact('three'));
    fs.writeFileSync(indexFile(s), '# Memory\n\n- one.md - the surviving line\n');
    assert.equal(await store.heal(), 2);
    assert.deepEqual(pointerNames(s), ['three.md', 'two.md', 'one.md']);
    assert.equal(await store.heal(), 0);
  } finally { s.done(); }
});

test('a demoted journaled card (line removed, listed in DEMOTED.md) is never re-added, by remember or by start', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    await store.remember(fact('keeper'));
    await store.remember(fact('old-habit'));
    fs.writeFileSync(indexFile(s), fs.readFileSync(indexFile(s), 'utf8').split('\n').filter(l => !l.startsWith('- old-habit.md')).join('\n'));
    fs.appendFileSync(path.join(s.memory, 'DEMOTED.md'), '- old-habit.md : one-time preference\n');

    await store.remember(fact('newcomer'));
    assert.deepEqual(pointerNames(s), ['newcomer.md', 'keeper.md']);
    assert.equal(await createStore({ root: s.memory }).heal(), 0);
    assert.deepEqual(pointerNames(s), ['newcomer.md', 'keeper.md']);
    assert.equal(fs.existsSync(path.join(s.memory, 'old-habit.md')), true, 'the card stays, pull-tier on purpose');
    await assert.rejects(() => store.remember(fact('old-habit')), /already exists/, 'an identical retry does not undo the demotion either');
    assert.deepEqual(pointerNames(s), ['newcomer.md', 'keeper.md']);
    const verdict = s.validate();
    assert.equal(verdict.status, 0, verdict.stdout);
    assert.match(verdict.stdout, /3 card\(s\): 2 pointered, 1 demoted on purpose/);
  } finally { s.done(); }
});

test('a hand-written card (not journaled) with no pointer is never touched; neither is a journal line for a card that is gone', async () => {
  const s = stack();
  try {
    fs.writeFileSync(path.join(s.memory, 'hand-written.md'), '---\nname: hand-written\ndescription: Written by an agent.\ntype: user\n---\n\nTheir text.\n');
    const store = createStore({ root: s.memory });
    await store.remember(fact('ours'));
    await store.remember(fact('deleted-later'));
    fs.rmSync(path.join(s.memory, 'deleted-later.md'));
    fs.writeFileSync(indexFile(s), '# Memory\n\n'); // everything dropped
    assert.equal(await store.heal(), 1);
    assert.deepEqual(pointerNames(s), ['ours.md'], 'only the journaled card that still exists came back');
    assert.match(s.validate().stdout, /ORPHANED hand-written.md/, 'the hand-written orphan is still the owner\'s to resolve');
    assert.match(fs.readFileSync(path.join(s.memory, 'hand-written.md'), 'utf8'), /Their text/);
  } finally { s.done(); }
});

test('journal lines that are not whole, well-formed card names are ignored (no path, no torn line, no foreign file)', async () => {
  const s = stack();
  try {
    fs.writeFileSync(path.join(s.memory, 'real-one.md'), '---\nname: real-one\ndescription: Real.\ntype: user\n---\n\nx\n');
    fs.writeFileSync(path.join(s.memory, 'torn.md'), '---\nname: torn\ndescription: Torn.\ntype: user\n---\n\nx\n');
    fs.writeFileSync(journalFile(s), ['../outside.md', 'Upper-Case.md', 'MEMORY.md', 'a b.md', 'real-one.md', 'real-one.md', 'torn.md'].join('\n')); // the last line has no newline
    const store = createStore({ root: s.memory });
    assert.equal(await store.heal(), 1);
    assert.deepEqual(pointerNames(s), ['real-one.md']);
  } finally { s.done(); }
});

test('a journal that is a symlink is refused before any card is written, and nothing is created through it', async () => {
  const s = stack();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-outside-'));
  try {
    const target = path.join(outside, 'victim.txt');
    fs.symlinkSync(target, journalFile(s)); // dangling
    const store = createStore({ root: s.memory });
    await assert.rejects(() => store.remember(fact('a-claim')), err => err instanceof GuardError && /symbolic link/.test(err.message));
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.existsSync(path.join(s.memory, 'a-claim.md')), false, 'no orphan card');
    await assert.rejects(() => store.heal().then(() => { throw new Error('should have refused'); }), () => true);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); s.done(); }
});

test('a card whose commit lost the lock stays on disk and journaled, and the next remember restores its line', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    const real = fs.writeFileSync;
    const lockFile = path.join(s.memory, '.memory-index.lock');
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
    fs.rmSync(lockFile);
    assert.deepEqual(pointerNames(s), [], 'the line did not land');
    assert.equal(fs.readFileSync(journalFile(s), 'utf8'), '\nlate-write.md\n', 'the card is journaled');
    assert.equal(await store.heal(), 1);
    assert.deepEqual(pointerNames(s), ['late-write.md']);
    assert.equal(s.validate().status, 0);
  } finally { s.done(); }
});

test('two processes each remembering 25 cards at once: all 50 cards, all 50 pointers, all 50 journal lines', async () => {
  const s = stack();
  try {
    await Promise.all([runWriter(s.memory, 'left', 25), runWriter(s.memory, 'right', 25)]);
    const verdict = s.validate();
    assert.equal(verdict.status, 0, verdict.stdout);
    assert.match(verdict.stdout, /50 card\(s\): 50 pointered/);
    assert.equal(pointerNames(s).length, 50);
    assert.equal(new Set(pointerNames(s)).size, 50);
    assert.equal(fs.readFileSync(journalFile(s), 'utf8').split('\n').filter(Boolean).length, 50);
    assert.deepEqual(fs.readdirSync(s.memory).filter(f => f.endsWith('.tmp') || f.endsWith('.lock') || f.endsWith('.reclaim')), []);
  } finally { s.done(); }
});

// ---- round 6: index injection, torn journal records, provenance for a retry -----------------------

const cardText = (s, name) => fs.readFileSync(path.join(s.memory, `${name}.md`), 'utf8');
const nothingWritten = (s, name) => {
  assert.equal(fs.existsSync(path.join(s.memory, `${name}.md`)), false, 'no card');
  assert.equal(fs.existsSync(journalFile(s)), false, 'no journal record');
};

test('r6 blocker 1: a description that carries an HTML comment marker or a control character is refused, and nothing is written', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    const index = fs.readFileSync(indexFile(s), 'utf8');
    for (const description of ['literal <!-- x --> marker', 'opens <!-- only', 'closes only --> here', '<!--', '-->', 'bell \u0007 inside', 'escape \u001b[2J inside']) {
      await assert.rejects(() => store.remember(fact('marked-card', { description })), err => err instanceof InputError && /description/.test(err.message), description);
      nothingWritten(s, 'marked-card');
    }
    assert.equal(fs.readFileSync(indexFile(s), 'utf8'), index);
    await store.remember(fact('marked-card', { description: 'A dash - and a < and a > are fine.' })); // only the markers and controls are refused
    assert.deepEqual(pointerNames(s), ['marked-card.md']);
  } finally { s.done(); }
});

test('r6 blocker 1: an index line with an inline comment is a pointer, so repair does not duplicate it, now or on a later remember', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    await store.remember(fact('inline-one'));
    const header = fs.readFileSync(indexFile(s), 'utf8').split('\n').slice(0, 5).join('\n'); // the shipped header comment
    fs.writeFileSync(indexFile(s), `${header}\n- inline-one.md - literal <!-- x --> marker\n`); // a hand-edited line, Codex's shape
    const before = fs.readFileSync(indexFile(s), 'utf8');
    assert.equal(await store.heal(), 0);
    assert.equal(fs.readFileSync(indexFile(s), 'utf8'), before, 'nothing was added');
    await store.remember(fact('inline-two'));
    assert.deepEqual(pointerNames(s), ['inline-two.md', 'inline-one.md'], 'one line per card, however many remembers');
    assert.equal(await store.heal(), 0);
  } finally { s.done(); }
});

test('r6 blocker 1: pointers and repair share one parser (comment blocks start at a line start; link and plain shapes both count)', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    for (const n of ['plain-card', 'linked-card', 'hidden-card']) await store.remember(fact(n));
    fs.writeFileSync(indexFile(s), '<!-- header\n- hidden-card.md - inside the comment\n-->\n- plain-card.md - x\n- [t](linked-card.md) - y\n');
    assert.deepEqual(store.list().map(c => [c.name, c.inIndex]), [['hidden-card', false], ['linked-card', true], ['plain-card', true]]);
    assert.equal(await store.heal(), 1, 'only the card whose line sits inside a comment comes back');
    assert.equal(pointerNames(s).filter(n => n === 'hidden-card.md').length, 1);
    assert.equal(s.validate().status, 0, s.validate().stdout);
  } finally { s.done(); }
});

test('r6 blocker 1: an index that ends inside an unclosed comment is refused by remember (no card) and left alone by repair', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    await store.remember(fact('before-the-break'));
    const broken = '# Memory\n\n<!-- never closed\n- some-note.md - hidden\n';
    fs.writeFileSync(indexFile(s), broken);
    const journal = fs.readFileSync(journalFile(s), 'utf8');
    await assert.rejects(() => store.remember(fact('after-the-break')), err => err instanceof InputError && /unclosed/.test(err.message));
    assert.equal(fs.existsSync(path.join(s.memory, 'after-the-break.md')), false, 'no card');
    assert.equal(await store.heal(), 0);
    assert.equal(await store.heal(), 0);
    assert.equal(fs.readFileSync(indexFile(s), 'utf8'), broken, 'the index is byte for byte what it was');
    assert.equal(fs.readFileSync(journalFile(s), 'utf8'), journal);
  } finally { s.done(); }
});

test('r6 blocker 1: repair is idempotent, and a hand-edited card description with a comment marker never reaches the index line', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    for (const n of ['one', 'two', 'three']) await store.remember(fact(n));
    fs.writeFileSync(path.join(s.memory, 'two.md'), cardText(s, 'two').replace(/^description: .*$/m, 'description: literal <!-- x --> marker'));
    fs.writeFileSync(indexFile(s), '# Memory\n\n');
    assert.equal(await store.heal(), 3);
    const once = fs.readFileSync(indexFile(s), 'utf8');
    assert.equal(await store.heal(), 0);
    assert.equal(await store.heal(), 0);
    assert.equal(fs.readFileSync(indexFile(s), 'utf8'), once, 'a second and third run change nothing');
    assert.equal(once.includes('<!--'), false);
    assert.deepEqual(pointerNames(s).sort(), ['one.md', 'three.md', 'two.md']);
    await store.remember(fact('four'));
    assert.equal(pointerNames(s).length, 4);
  } finally { s.done(); }
});

// A journal append that writes only the first few bytes and reports that count: a full disk, a signal.
async function withShortJournalWrite(fn) {
  const { mock } = await import('node:test');
  const real = fs.writeSync;
  let armed = true;
  const patched = mock.method(fs, 'writeSync', (fd, data, ...rest) => {
    if (!armed || !(typeof data === 'string' || Buffer.isBuffer(data)) || !/\.md\n$/.test(String(data))) return real(fd, data, ...rest);
    armed = false;
    return real(fd, typeof data === 'string' ? data.slice(0, 3) : data.subarray(0, 3)); // returns 3, not the full length
  });
  try { return await fn(); } finally { patched.mock.restore(); }
}

test('r6 blocker 2: a short journal write fails the remember and removes the card this call made; a later remember works and both recover after a dropped pointer', async () => {
  const s = stack();
  try {
    const store = createStore({ root: s.memory });
    const index = fs.readFileSync(indexFile(s), 'utf8');
    await withShortJournalWrite(() => assert.rejects(() => store.remember(fact('first-claim')), err => !(err instanceof GuardError) && /journal/.test(err.message)));
    assert.equal(fs.existsSync(path.join(s.memory, 'first-claim.md')), false, 'the card is gone: a failed remember leaves nothing');
    assert.equal(fs.readFileSync(indexFile(s), 'utf8'), index, 'and no index line');

    await store.remember(fact('second-claim'));
    fs.writeFileSync(indexFile(s), index); // the pointer is dropped
    assert.equal(await store.heal(), 1, 'the torn record before it did not eat it');
    assert.deepEqual(pointerNames(s), ['second-claim.md']);

    await store.remember(fact('first-claim')); // the same call, retried, now succeeds
    fs.writeFileSync(indexFile(s), index);
    assert.equal(await store.heal(), 2);
    assert.deepEqual(pointerNames(s).sort(), ['first-claim.md', 'second-claim.md']);
    assert.equal(s.validate().status, 0, s.validate().stdout);
  } finally { s.done(); }
});

test('r6 blocker 2: a torn record already in the journal cannot merge with the next one (records start with a newline)', async () => {
  const s = stack();
  try {
    fs.writeFileSync(journalFile(s), 'fir'); // the tail of an earlier torn append, no newline
    const store = createStore({ root: s.memory });
    await store.remember(fact('second-claim'));
    assert.equal(fs.readFileSync(journalFile(s), 'utf8'), 'fir\nsecond-claim.md\n');
    fs.writeFileSync(indexFile(s), '# Memory\n\n');
    assert.equal(await store.heal(), 1);
    assert.deepEqual(pointerNames(s), ['second-claim.md']);
  } finally { s.done(); }
});

test('r6 blocker 3: identical bytes are not provenance: an unjournaled hand-written card is refused and never journaled, a journaled one still retries once without a second record', async () => {
  const s = stack();
  const other = stack();
  try {
    await createStore({ root: other.memory }).remember(fact('copycat'));
    fs.writeFileSync(path.join(s.memory, 'copycat.md'), cardText(other, 'copycat')); // a hand-written card in the server's own format
    const store = createStore({ root: s.memory });
    const index = fs.readFileSync(indexFile(s), 'utf8');
    await assert.rejects(() => store.remember(fact('copycat')), err => err instanceof InputError && /a card named copycat already exists/.test(err.message));
    assert.equal(fs.existsSync(journalFile(s)), false, 'never journaled');
    assert.equal(fs.readFileSync(indexFile(s), 'utf8'), index, 'never indexed');
    assert.equal(await store.heal(), 0);
    assert.match(s.validate().stdout, /ORPHANED copycat.md/, 'still the owner\'s to resolve');

    await store.remember(fact('half-done')); // journaled, then its line is lost: the retry path
    fs.writeFileSync(indexFile(s), index);
    await store.remember(fact('half-done'));
    assert.equal(fs.readFileSync(journalFile(s), 'utf8'), '\nhalf-done.md\n', 'one record, not two');
    assert.deepEqual(pointerNames(s), ['half-done.md']);
  } finally { s.done(); other.done(); }
});
