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
  assert.equal(run('--check').status, 0, 'the written block checks clean');
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
