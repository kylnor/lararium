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

function sandbox(stackName = 'my stack') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-pointers-'));
  const home = path.join(base, 'home');
  const stack = path.join(base, stackName);
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

test('--project writes CLAUDE.md, AGENTS.md and GEMINI.md in the stack folder and touches nothing else', () => {
  const s = sandbox();
  try {
    const result = s.run('--project');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const name of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) assert.equal(count(fs.readFileSync(path.join(s.stack, name), 'utf8'), START), 1, name);
    for (const f of Object.values(s.files)) assert.equal(fs.existsSync(f), false);
    assert.match(s.run('--project').stdout, /claude +unchanged/);
    assert.match(s.run('--project').stdout, /codex +unchanged/);
    assert.equal(s.run('--project', '--only', 'nonsense').status, 2);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('--project on an existing CLAUDE.md keeps every line of it and appends the block once, with the same protections', () => {
  const s = sandbox();
  try {
    const mine = '# My map\n\nnotes live in notes/\n';
    fs.writeFileSync(path.join(s.stack, 'CLAUDE.md'), mine);
    assert.equal(s.run('--project').status, 0);
    const after = fs.readFileSync(path.join(s.stack, 'CLAUDE.md'), 'utf8');
    assert.ok(after.startsWith(mine.trimEnd() + '\n\n' + START), 'the owner\'s text comes first, untouched');
    assert.equal(count(after, START), 1);
    assert.equal(s.run('--project', '--check').status, 0, 'a second run has nothing to write');
    // the foreign-block protections apply to CLAUDE.md like any other file
    const foreign = '# Map\n<!-- other-tool:start -->\nunclosed\n';
    fs.writeFileSync(path.join(s.stack, 'CLAUDE.md'), foreign);
    const refused = s.run('--project');
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /claude +refused/);
    assert.equal(fs.readFileSync(path.join(s.stack, 'CLAUDE.md'), 'utf8'), foreign);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('--project in the full install starts a new CLAUDE.md with the nested brain map, once', () => {
  const s = sandbox();
  try {
    fs.mkdirSync(path.join(s.stack, 'brain'));
    fs.writeFileSync(path.join(s.stack, 'brain/CLAUDE.md'), '# brain map\n');
    assert.equal(s.run('--project').status, 0);
    const text = fs.readFileSync(path.join(s.stack, 'CLAUDE.md'), 'utf8');
    assert.ok(text.startsWith('@brain/CLAUDE.md\n\n' + START), text);
    assert.match(s.run('--project').stdout, /claude +unchanged/);
    assert.equal(count(fs.readFileSync(path.join(s.stack, 'CLAUDE.md'), 'utf8'), '@brain/CLAUDE.md'), 1);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('the rendered block has no bare relative memory path, so a global install cannot start a second index', () => {
  const s = sandbox();
  try {
    assert.equal(s.run('--project').status, 0);
    const block = fs.readFileSync(path.join(s.stack, 'AGENTS.md'), 'utf8');
    const rest = block.split(`${s.stack}/memory/`).join('');
    assert.ok(!/memory\//.test(rest), `a relative memory/ path remains:\n${rest.split('\n').filter(l => /memory\//.test(l)).join('\n')}`);
    assert.ok(block.includes(`${s.stack}/memory/`));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('refuses a block that contains, overlaps or sits inside another tool\'s block, before replacing anything', () => {
  const cases = {
    nested: [`${START}\nold\n<!-- other:start -->\nforeign text\n<!-- other:end -->\n<!-- lararium:shared-memory:end -->\n`, /contains another tool's "other" marker/],
    overlapping: [`${START}\n<!-- other:start -->\n<!-- lararium:shared-memory:end -->\nmore\n<!-- other:end -->\n`, /contains another tool's "other" marker/],
    enclosing: [`<!-- other:start -->\n${START}\nold\n<!-- lararium:shared-memory:end -->\n<!-- other:end -->\n`, /sits inside another tool's "other" block/],
    'unclosed after an existing block': [`${START}\nold\n<!-- lararium:shared-memory:end -->\n<!-- other:start -->\nnever closed\n`, /unclosed "other" block/],
  };
  for (const [label, [content, message]] of Object.entries(cases)) {
    const s = sandbox();
    try {
      fs.writeFileSync(s.files.codex, content);
      const result = s.run('--only', 'codex');
      assert.equal(result.status, 1, `${label}: ${result.stdout}`);
      assert.match(result.stdout, message, label);
      assert.equal(fs.readFileSync(s.files.codex, 'utf8'), content, `${label}: file must be untouched`);
      assert.equal(s.run('--only', 'codex', '--check').status, 1, label);
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
});

test('still updates an old block in place when foreign blocks sit safely before and after it', () => {
  const s = sandbox();
  try {
    const before = '<!-- a:start -->\nA\n<!-- a:end -->\n\n';
    const after = '\n\n<!-- BEGIN b -->\nB\n<!-- END b -->\n';
    fs.writeFileSync(s.files.codex, `${before}${START}\nold text\n<!-- lararium:shared-memory:end -->${after}`);
    const result = s.run('--only', 'codex');
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /codex +updated/);
    const text = fs.readFileSync(s.files.codex, 'utf8');
    assert.ok(text.startsWith(before) && text.endsWith(after) && !text.includes('old text'));
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('refuses a dangling symlink instead of replacing it with a regular file', () => {
  const s = sandbox();
  try {
    const missing = path.join(s.base, 'dotfiles', 'nowhere.md');
    fs.symlinkSync(missing, s.files.claude);
    for (const extra of [[], ['--check']]) {
      const result = s.run('--only', 'claude', ...extra);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stdout, /claude +refused: .* is a symlink to .*nowhere\.md, which does not exist/);
    }
    assert.ok(fs.lstatSync(s.files.claude).isSymbolicLink(), 'the link must stay a link');
    assert.equal(fs.existsSync(missing), false, 'nothing may be created behind the link');
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('a stack path containing $& or $\' lands in the block literally', () => {
  const s = sandbox("stack $& and $' and $`x".replace('`', ''));
  try {
    assert.equal(s.run().status, 0);
    const claude = fs.readFileSync(s.files.claude, 'utf8');
    assert.ok(claude.includes(`${s.stack}/CLAUDE.md`), claude);
    assert.ok(claude.includes(`${s.stack}/memory/`));
    assert.ok(!claude.includes('{{'));
    assert.equal(count(claude, START), 1);
    assert.match(s.run().stdout, /claude +unchanged/);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('the generated grep command runs against a stack path with spaces and quotes, and finds a planted card', () => {
  for (const name of ['my stack', "it's a stack"]) {
    const s = sandbox(name);
    try {
      assert.equal(s.run('--only', 'claude').status, 0);
      const block = fs.readFileSync(s.files.claude, 'utf8');
      const command = block.split('\n').map(l => /`(grep -ril [^`]*)`/.exec(l)).find(Boolean)[1].replace('<term>', 'zebrafinch');
      fs.writeFileSync(path.join(s.stack, 'memory', 'card.md'), 'the zebrafinch lesson\n');
      const out = spawnSync('sh', ['-c', command], { encoding: 'utf8' });
      assert.equal(out.status, 0, `${command}\n${out.stderr}`);
      assert.equal(out.stdout.trim(), path.join(s.stack, 'memory', 'card.md'));
    } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
  }
});

test('--project says it covers one folder, names all three files, and where the blank map comes from', () => {
  const s = sandbox();
  try {
    const result = s.run('--project');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /in any folder/);
    assert.match(result.stdout, /CLAUDE\.md, AGENTS\.md and GEMINI\.md inside .* only: open a new Claude Code, Codex or Gemini CLI session in that folder/);
    assert.doesNotMatch(result.stdout, /not written by this command/);
    assert.match(result.stdout, /starter\/CLAUDE\.template\.md/);
    assert.match(s.run().stdout, /in any folder/);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('--project refuses inside a clone of the Lararium repository and leaves AGENTS.md alone', () => {
  const s = sandbox();
  try {
    const git = (...a) => spawnSync('git', ['-C', s.stack, ...a], { encoding: 'utf8' });
    assert.equal(git('init', '-q').status, 0);
    assert.equal(git('remote', 'add', 'origin', 'git@github.com:kylnor/lararium.git').status, 0);
    fs.writeFileSync(path.join(s.stack, 'AGENTS.md'), 'contributor guide\n');
    for (const extra of [[], ['--check']]) {
      const result = s.run('--project', ...extra);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /clone of the Lararium repository itself/);
    }
    assert.equal(fs.readFileSync(path.join(s.stack, 'AGENTS.md'), 'utf8'), 'contributor guide\n');
    assert.equal(fs.existsSync(path.join(s.stack, 'GEMINI.md')), false);
    assert.equal(git('remote', 'set-url', 'origin', 'https://github.com/someone/their-stack.git').status, 0);
    assert.equal(s.run('--project').status, 0);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('--project refuses an AGENTS.md carrying the contributor marker, wherever the stack came from', () => {
  const s = sandbox();
  try {
    const guide = '<!-- lararium:contributor-file -->\n# AGENTS.md\nContributor rules.\n';
    fs.writeFileSync(path.join(s.stack, 'AGENTS.md'), guide);
    for (const extra of [[], ['--check']]) {
      const result = s.run('--project', ...extra);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /contributor guide/);
    }
    assert.equal(fs.readFileSync(path.join(s.stack, 'AGENTS.md'), 'utf8'), guide);
    assert.equal(fs.existsSync(path.join(s.stack, 'GEMINI.md')), false);
    fs.writeFileSync(path.join(s.stack, 'AGENTS.md'), '# My own rules\n');
    assert.equal(s.run('--project').status, 0);
    assert.match(fs.readFileSync(path.join(s.stack, 'AGENTS.md'), 'utf8'), /^# My own rules/);
  } finally { fs.rmSync(s.base, { recursive: true, force: true }); }
});
