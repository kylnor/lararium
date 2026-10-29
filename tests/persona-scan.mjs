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

// Markdown emphasis and code markers can split a name (`Ky**le`, `Or\`ac\`le`), so every line is
// scanned twice: as written, and with * _ and backtick removed. A name the first view already found
// is counted once; the second view adds only what the first could not see.
const MARKERS = /[*_`]/g;
const namesIn = text => [...splitCamel(withoutSlug(text)).matchAll(NAME_RE)].map(m => m[0]);
function namesOf(line) {
  const pool = namesIn(line);
  const left = pool.map(w => w.toLowerCase());
  for (const m of namesIn(line.replace(MARKERS, ''))) {
    const at = left.indexOf(m.toLowerCase());
    if (at >= 0) left.splice(at, 1);
    else pool.push(m);
  }
  return pool;
}

export function nameHits(file, text) {
  const found = [];
  withoutExemptions(file, text).split('\n').forEach((line, i) => {
    for (const m of namesOf(line)) found.push(`${file}:${i + 1}: name "${m}"  ${line.trim().slice(0, 100)}`);
  });
  return found;
}

export function nameHitsInPath(file) {
  return namesOf(file).map(m => `${file}: name "${m}" in the path`);
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
