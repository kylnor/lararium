import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(dir, 'memory-pointers.mjs');
const repo = path.resolve(dir, '..');
const START = '<!-- lararium:shared-memory:start -->';
const count = (text, needle) => text.split(needle).length - 1;

function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-pointers-'));
  const home = path.join(base, 'home');
  const stack = path.join(base, 'my stack');
  fs.mkdirSync(path.join(stack, 'memory'), { recursive: true });
  fs.copyFileSync(path.join(repo, 'memory/pointer-block.md'), path.join(stack, 'memory/pointer-block.md'));
  for (const d of ['.claude', '.codex', '.gemini']) fs.mkdirSync(path.join(home, d), { recursive: true });
  const run = (...extra) => spawnSync(process.execPath, [script, stack, '--home', home, ...extra], { encoding: 'utf8' });
  return { base, home, stack, run, files: { claude: path.join(home, '.claude/CLAUDE.md'), codex: path.join(home, '.codex/AGENTS.md'), gemini: path.join(home, '.gemini/GEMINI.md') } };
}

test('writes one block per installed CLI, fills the real path, and is idempotent', () => {
  const s = sandbox();
  try {
    fs.rmSync(path.join(s.home, '.gemini'), { recursive: true });
    const first = s.run();
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.match(first.stdout, /gemini +skipped/);
    assert.equal(fs.existsSync(s.files.gemini), false);
    const claude = fs.readFileSync(s.files.claude, 'utf8');
    assert.equal(count(claude, START), 1);
    assert.ok(claude.includes(`${s.stack}/CLAUDE.md`));
    assert.ok(!claude.includes('{{'));
    assert.equal(claude, fs.readFileSync(s.files.codex, 'utf8'));
    const second = s.run();
    assert.equal(second.status, 0);
    assert.match(second.stdout, /claude +unchanged/);
    assert.equal(fs.readFileSync(s.files.claude, 'utf8'), claude);
    assert.equal(s.run('--check').status, 0);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('appends after other tools managed blocks, keeps them intact, and updates in place when the root moves', () => {
  const s = sandbox();
  try {
    const managed = 'my own rule\n\n<!-- nodeterm:context:start -->\ntool text\n<!-- nodeterm:context:end -->\n';
    fs.writeFileSync(s.files.codex, managed);
    assert.equal(s.run().status, 0);
    const written = fs.readFileSync(s.files.codex, 'utf8');
    assert.ok(written.startsWith(managed));
    assert.ok(written.indexOf(START) > written.indexOf('nodeterm:context:end'));
    const moved = path.join(s.base, 'moved');
    fs.mkdirSync(path.join(moved, 'memory'), { recursive: true });
    fs.copyFileSync(path.join(repo, 'memory/pointer-block.md'), path.join(moved, 'memory/pointer-block.md'));
    const rerun = spawnSync(process.execPath, [script, moved, '--home', s.home], { encoding: 'utf8' });
    assert.match(rerun.stdout, /codex +updated/);
    const after = fs.readFileSync(s.files.codex, 'utf8');
    assert.equal(count(after, START), 1);
    assert.ok(after.startsWith(managed));
    assert.ok(after.includes(`${moved}/CLAUDE.md`) && !after.includes(s.stack));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('refuses unsafe files instead of guessing, and --check writes nothing', () => {
  const s = sandbox();
  try {
    fs.writeFileSync(s.files.codex, 'rules\n<!-- other-tool:start -->\nnever closed\n');
    fs.writeFileSync(s.files.gemini, `${START}\nhalf a block\n`);
    const before = [s.files.codex, s.files.gemini].map(f => fs.readFileSync(f, 'utf8'));
    const dry = s.run('--check', '--only', 'claude');
    assert.equal(dry.status, 1);
    assert.match(dry.stdout, /would be written/);
    assert.equal(fs.existsSync(s.files.claude), false);
    const result = s.run();
    assert.equal(result.status, 1);
    assert.match(result.stdout, /codex +refused: the end of the file is inside an unclosed "other-tool" block/);
    assert.match(result.stdout, /gemini +refused: unbalanced/);
    assert.deepEqual([s.files.codex, s.files.gemini].map(f => fs.readFileSync(f, 'utf8')), before);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('writes through a symlinked instruction file and keeps it a link', () => {
  const s = sandbox();
  try {
    const real = path.join(s.base, 'dotfiles-claude.md');
    fs.writeFileSync(real, 'mine\n');
    fs.symlinkSync(real, s.files.claude);
    assert.equal(s.run('--only', 'claude').status, 0);
    assert.ok(fs.lstatSync(s.files.claude).isSymbolicLink());
    assert.equal(count(fs.readFileSync(real, 'utf8'), START), 1);
    assert.ok(fs.readFileSync(real, 'utf8').startsWith('mine\n'));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('--project writes AGENTS.md and GEMINI.md in the stack folder and touches nothing else', () => {
  const s = sandbox();
  try {
    const result = s.run('--project');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const name of ['AGENTS.md', 'GEMINI.md']) assert.equal(count(fs.readFileSync(path.join(s.stack, name), 'utf8'), START), 1);
    assert.equal(fs.existsSync(path.join(s.stack, 'CLAUDE.md')), false);
    for (const f of Object.values(s.files)) assert.equal(fs.existsSync(f), false);
    assert.match(s.run('--project').stdout, /codex +unchanged/);
    assert.equal(s.run('--project', '--only', 'claude').status, 2);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});
