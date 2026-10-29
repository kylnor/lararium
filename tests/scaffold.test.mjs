// The test that matters for "no persona leaks": build the scaffolded stack the way a stranger gets
// it, and judge THAT. It archives the repo, pushes the archive through the real scaffolder code
// path (npx/index.js, unpack), then asserts what is absent and scrubs the resulting tree. It then
// runs the pointer installer inside the result, the way INSTALL.md tells a newcomer to.
//
// The archive is built from the git index (`git write-tree`), which is HEAD in CI and a fresh
// checkout, and also covers staged work locally. Set LARARIUM_ARCHIVE_REF to archive a specific ref.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan, walkFiles } from './persona-scan.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { unpack, CONTRIBUTOR_ONLY } = createRequire(import.meta.url)(path.join(repo, 'npx/index.js'));

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'scaffold test', GIT_AUTHOR_EMAIL: 'scaffold@example.com',
  GIT_COMMITTER_NAME: 'scaffold test', GIT_COMMITTER_EMAIL: 'scaffold@example.com',
};

let base;
let tarball;
const stackPath = name => path.join(base, name);

function scaffold(name, options) {
  const target = stackPath(name);
  fs.mkdirSync(target, { recursive: true });
  const realLog = console.log;
  console.log = () => {};
  const saved = process.env;
  process.env = GIT_ENV;
  try { unpack(tarball, target, options); } finally { process.env = saved; console.log = realLog; }
  return target;
}

before(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'lararium-scaffold-'));
  const ref = process.env.LARARIUM_ARCHIVE_REF || execFileSync('git', ['write-tree'], { cwd: repo, encoding: 'utf8' }).trim();
  tarball = path.join(base, 'stack.tar.gz');
  execFileSync('git', ['archive', '--format=tar.gz', '--prefix=lararium-test/', '-o', tarball, ref], { cwd: repo });
});
after(() => fs.rmSync(base, { recursive: true, force: true }));

test('a default scaffold carries no contributor file, no themed roster and no blog', () => {
  const target = scaffold('default');
  for (const gone of [...CONTRIBUTOR_ONLY, 'agents/examples']) {
    assert.equal(fs.existsSync(path.join(target, gone)), false, `${gone} must not be scaffolded`);
  }
  assert.ok(CONTRIBUTOR_ONLY.includes('AGENTS.md') && CONTRIBUTOR_ONLY.includes('SCRUB.md'));
  for (const kept of ['INSTALL.md', 'README.md', 'LICENSE', 'STACK_VERSION', 'agents/defs/reviewer.md', 'agents/defs/researcher.md', 'agents/defs/verifier.md', 'hooks/memory-pointers.mjs', 'memory/pointer-block.md', 'starter']) {
    assert.ok(fs.existsSync(path.join(target, kept)), `${kept} must be scaffolded`);
  }
  assert.deepEqual(fs.readdirSync(path.join(target, 'agents/defs')).sort(), ['researcher.md', 'reviewer.md', 'verifier.md']);
  // dropped before the first commit, so none of it sits in the stack's history either
  const tracked = execFileSync('git', ['ls-files'], { cwd: target, encoding: 'utf8' }).split('\n');
  assert.ok(tracked.includes('INSTALL.md'), 'the scaffolder made its initial commit');
  assert.ok(!tracked.some(f => /^(AGENTS\.md|SCRUB\.md|CHANGELOG\.md|docs\/blog\/|agents\/examples\/|tests\/)/.test(f)), 'contributor files are not in the initial commit');
});

test('the persona scrub passes on the scaffolded stack itself', () => {
  const target = scaffold('scrubbed');
  const files = walkFiles(target);
  const found = scan(target, files);
  console.log(`# scaffolded stack: ${files.length} files scanned for names and private data`);
  assert.equal(found.length, 0, `${found.length} leak(s) in the scaffolded stack:\n${found.join('\n')}`);
  assert.ok(files.length > 50);
});

test('--with-examples is the only way the themed roster arrives, and contributor files still stay out', () => {
  const target = scaffold('with-examples', { withExamples: true });
  assert.ok(fs.existsSync(path.join(target, 'agents/examples')));
  for (const gone of CONTRIBUTOR_ONLY) assert.equal(fs.existsSync(path.join(target, gone)), false, `${gone} leaked with --with-examples`);
});

test('scaffold, then --project: the stack gets its own AGENTS.md with the memory block and nothing from the contributor guide', () => {
  const target = scaffold('pointers');
  const home = path.join(base, 'home');
  fs.mkdirSync(home, { recursive: true });
  const run = (...args) => spawnSync(process.execPath, [path.join(target, 'hooks/memory-pointers.mjs'), target, '--project', '--home', home, ...args], { encoding: 'utf8' });
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const agents = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  assert.match(agents, /lararium:shared-memory:start/);
  assert.ok(!agents.includes('lararium:contributor-file'));
  assert.ok(!/contributor|Release ritual|nothing personal ever enters/i.test(agents), 'contributor text leaked into the stack AGENTS.md');
  // Claude Code reads CLAUDE.md, so a "this folder only" install must reach it too: the block, and
  // an import so the map the block names (brain/CLAUDE.md) actually loads.
  const claude = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
  assert.equal(claude.split('lararium:shared-memory:start').length - 1, 1, 'CLAUDE.md carries the block once');
  assert.ok(claude.startsWith('@brain/CLAUDE.md\n\n'), 'a new CLAUDE.md imports the brain map first');
  assert.ok(fs.existsSync(path.join(target, 'GEMINI.md')));
  assert.equal(run('--check').status, 0, 'the written block checks clean');
});

// The template and zip routes copy every file, contributor ones included. The docs tell the reader
// (and the assistant) to run a one-line cleanup. This test plays that route end to end, taking the
// cleanup list FROM the docs so a doc edit that drops an item fails here.
const MARKER = '<!-- lararium:contributor-file -->';
const CLEANUP = ['AGENTS.md', 'SCRUB.md', 'CHANGELOG.md', 'npx/', 'tests/', 'docs/blog/', '.github/', 'agents/examples/'];

function cleanupItems(file, startsWith) {
  const text = fs.readFileSync(path.join(repo, file), 'utf8');
  const at = text.indexOf(startsWith);
  assert.ok(at >= 0, `${file}: missing "${startsWith}"`);
  // the step or paragraph only: stop at a blank line or at the next numbered step
  const paragraph = text.slice(at + 1).split(/\n\s*\n|\n\d+\. /)[0];
  assert.ok(paragraph.includes(MARKER), `${file}: the cleanup names the contributor marker`);
  return [...new Set([...paragraph.matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(t => t !== MARKER))];
}

test('the docs name the same cleanup list, in the README, the starter and the install interview', () => {
  const spots = [
    ['README.md', 'One cleanup line for those two.'],
    ['starter/README.md', '0. Check where this folder came from.'],
    ['INSTALL.md', '0. Check where this folder came from.'],
  ];
  for (const [file, start] of spots) {
    const items = new Set(cleanupItems(file, start));
    for (const want of CLEANUP) assert.ok(items.has(want) || items.has(want.replace(/\/$/, '')), `${file} cleanup lacks ${want}`);
    assert.deepEqual([...items].filter(t => !CLEANUP.includes(t) && !CLEANUP.includes(t + '/')), [], `${file} cleanup names something not on the list`);
  }
  for (const f of [...CONTRIBUTOR_ONLY.map(x => x.split(path.sep).join('/'))]) {
    assert.ok(CLEANUP.some(c => c.replace(/\/$/, '') === f), `${f} is scaffolder-excluded but not in the doc cleanup list`);
  }
});

test('template route: a full copy is refused, the documented cleanup fixes it, then --project succeeds', () => {
  const target = path.join(base, 'template-copy');
  fs.mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '--strip-components=1', '-C', target]);
  const home = path.join(base, 'home-template');
  fs.mkdirSync(home, { recursive: true });
  const pointers = (...extra) => spawnSync(process.execPath, [path.join(target, 'hooks/memory-pointers.mjs'), target, '--project', '--home', home, ...extra], { encoding: 'utf8' });

  assert.ok(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8').startsWith(MARKER), 'a template copy starts with the contributor marker');
  assert.ok(fs.existsSync(path.join(target, '.github/workflows')), 'the copy carries the contributor CI');
  const refused = pointers();
  assert.equal(refused.status, 2, 'without the cleanup the pointer step refuses');

  // step 0, exactly as the starter writes it
  for (const rel of cleanupItems('starter/README.md', '0. Check where this folder came from.')) {
    fs.rmSync(path.join(target, rel), { recursive: true, force: true });
  }
  for (const gone of [...CLEANUP]) assert.equal(fs.existsSync(path.join(target, gone)), false, `${gone} should be gone`);

  const done = pointers();
  assert.equal(done.status, 0, done.stdout + done.stderr);
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
    assert.match(fs.readFileSync(path.join(target, f), 'utf8'), /lararium:shared-memory:start/, `${f} carries the block`);
  }
  assert.ok(!fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8').includes(MARKER));
  assert.equal(pointers('--check').status, 0);
});

test('--project refuses a stack that still holds the contributor guide, and leaves it untouched', () => {
  const target = scaffold('old-scaffold');
  const contributor = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
  fs.writeFileSync(path.join(target, 'AGENTS.md'), contributor);
  const home = path.join(base, 'home2');
  fs.mkdirSync(home, { recursive: true });
  const result = spawnSync(process.execPath, [path.join(target, 'hooks/memory-pointers.mjs'), target, '--project', '--home', home], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /contributor guide/);
  assert.equal(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8'), contributor);
});
