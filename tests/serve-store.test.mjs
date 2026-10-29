// The memory server's store: what `remember` writes must be exactly the v3 card format, so the
// shipped validator (hooks/memory-check.mjs) accepts it and any agent reading the files finds it.
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
const require = createRequire(import.meta.url);
const { createStore, InputError } = require(path.join(repo, 'npx/lib/store.js'));
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
