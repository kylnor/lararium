// Guards for the setup path a stranger actually walks: one front door, no stale config advice,
// the router and update nudge saying what the docs say, and no em or en dashes in shipped docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const DASH = /[\u2013\u2014]/;

test('the scaffolder and the README send a newcomer to the starter first, INSTALL.md second', () => {
  const closing = read('npx/index.js');
  assert.ok(closing.indexOf('starter/README.md') > 0 && closing.indexOf('starter/README.md') < closing.lastIndexOf('INSTALL.md'));
  assert.ok(!/Then say: "Run the install interview/.test(closing), 'the closing line no longer leads with the full interview');
  const readme = read('README.md');
  const start = readme.indexOf('## Start here in five minutes');
  const how = readme.indexOf('## Getting it onto your machine');
  assert.ok(start > 0 && how > start);
  const section = readme.slice(start, how);
  assert.match(section.slice(0, section.indexOf('Run the starter')), /Get the folder first/, '"open the folder" is preceded by how to get one');
  assert.match(readme, /npx lararium my-stack/);
  const install = read('INSTALL.md');
  assert.ok(install.indexOf('The first question, before anything else') > 0 && install.indexOf('The first question') < install.indexOf('## Phase 0'));
});

test('INSTALL.md numbered steps do not repeat inside a phase', () => {
  const phases = read('INSTALL.md').split(/^## /m);
  for (const phase of phases) {
    const nums = [...phase.matchAll(/^(\d+)\. /gm)].map(m => Number(m[1]));
    // a phase may contain two separate lists (the end-of-phase checklist), so only flag a repeat
    // that is not a restart at 1
    for (let i = 1; i < nums.length; i++) assert.ok(nums[i] !== nums[i - 1], `repeated step ${nums[i]} in: ${phase.split('\n')[0]}`);
  }
});

test('INSTALL.md pointer step runs --check for the chosen scope and says what exit 1 means', () => {
  const install = read('INSTALL.md');
  assert.match(install, /--project --check/);
  assert.match(install, /Exit code 1 means "would write"/);
  assert.match(install, /confirm `STACK_VERSION` is at the root/);
});

test('the update checker needs no localVersionFile in the normal install, and says so', () => {
  const example = JSON.parse(read('hooks/settings.example.json'));
  assert.ok(!('localVersionFile' in example.stackUpdateCheck), 'settings.example.json must not ship a placeholder path');
  for (const rel of ['hooks/README.md', 'hooks/reference/update-check.js', 'hooks/settings.example.json', 'UPGRADING.md']) {
    assert.ok(!/interview fills in|interview writes this key|install interview writes your real path/.test(read(rel)), `${rel} still says the interview writes localVersionFile`);
  }
  assert.match(read('hooks/reference/update-check.js'), /skills\/defs\/upgrade\/SKILL\.md/);
  assert.ok(fs.existsSync(path.join(root, 'skills/defs/upgrade/SKILL.md')), 'the nudge names a file that exists');
});

test('hooks/README.md counts the hooks the example settings really wire', () => {
  const example = JSON.parse(read('hooks/settings.example.json'));
  let wired = 0;
  for (const entries of Object.values(example.hooks)) for (const entry of entries) wired += entry.hooks.length;
  assert.equal(wired, 8);
  assert.match(read('hooks/README.md'), /all eight reference hooks/);
});

test('the dispatch router policy names the shipped defs and no architect', () => {
  const run = type => spawnSync(process.execPath, [path.join(root, 'hooks/reference/agent-model-router.js')], {
    input: JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: type, prompt: 'x' } }), encoding: 'utf8',
  });
  for (const type of ['reviewer', 'researcher', 'verifier']) {
    assert.match(run(type).stdout, /"model":"sonnet"/, `${type} gets a policy model`);
  }
  assert.equal(run('architect').stdout.trim(), '', 'architect is not in the policy');
});

test('agent defs do not ask a no-Bash agent to run commands', () => {
  for (const rel of ['agents/defs/reviewer.md', 'agents/defs/verifier.md']) {
    const text = read(rel);
    assert.match(text, /caller pastes/);
    assert.ok(!/the caller pastes the command and its output/.test(text));
  }
  assert.match(read('agents/README.md'), /Review is case 4 because it must not write/);
  assert.match(read('agents/patrol/patrol.sh'), /NOT the\s+verifier agent/);
});

test('shipped docs carry no em or en dash', () => {
  for (const rel of ['docs/teams-ingestion-setup.md', 'README.md', 'INSTALL.md', 'starter/README.md', 'agents/README.md', 'hooks/README.md', 'UPGRADING.md', 'memory/pointer-block.md']) {
    const lines = read(rel).split('\n');
    const bad = lines.map((l, i) => (DASH.test(l) ? `${rel}:${i + 1}` : null)).filter(Boolean);
    assert.deepEqual(bad, [], `dashes in ${bad.join(', ')}`);
  }
});
