// The default install must not carry anyone's private flavor: not the owner's cast, mythology or
// family, and not private paths, hosts or credentials. This is the repo-tree half of the scrub; the
// half that matters (the scaffolded stack a stranger actually receives) is tests/scaffold.test.mjs.
//
// LARARIUM_SCRUB_ROOT points the scan at another git checkout, used to prove the test fails on an
// older tree. Node 18 compatible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NAMES, GENERIC, NAME_ALLOWED_PREFIXES, NAME_ALLOWED_FILES,
  nameHits, nameHitsInPath, privateHits, scan, trackedFiles, readText,
} from './persona-scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.LARARIUM_SCRUB_ROOT ? path.resolve(process.env.LARARIUM_SCRUB_ROOT) : path.resolve(here, '..');
const namesAllowedHere = file => NAME_ALLOWED_FILES.has(file) || NAME_ALLOWED_PREFIXES.some(p => file.startsWith(p));

test('no persona names outside the opt-in roster, blog, changelog and tests; no private data anywhere', () => {
  const files = trackedFiles(root);
  const found = scan(root, files, namesAllowedHere);
  assert.equal(found.length, 0, `${found.length} leak(s) in the repo tree:\n${found.join('\n')}`);
});

test('the scan reads every tracked file and says how many were binary', () => {
  const files = trackedFiles(root);
  const binary = files.filter(f => readText(root, f) === null);
  console.log(`# scanned ${files.length - binary.length} text files, skipped ${binary.length} binary: ${binary.join(', ') || 'none'}`);
  assert.ok(files.length > 50, 'expected a real tree');
  assert.ok(binary.length <= 5, `unexpectedly many binary files skipped:\n${binary.join('\n')}`);
});

test('every member of the example roster is a banned name, or listed as an ordinary word', () => {
  const dir = path.join(root, 'agents/examples');
  if (!fs.existsSync(dir)) return;
  const members = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    if (e.isDirectory()) walk(path.join(d, e.name));
    else if (e.name.endsWith('.md') && /^[a-z]/.test(e.name)) members.push(e.name.replace(/\.md$/, ''));
  });
  walk(dir);
  const uncovered = members.filter(m => !GENERIC.includes(m) && nameHits('x', m).length === 0);
  assert.deepEqual(uncovered, [], `roster members the scrub would not catch: ${uncovered.join(', ')}`);
  assert.ok(members.length > 20, 'expected the example roster to be present');
});

test('the scanner catches identifier variants, omitted names, and every match on a line', () => {
  const caught = text => nameHits('docs/x.md', text).length;
  for (const bad of ['oracle_assistant', 'oracleAssistant', 'OracleAssistant', 'oracle-bot', 'the rowan agent', 'a scarecrow', 'RedHood', 'red_robin', 'ras-al-ghul', 'Oracle9']) {
    assert.ok(caught(bad) >= 1, `missed: ${bad}`);
  }
  for (const fine of ['urbane', 'Robinson', 'a signal', 'the mirror', 'novaculite']) {
    assert.equal(caught(fine), 0, `false positive: ${fine}`);
  }
  assert.equal(caught('Kyle asked Alfred'), 2, 'every match counts, not only the first');
  assert.deepEqual(nameHitsInPath('skills/defs/oracleHelper/SKILL.md').length, 1);
});

test('exceptions are exact strings in named files, not blanket passes', () => {
  assert.equal(nameHits('UPGRADING.md', 'The skill `/muninn` is now `/curate`.').length, 0);
  assert.ok(nameHits('UPGRADING.md', 'Rename /muninn for Kyle.').length >= 2, 'bare mention and a second name both count');
  assert.ok(nameHits('README.md', 'The skill `/muninn` is gone.').length >= 1, 'the exception is for UPGRADING.md only');
  assert.equal(nameHits('LICENSE', 'Copyright (c) 2026 Kyle Northup').length, 0);
  assert.ok(nameHits('LICENSE', 'Copyright (c) 2026 Kyle Northup and Alfred').length >= 1);
  assert.equal(nameHits('npx/package.json', '"url": "https://github.com/kylnor/lararium.git"').length, 0);
  assert.ok(nameHits('README.md', 'kylnor/lararium belongs to Kyle').length >= 1);
});

test('private data is flagged in every place, fictional examples included', () => {
  assert.ok(privateHits('agents/examples/x.md', 'config at /home/alice/.ssh').length >= 1);
  assert.ok(privateHits('docs/blog/x.md', 'host box.tail1234.ts.net').length >= 1);
  assert.ok(privateHits('docs/blog/x.md', 'token sk-abcdefghijklmnopqrstuvwxyz0123').length >= 1);
  assert.ok(privateHits('docs/blog/x.md', 'write to jane@corp.io').length >= 1);
  assert.equal(privateHits('docs/blog/x.md', 'path /Users/yourname/brain and jane@example.com').length, 0);
  assert.ok(NAMES.length > 40);
});
