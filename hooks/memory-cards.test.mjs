import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const check = path.join(dir, 'memory-check.mjs');
const card = (name, type = 'feedback') => `---\nname: ${name}\ndescription: A one-line hook for ${name}.\ntype: ${type}\n---\n\nBody.\n`;

function stack() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-cards-'));
  fs.mkdirSync(path.join(root, 'brain'));
  for (const f of ['CLAUDE.md', 'now.md']) fs.writeFileSync(path.join(root, 'brain', f), 'x');
  fs.mkdirSync(path.join(root, 'memory'));
  const env = { ...process.env, LARARIUM_ROOT: root };
  return { root, memory: path.join(root, 'memory'), run: () => spawnSync(process.execPath, [check, root], { encoding: 'utf8', env }) };
}

test('the shipped empty memory folder passes, and a card with a pointer or a demotion passes', () => {
  const s = stack();
  try {
    for (const f of ['MEMORY.md', 'DEMOTED.md']) fs.copyFileSync(path.join(dir, '..', 'memory', f), path.join(s.memory, f));
    assert.equal(s.run().status, 0);
    fs.writeFileSync(path.join(s.memory, 'prefers-short-replies.md'), card('prefers-short-replies'));
    fs.writeFileSync(path.join(s.memory, 'old-habit.md'), card('old-habit', 'user'));
    fs.appendFileSync(path.join(s.memory, 'MEMORY.md'), '- prefers-short-replies.md - short replies\n');
    fs.appendFileSync(path.join(s.memory, 'DEMOTED.md'), '- old-habit.md : one-time\n');
    const ok = s.run();
    assert.equal(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, /2 card\(s\): 1 pointered, 1 demoted on purpose/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('the server\'s remembered-journal is not a card: it is not counted, flagged or required to be pointered', () => {
  const s = stack();
  try {
    for (const f of ['MEMORY.md', 'DEMOTED.md']) fs.copyFileSync(path.join(dir, '..', 'memory', f), path.join(s.memory, f));
    fs.writeFileSync(path.join(s.memory, 'prefers-short-replies.md'), card('prefers-short-replies'));
    fs.appendFileSync(path.join(s.memory, 'MEMORY.md'), '- prefers-short-replies.md - short replies\n');
    fs.writeFileSync(path.join(s.memory, '.lararium-remembered'), 'prefers-short-replies.md\nghost-entry.md\n');
    const ok = s.run();
    assert.equal(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, /1 card\(s\): 1 pointered/);
    assert.doesNotMatch(ok.stdout, /lararium-remembered|ghost-entry/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('flags orphans, dangling pointers, bad frontmatter, and never edits the index', () => {
  const s = stack();
  try {
    fs.writeFileSync(path.join(s.memory, 'MEMORY.md'), '- ghost.md - points at nothing\n- [Linked](linked.md) - markdown link form\n');
    fs.writeFileSync(path.join(s.memory, 'linked.md'), card('linked'));
    fs.writeFileSync(path.join(s.memory, 'lonely.md'), card('lonely'));
    fs.writeFileSync(path.join(s.memory, 'wrong-name.md'), card('something-else'));
    fs.writeFileSync(path.join(s.memory, 'bad-type.md'), card('bad-type', 'note'));
    fs.writeFileSync(path.join(s.memory, 'bare.md'), 'no frontmatter');
    const before = fs.readFileSync(path.join(s.memory, 'MEMORY.md'), 'utf8');
    const result = s.run();
    assert.equal(result.status, 1);
    assert.match(result.stdout, /DANGLING pointer in MEMORY.md: ghost.md/);
    assert.match(result.stdout, /ORPHANED lonely.md/);
    assert.match(result.stdout, /wrong-name.md: frontmatter name "something-else"/);
    assert.match(result.stdout, /bad-type.md: type "note"/);
    assert.match(result.stdout, /bare.md: no frontmatter/);
    assert.doesNotMatch(result.stdout, /ORPHANED linked.md/);
    assert.equal(fs.readFileSync(path.join(s.memory, 'MEMORY.md'), 'utf8'), before);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('startup injects pointer lines from the index, nothing for an empty one, and cuts at 200 lines', () => {
  const s = stack();
  const start = () => spawnSync(process.execPath, [path.join(dir, 'reference/session-start.js')], { input: '{}', encoding: 'utf8', env: { ...process.env, LARARIUM_ROOT: s.root } }).stdout;
  try {
    fs.rmSync(path.join(s.root, 'brain', 'now.md'));
    fs.copyFileSync(path.join(dir, '..', 'memory', 'MEMORY.md'), path.join(s.memory, 'MEMORY.md'));
    assert.equal(start(), '');
    const lines = Array.from({ length: 230 }, (_, i) => `- card-${i}.md - hook ${i}`);
    fs.writeFileSync(path.join(s.memory, 'MEMORY.md'), `<!-- header, not injected -->\n${lines.join('\n')}\n`);
    const out = start();
    assert.match(out, /\[Memory index/);
    assert.match(out, /card-0\.md/);
    assert.match(out, /card-199\.md/);
    assert.doesNotMatch(out, /card-200\.md/);
    assert.doesNotMatch(out, /header, not injected/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
