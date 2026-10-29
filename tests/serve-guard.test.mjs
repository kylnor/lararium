// Path traversal on the memory server's read and remember. The server takes a card name from a
// tool call, so the name must never be able to reach a file outside the memory folder.
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
const { createStore, GuardError, InputError } = require(path.join(repo, 'npx/lib/store.js'));
const { resolveInside } = require(path.join(repo, 'npx/lib/guard.js'));

const SECRET = 'outside-the-folder-secret';

// A folder with a memory/ inside it and a sibling file the server must never reach.
function sandbox() {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-guard-'));
  const memory = path.join(top, 'memory');
  fs.mkdirSync(memory);
  fs.writeFileSync(path.join(top, 'secret.md'), SECRET);
  fs.writeFileSync(path.join(memory, 'inside.md'), '---\nname: inside\ndescription: d\ntype: user\n---\n\nhello\n');
  return { top, memory, done: () => fs.rmSync(top, { recursive: true, force: true }) };
}

const PROBES = [
  '../secret', '../secret.md', '..\\secret', '../../etc/passwd', '/etc/passwd', 'sub/../../secret',
  '..', '.', './inside', 'inside/', '.hidden', 'a\0b', '%2e%2e/secret', '....//secret', 'inside.md/../../secret',
];

test('probe sanity: a naive join-and-read DOES escape the folder with these probes', () => {
  // If this stops being true, the guard tests below are not testing anything.
  const s = sandbox();
  try {
    const naive = name => fs.readFileSync(path.join(s.memory, name.endsWith('.md') ? name : `${name}.md`), 'utf8');
    assert.equal(naive('../secret'), SECRET);
    assert.equal(naive('../secret.md'), SECRET);
  } finally { s.done(); }
});

test('read refuses every traversal probe and never returns the outside file', () => {
  const s = sandbox();
  try {
    const store = createStore({ root: s.memory });
    for (const probe of PROBES) {
      assert.throws(() => store.read(probe), error => error instanceof GuardError || error instanceof InputError, `read(${JSON.stringify(probe)}) must be refused`);
    }
    assert.match(store.read('inside').text, /hello/);
    assert.match(store.read('inside.md').text, /hello/);
  } finally { s.done(); }
});

test('remember refuses traversal names and writes nothing outside the folder', async () => {
  const s = sandbox();
  try {
    const store = createStore({ root: s.memory });
    const before = fs.readdirSync(s.top).sort();
    for (const probe of PROBES) {
      await assert.rejects(() => store.remember({ name: probe, description: 'd', type: 'user', body: 'x' }), undefined, `remember(${JSON.stringify(probe)}) must be refused`);
    }
    assert.deepEqual(fs.readdirSync(s.top).sort(), before);
    assert.equal(fs.readFileSync(path.join(s.top, 'secret.md'), 'utf8'), SECRET);
  } finally { s.done(); }
});

test('a symlink inside the folder that points outside is refused, for read and for remember', async () => {
  const s = sandbox();
  try {
    fs.symlinkSync(path.join(s.top, 'secret.md'), path.join(s.memory, 'link.md'));
    fs.symlinkSync(path.join(s.top, 'planted.md'), path.join(s.memory, 'dangling.md'));
    const store = createStore({ root: s.memory });
    assert.throws(() => store.read('link'), GuardError);
    assert.throws(() => resolveInside(s.memory, 'link'), GuardError);
    await assert.rejects(() => store.remember({ name: 'dangling', description: 'd', type: 'user', body: 'x' }));
    assert.equal(fs.existsSync(path.join(s.top, 'planted.md')), false);
    assert.equal(fs.readFileSync(path.join(s.top, 'secret.md'), 'utf8'), SECRET);
    assert.deepEqual(store.list().map(c => c.name), ['inside']);
  } finally { s.done(); }
});

test('a memory folder that is itself a symlink still works', () => {
  const s = sandbox();
  try {
    const alias = path.join(s.top, 'alias');
    fs.symlinkSync(s.memory, alias);
    const store = createStore({ root: alias });
    assert.match(store.read('inside').text, /hello/);
    assert.throws(() => store.read('../secret'), GuardError);
  } finally { s.done(); }
});
