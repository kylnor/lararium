// Shared scanning code for the contributor tests. Not shipped to a personal stack (tests/ is
// contributor-only, see CONTRIBUTOR_ONLY in npx/index.js).
//
// Two kinds of leak, scanned separately:
//   names:   the owner's cast, mythology, family and infrastructure. Allowed only where a place is
//            named in NAME_ALLOWED_PREFIXES / NAME_ALLOWED_FILES, and only in the repo tree, never
//            in a scaffolded stack.
//   private: absolute home paths, credentials, hosts, addresses. Allowed NOWHERE by place. A fictional
//            example earns an exemption for its exact matched string, never for a whole file.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Words are matched as letter runs: not preceded or followed by a letter, so `oracle_assistant`,
// `oracle-bot` and `Oracle9` match while `urbane` and `Robinson` do not. camelCase is split first,
// so `oracleAssistant` matches too. Multiword names tolerate any separator.
export const NAMES = [
  // the themed roster (every file name under agents/examples/ must be covered here or in GENERIC)
  'oracle', 'batman', 'gotham', 'alfred', 'robin', 'nightwing', 'batgirl', 'batwing', 'riddler',
  'joker', 'bane', 'catwoman', 'harvey', 'lucius', 'barbara', 'damian', 'wayne', 'huginn', 'muninn',
  'mimir', 'scarecrow', 'gardener', 'julia', 'red[-_ ]?hood', 'red[-_ ]?robin', 'two[-_ ]?face',
  'ras[-_ ]?al[-_ ]?ghul',
  // the owner's other crew, family and infrastructure
  'rowan', 'nova', 'kyle', 'kylnor', 'northup', 'riley', 'brittany', 'vordr', 'yggdrasil', 'brokkr',
  'belfry', 'skirnir', 'elorati', 'sotheby',
];
// Roster file names that are ordinary English words, so they are not banned as names. Adding a
// roster member that is in neither list fails the roster-coverage test on purpose.
export const GENERIC = ['mirror', 'signal', 'spoiler'];

const NAME_RE = new RegExp(`(?<![a-z])(?:${NAMES.join('|')})(?![a-z])`, 'gi');
const splitCamel = text => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

// The GitHub slug is the one name that must stay, and only the literal slug is exempt. The text
// around it is still scanned, so `github.com/kylnor/lararium?owner=Kyle` still flags "Kyle". The
// private-data scan never removes anything of the sort (a token inside a clone URL is still a token).
export const REPO_SLUG = 'kylnor/lararium';
const withoutSlug = text => text.split(REPO_SLUG).join(' ');

// Narrow, named exceptions. Each strips one exact string from one file before the scan, so the
// same file can still leak anything else.
export const EXACT_STRIPS = {
  // the MIT license must keep its copyright notice
  LICENSE: ['Copyright (c) 2026 Kyle Northup'],
  // the upgrade note must name the old command so a v2 owner can find the skill it replaced
  'UPGRADING.md': ['`/muninn`'],
};

// Where the repo tree (not a scaffolded stack) may carry names: the opt-in roster, the blog and the
// release history tell the story, and the contributor tests have to spell the list out.
// The same idea for private data: one exact synthetic string in one named file, for the contributor
// tests that have to spell a fake leak out to prove the scanner catches it. Anything else in the file,
// and the same string anywhere else, still counts. Prefer building a fixture at run time instead.
const SCRUB_TEST_FIXTURES = ['/home/alice/.ssh', 'box.tail1234.ts.net', 'sk-abcdefghijklmnopqrstuvwxyz0123', 'jane@corp.io'];
export const PRIVATE_EXACT_STRIPS = {
  // the scrub test spells fake leaks out to prove the scanner catches them; this file lists them
  'tests/persona-scrub.test.mjs': SCRUB_TEST_FIXTURES,
  'tests/persona-scan.mjs': SCRUB_TEST_FIXTURES,
};

export const NAME_ALLOWED_PREFIXES = ['agents/examples/', 'docs/blog/', 'tests/'];
export const NAME_ALLOWED_FILES = new Set(['CHANGELOG.md']);

export function nameHits(file, text) {
  let body = text;
  for (const s of EXACT_STRIPS[file] || []) body = body.split(s).join(' ');
  const found = [];
  body.split('\n').forEach((line, i) => {
    const clean = splitCamel(withoutSlug(line));
    for (const m of clean.matchAll(NAME_RE)) found.push(`${file}:${i + 1}: name "${m[0]}"  ${line.trim().slice(0, 100)}`);
  });
  return found;
}

export function nameHitsInPath(file) {
  const found = [];
  for (const m of splitCamel(withoutSlug(file)).matchAll(NAME_RE)) found.push(`${file}: name "${m[0]}" in the path`);
  return found;
}

const PRIVATE = [
  ['home path', /\/(?:home|Users)\/[A-Za-z][\w.-]*/g],
  ['api key', /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[bap]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})/g],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g],
  ['ip address', /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g],
  ['tailnet host', /\b[\w-]+\.ts\.net\b/g],
];
// Fictional or documented placeholders, exempted by the exact matched string wherever they appear.
const PRIVATE_PLACEHOLDERS = new Set([
  '/Users/yourname', '/home/you', '/home/it', 'AKIAIOSFODNN7EXAMPLE', '0.0.0.0', '127.0.0.1',
  'git@github.com', // the ssh user every GitHub remote uses, not an address
]);
const PLACEHOLDER_EMAIL = /@(?:example\.(?:com|org|net)|users\.noreply\.github\.com)$/i;

export function privateHits(file, text) {
  let body = text;
  for (const s of PRIVATE_EXACT_STRIPS[file] || []) body = body.split(s).join(' ');
  const found = [];
  body.split('\n').forEach((line, i) => {
    const clean = line;
    for (const [kind, re] of PRIVATE) {
      for (const m of clean.matchAll(re)) {
        if (PRIVATE_PLACEHOLDERS.has(m[0]) || (kind === 'email' && PLACEHOLDER_EMAIL.test(m[0]))) continue;
        found.push(`${file}:${i + 1}: ${kind} "${m[0]}"  ${line.trim().slice(0, 100)}`);
      }
    }
  });
  return found;
}

// Every file of a git checkout (tracked files, so ignored build debris cannot hide or fake a hit).
export function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
}

// Every file of a plain folder, such as a freshly scaffolded stack. Skips .git, follows no links.
export function walkFiles(root, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name);
    if (entry.name === '.git') continue;
    if (entry.isDirectory()) out.push(...walkFiles(root, next));
    else if (entry.isFile()) out.push(next.split(path.sep).join('/'));
  }
  return out;
}

// Returns null for a binary file (the caller counts those); an unreadable file throws, because a
// scan that silently skips what it cannot read gives false assurance.
export function readText(root, file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  return text.includes('\0') ? null : text;
}

// Scan a file list for names and private data. `namesAllowedHere(file)` says where names are
// tolerated (the repo tree only); private data is checked in every file regardless.
export function scan(root, files, namesAllowedHere = () => false) {
  const found = [];
  for (const file of files) {
    const text = readText(root, file);
    if (text === null) continue;
    if (!namesAllowedHere(file)) found.push(...nameHitsInPath(file), ...nameHits(file, text));
    found.push(...privateHits(file, text));
  }
  return found;
}
