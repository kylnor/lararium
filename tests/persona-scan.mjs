// Shared scanning code for the contributor tests. Not shipped to a personal stack (tests/ is
// contributor-only, see CONTRIBUTOR_ONLY in npx/index.js).
//
// Two kinds of leak, scanned separately:
//   names:   plain names are allowed only where a place is named in NAME_ALLOWED_PREFIXES /
//            NAME_ALLOWED_FILES, and only in the repo tree, never in a scaffolded stack.
//            Sealed names are allowed nowhere, including those places.
//   private: absolute home paths, credentials, hosts, addresses. Allowed NOWHERE by place. A fictional
//            example earns an exemption for its exact matched string, never for a whole file.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

// Words are matched as letter runs: not preceded or followed by a letter, so `oracle_assistant`,
// `oracle-bot` and `Oracle9` match while `urbane` and `Robinson` do not. camelCase is split first,
// so `oracleAssistant` matches too. Multiword names tolerate any separator.
export const NAMES = [
  // the themed roster (every file name under agents/examples/ must be covered here or in GENERIC)
  'oracle', 'batman', 'gotham', 'alfred', 'robin', 'nightwing', 'batgirl', 'batwing', 'riddler',
  'joker', 'bane', 'catwoman', 'harvey', 'lucius', 'barbara', 'damian', 'wayne', 'huginn', 'muninn',
  'mimir', 'scarecrow', 'gardener', 'julia', 'red[-_ ]?hood', 'red[-_ ]?robin', 'two[-_ ]?face',
  'ras[-_ ]?al[-_ ]?ghul',
  // the owner's three names already published by the license and repo slug
  'kyle', 'kylnor', 'northup',
];

export const NAME_SALT = 'lararium-scrub-v1';
export const hashName = word => createHash('sha256').update(`${NAME_SALT}:${word.toLowerCase()}`).digest('hex');

// Two crew names, two family first names, an employer word, a company word, five host and
// infrastructure names, and one canary. Sorted digests disclose no grouping or original order.
export const SEALED_NAMES = new Set([
  '09f94b007384087ec7e193e9e39ff780b85c9ec1cb4db965ba3ffc9cefff61dc',
  '0e2c5aa6dcca65183444debb2ad29d12817c3473a7a38ef206b603b03f9e638f',
  '37751416fb9021b72e9d81dd121de62daf0dc9c2bebd5bb5f3634234d039eaa1',
  '51190c1f7ede0dd01d75b906d35ef47a2acf03a67f59111d71fb04de9f807746',
  '7c7247a42f6404a0c973343b216e94e0952149b839ed57da1a81b2e96c3879c0',
  '7db35e77808372c0ebe9e81a8f583c3fbe67315e1c0f1b9a44516c4014475f4e',
  '9d2dc50b15405d0686eb46012d63b921be5bcf7c329c8e4094fb0ded0a2a1a94',
  'c4610b7e4009cb7c8da0866bac79cc745b128072384a16d3cf034cda4fbe2480',
  'd23ec9caa34298337c5c509f95778b2ee42d5bf7941af8180a14126fd7f09098',
  'd5ce50950a25a089fc2c032edc91fdcdb27b1839b66b78a865a445a020a7f8a1',
  'e34f79e8c7b017dc30333837ab47849179ef96a74080f86ed4fb03dd8a30cfbf',
  'fc28f9dc8330c09de02e7ece1e9fe6b423b8b2dabe5961a85298312a2ba4b625',
]);

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

// Narrow, named exceptions for names. An exempt string counts only as a whole occurrence, with no
// letter, digit or underscore touching either end, so a longer token that merely contains it is still
// scanned. The same file can still leak anything else. There is no such list for private data: a
// synthetic fixture in a test is built at run time instead, so its literal never appears in a file.
export const EXACT_STRIPS = {
  // the MIT license must keep its copyright notice
  LICENSE: ['Copyright (c) 2026 Kyle Northup'],
  // the upgrade note must name the old command so a v2 owner can find the skill it replaced
  'UPGRADING.md': ['`/muninn`'],
};

// Where the repo tree (not a scaffolded stack) may carry names: the opt-in roster, the blog and the
// release history tell the story, and the contributor tests have to spell the list out.
export const NAME_ALLOWED_PREFIXES = ['agents/examples/', 'docs/blog/', 'tests/'];
export const NAME_ALLOWED_FILES = new Set(['CHANGELOG.md']);

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function withoutExemptions(file, text) {
  let body = text;
  for (const s of EXACT_STRIPS[file] || []) body = body.replace(new RegExp(`(?<![A-Za-z0-9_])${escapeRe(s)}(?![A-Za-z0-9_])`, 'g'), ' ');
  return body;
}

// Markdown emphasis and code markers can split a name (`Bat**man`, `Or\`ac\`le`), so every line is
// scanned twice: as written, and with * _ and backtick removed. A name the first view already found
// is counted once; the second view adds only what the first could not see.
const MARKERS = /[*_`]/g;
const namesIn = text => [...splitCamel(withoutSlug(text)).matchAll(NAME_RE)].map(m => m[0]);
const digestCache = new Map();
function sealedIn(text) {
  const found = [];
  for (const [run] of splitCamel(withoutSlug(text)).matchAll(/[A-Za-z]+/g)) {
    const word = run.toLowerCase();
    if (!digestCache.has(word)) digestCache.set(word, hashName(word));
    const digest = digestCache.get(word);
    if (SEALED_NAMES.has(digest)) found.push(digest);
  }
  return found;
}

function matchesOf(line, matchesIn) {
  const pool = matchesIn(line);
  const left = pool.map(w => w.toLowerCase());
  for (const m of matchesIn(line.replace(MARKERS, ''))) {
    const at = left.indexOf(m.toLowerCase());
    if (at >= 0) left.splice(at, 1);
    else pool.push(m);
  }
  return pool;
}
const namesOf = line => matchesOf(line, namesIn);
const sealedOf = line => matchesOf(line, sealedIn);
const sealedLabel = digest => `sealed name (sha256 ${digest.slice(0, 12)}...)`;

export function sealedHits(file, text) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    for (const digest of sealedOf(line)) found.push(`${file}:${i + 1}: ${sealedLabel(digest)}`);
  });
  return found;
}

export function sealedHitsInPath(file) {
  return sealedOf(file).map(digest => `${file}: ${sealedLabel(digest)} in the path`);
}

export function nameHits(file, text) {
  const found = [];
  withoutExemptions(file, text).split('\n').forEach((line, i) => {
    for (const m of namesOf(line)) found.push(`${file}:${i + 1}: name "${m}"  ${line.trim().slice(0, 100)}`);
    for (const digest of sealedOf(line)) found.push(`${file}:${i + 1}: ${sealedLabel(digest)}`);
  });
  return found;
}

export function nameHitsInPath(file) {
  return [...namesOf(file).map(m => `${file}: name "${m}" in the path`), ...sealedHitsInPath(file)];
}

const PRIVATE = [
  ['home path', /\/(?:home|Users)\/[A-Za-z][\w.-]*/g],
  ['api key', /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[bap]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})/g],
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
  const found = [];
  text.split('\n').forEach((line, i) => {
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

// Scan a file list for names and private data. `namesAllowedHere(file)` says where plain names
// are tolerated (the repo tree only); sealed names and private data are checked everywhere.
export function scan(root, files, namesAllowedHere = () => false) {
  const found = [];
  for (const file of files) {
    const text = readText(root, file);
    if (text === null) continue;
    if (!namesAllowedHere(file)) found.push(...nameHitsInPath(file), ...nameHits(file, text));
    else found.push(...sealedHitsInPath(file), ...sealedHits(file, text));
    found.push(...privateHits(file, text));
  }
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href && process.argv[2] === '--hash') {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const word of lines) console.log(hashName(word));
}
