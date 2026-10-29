// The default install must not carry anyone's private flavor. Names from the owner's own roster
// (a themed cast, a mythology, a person) live only in agents/examples/, the blog and the changelog.
// This test greps every tracked file outside those places and fails on any hit, so a name that
// leaks back in fails CI instead of reaching a user who is not Batman.
//
// LARARIUM_SCRUB_ROOT points the scan at another git checkout (used to prove the test fails on an
// older tree). Node 18 compatible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.LARARIUM_SCRUB_ROOT ? path.resolve(process.env.LARARIUM_SCRUB_ROOT) : path.resolve(here, '..');

const BANNED = [
  'oracle', 'batman', 'gotham', 'alfred', 'robin', 'nightwing', 'batgirl', 'batwing', 'riddler',
  'joker', 'bane', 'catwoman', 'harvey', 'lucius', 'barbara', 'damian', 'wayne', 'huginn', 'muninn',
  'mimir', 'kyle', 'kylnor', 'northup',
];
const banned = new RegExp(`\\b(${BANNED.join('|')})\\b`, 'i');

// Where names are allowed: the opt-in example roster, the blog (the story), release history, the
// license, and this file (it has to spell the list out).
const ALLOWED_PREFIXES = ['agents/examples/', 'docs/blog/'];
const ALLOWED_FILES = new Set(['CHANGELOG.md', 'LICENSE', 'hooks/persona-scrub.test.mjs']);
// The one name that must stay: the GitHub repo this template is published from.
const REPO_SLUG = /kylnor\/lararium/gi;

// The one place an old name must appear: the upgrade note that tells a v2 user their skill was
// renamed. It names the old command so they can find it; nothing else in that file may.
const ALLOWED_TERMS = { 'UPGRADING.md': ['muninn'] };

const allowed = file => ALLOWED_FILES.has(file) || ALLOWED_PREFIXES.some(p => file.startsWith(p));

function hits() {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean).filter(f => !allowed(f));
  const found = [];
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    text.split('\n').forEach((line, i) => {
      const match = banned.exec(line.replace(REPO_SLUG, ''));
      if (match && !(ALLOWED_TERMS[file] || []).includes(match[1].toLowerCase())) found.push(`${file}:${i + 1}: "${match[1]}"  ${line.trim().slice(0, 100)}`);
    });
  }
  return found;
}

test('no persona or owner names outside agents/examples, docs/blog, CHANGELOG and LICENSE', () => {
  const found = hits();
  assert.equal(found.length, 0, `${found.length} persona leak(s) in the default install:\n${found.join('\n')}`);
});

test('filenames carry no persona names either', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).filter(f => !allowed(f));
  const named = files.filter(f => f.split(/[/._-]/).some(part => BANNED.includes(part.toLowerCase())));
  assert.deepEqual(named, [], `persona names in file paths:\n${named.join('\n')}`);
});
