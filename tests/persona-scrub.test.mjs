// The default install must not carry anyone's private flavor: not the owner's cast, mythology or
// family, and not private paths, hosts or credentials. This is the repo-tree half of the scrub; the
// half that matters (the scaffolded stack a stranger actually receives) is tests/scaffold.test.mjs.
//
// LARARIUM_SCRUB_ROOT points the scan at another git checkout, used to prove the test fails on an
// older tree. Node 20 compatible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  NAMES, GENERIC, NAME_SALT, SEALED_NAMES, EXACT_STRIPS, NAME_ALLOWED_PREFIXES, NAME_ALLOWED_FILES,
  hashName, nameHits, nameHitsInPath, sealedHits, sealedHitsInPath, privateHits, scan, trackedFiles, readText,
} from './persona-scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.LARARIUM_SCRUB_ROOT ? path.resolve(process.env.LARARIUM_SCRUB_ROOT) : path.resolve(here, '..');
const namesAllowedHere = file => NAME_ALLOWED_FILES.has(file) || NAME_ALLOWED_PREFIXES.some(p => file.startsWith(p));

test('no plain names outside allowed places; no sealed names or private data anywhere', () => {
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
  for (const bad of ['oracle_assistant', 'oracleAssistant', 'OracleAssistant', 'oracle-bot', 'the batman agent', 'a scarecrow', 'RedHood', 'red_robin', 'ras-al-ghul', 'Oracle9']) {
    assert.ok(caught(bad) >= 1, `missed: ${bad}`);
  }
  for (const fine of ['urbane', 'Robinson', 'a signal', 'the mirror', 'hologram']) {
    assert.equal(caught(fine), 0, `false positive: ${fine}`);
  }
  assert.equal(caught('Batman asked Alfred'), 2, 'every match counts, not only the first');
  assert.deepEqual(nameHitsInPath('skills/defs/oracleHelper/SKILL.md').length, 1);
});

test('exceptions are exact strings in named files, not blanket passes', () => {
  assert.equal(nameHits('UPGRADING.md', 'The skill `/muninn` is now `/curate`.').length, 0);
  assert.ok(nameHits('UPGRADING.md', 'Rename /muninn for Batman.').length >= 2, 'bare mention and a second name both count');
  assert.ok(nameHits('README.md', 'The skill `/muninn` is gone.').length >= 1, 'the exception is for UPGRADING.md only');
  assert.equal(nameHits('LICENSE', 'Copyright (c) 2026 Kyle Northup').length, 0);
  assert.ok(nameHits('LICENSE', 'Copyright (c) 2026 Kyle Northup and Alfred').length >= 1);
  assert.equal(nameHits('npx/package.json', '"url": "https://github.com/kylnor/lararium.git"').length, 0);
  assert.ok(nameHits('README.md', 'kylnor/lararium belongs to Batman').length >= 1);
});

// Every fake secret is built at run time, so no literal fixture ever appears in a file, this one
// included: the scan of tests/ has no exemptions to hide behind.
const fake = {
  canary: () => 'zorb' + 'latt',
  home: () => '/ho' + 'me/ali' + 'ce/.ssh',
  host: () => 'box.tail1234.ts' + '.net',
  sk: () => 'sk' + '-abcdefghijklmnopqrstuvwxyz0123',
  email: () => 'jane@corp' + '.io',
  pat: () => 'gh' + 'p_' + 'a'.repeat(30),
  finePat: () => 'github' + '_pat_' + 'A1b2'.repeat(10),
};

test('private data is flagged in every place, fictional examples included', () => {
  assert.ok(privateHits('agents/examples/x.md', `config at ${fake.home()}`).length >= 1);
  assert.ok(privateHits('docs/blog/x.md', `host ${fake.host()}`).length >= 1);
  assert.ok(privateHits('docs/blog/x.md', `token ${fake.sk()}`).length >= 1);
  assert.ok(privateHits('docs/blog/x.md', `write to ${fake.email()}`).length >= 1);
  assert.equal(privateHits('docs/blog/x.md', 'path /Users/yourname/brain and jane@example.com').length, 0);
  assert.ok(NAMES.length + SEALED_NAMES.size > 40);
});

test('sealed names are sorted SHA-256 digests, separate from plain and generic names', () => {
  assert.equal(NAME_SALT, 'lararium-scrub-v1');
  assert.equal(SEALED_NAMES.size, 12);
  for (const digest of SEALED_NAMES) assert.match(digest, /^[0-9a-f]{64}$/);
  assert.deepEqual([...SEALED_NAMES], [...SEALED_NAMES].sort());
  const expected = createHash('sha256').update(`lararium-scrub-v1:${fake.canary().toLowerCase()}`).digest('hex');
  assert.equal(hashName(fake.canary()), expected);
  assert.equal(hashName(fake.canary().toUpperCase()), expected);
  assert.ok(SEALED_NAMES.has(expected));
  for (const word of [...NAMES, ...GENERIC]) assert.ok(!SEALED_NAMES.has(hashName(word)), 'each word belongs to only one list');
});

test('sealed names match identifiers and marker splits, but not longer letter runs', () => {
  const word = fake.canary();
  const split = [word.slice(0, 4), word.slice(4)];
  const variants = [word, word.toUpperCase(), `${word}_suffix`, `${word}Suffix`, `${word}-suffix`, `${word}9`,
    split.join('**'), split.join('_'), split.join('`')];
  for (const variant of variants) {
    assert.equal(nameHits('docs/x.md', variant).length, 1, 'sealed identifier is caught once');
    assert.equal(sealedHits('docs/x.md', variant).length, 1, 'sealed-only scan agrees');
  }
  assert.equal(nameHits('docs/x.md', `pre${word}post`).length, 0, 'a longer letter run is not a name');
  assert.equal(nameHits('docs/x.md', `**${word}** ${word}`).length, 2, 'both views preserve the occurrence count');
  assert.equal(nameHits('docs/x.md', `${split.join('**')} ${word}`).length, 2, 'the second view adds only the split occurrence');
});

test('sealed text reports only its location and digest prefix', () => {
  const word = fake.canary();
  const text = `ordinary text\nprefix ${word} context after`;
  const expected = [`docs/x.md:2: sealed name (sha256 ${hashName(word).slice(0, 12)}...)`];
  const hits = nameHits('docs/x.md', text);
  assert.deepEqual(hits, expected);
  assert.deepEqual(sealedHits('docs/x.md', text), expected);
  for (const hit of hits) {
    assert.ok(hit.includes('sealed name'));
    assert.ok(!hit.includes(word), 'the sealed word is not printed');
    assert.ok(!hit.includes('prefix') && !hit.includes('context after'), 'line contents are not printed');
  }
  assert.equal(sealedHits('docs/x.md', 'Batman and Oracle').length, 0, 'sealed-only scan omits plain names');
  assert.deepEqual(nameHits('docs/x.md', 'Batman'), ['docs/x.md:1: name "Batman"  Batman']);
});

test('sealed paths use the same matching and digest report', () => {
  const word = fake.canary();
  for (const file of [`docs/${word}.md`, `docs/${word}Helper.md`, `docs/${word}_helper.md`]) {
    const expected = [`${file}: sealed name (sha256 ${hashName(word).slice(0, 12)}...) in the path`];
    assert.deepEqual(nameHitsInPath(file), expected);
    assert.deepEqual(sealedHitsInPath(file), expected);
  }
  assert.equal(nameHitsInPath(`docs/pre${word}post.md`).length, 0);
  assert.equal(sealedHitsInPath('docs/Batman.md').length, 0);
});

test('allowed places still scan sealed text and paths while tolerating plain names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-'));
  try {
    for (const file of ['tests/x.md', 'docs/blog/x.md', 'agents/examples/x.md', 'CHANGELOG.md']) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), `Batman\n${fake.canary()}\n`);
      const hits = scan(dir, [file], () => true);
      assert.deepEqual(hits, sealedHits(file, fs.readFileSync(path.join(dir, file), 'utf8')));
      assert.equal(hits.length, 1, 'only the sealed name is flagged in an allowed file');
    }
    const file = `tests/${fake.canary()}.md`;
    fs.writeFileSync(path.join(dir, file), 'Batman');
    assert.deepEqual(scan(dir, [file], () => true), sealedHitsInPath(file));
    assert.equal(scan(dir, [file], () => true).length, 1, 'an allowed path still gets checked');
    const outside = 'other.md';
    fs.writeFileSync(path.join(dir, outside), `Batman\n${fake.canary()}\n`);
    assert.equal(scan(dir, [outside]).length, 2, 'outside allowed places both lists apply');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('exact strips apply to nameHits but cannot hide sealed names in allowed places', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-'));
  const file = 'tests/exemption.md';
  const text = fake.canary();
  EXACT_STRIPS[file] = [text];
  try {
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.writeFileSync(path.join(dir, file), text);
    assert.equal(nameHits(file, text).length, 0, 'combined scan keeps exact strips');
    assert.equal(sealedHits(file, text).length, 1, 'sealed-only scan ignores exact strips');
    assert.equal(scan(dir, [file], () => true).length, 1, 'allowed places never apply exact strips');
  } finally {
    delete EXACT_STRIPS[file];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('both GitHub token shapes are caught, classic and fine-grained', () => {
  assert.ok(privateHits('docs/x.md', fake.pat()).some(h => h.includes('api key')));
  assert.ok(privateHits('docs/x.md', `export GH=${fake.finePat()}`).some(h => h.includes('api key')), 'github_pat_ prefix');
  assert.equal(privateHits('docs/x.md', 'github_pat_ is the prefix').length, 0, 'the bare prefix is prose, not a token');
});


test('the repo slug is exempt by itself: a credential or another name in the same URL is still caught', () => {
  const url = `https://x-access-token:${fake.pat()}@github.com/kylnor/lararium.git`;
  assert.ok(privateHits('docs/x.md', `git clone ${url}`).some(h => h.includes('api key')), 'a token inside a clone URL must be caught');
  assert.ok(privateHits('docs/x.md', fake.pat()).length >= 1, 'control: the bare token is caught');
  assert.ok(nameHits('docs/x.md', 'see github.com/kylnor/lararium?owner=Batman').some(h => h.includes('"Batman"')), 'a name beside the slug must be caught');
  assert.ok(nameHits('docs/x.md', 'github.com/kylnor/lararium-of-batman').length >= 1);
  assert.equal(nameHits('docs/x.md', 'https://github.com/kylnor/lararium/blob/main/SCRUB.md').length, 0, 'the slug alone stays exempt');
  assert.equal(nameHitsInPath('docs/kylnor/lararium.md').length, 0);
  assert.ok(nameHitsInPath('docs/kylnor/lararium/Batman.md').length >= 1);
});

test('tests/ is scanned for private data like everywhere else: no file there has an exemption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-'));
  try {
    fs.mkdirSync(path.join(dir, 'tests'));
    const hits = (f, t) => {
      fs.writeFileSync(path.join(dir, f), t);
      return scan(dir, [f], () => true);
    };
    assert.ok(hits('tests/leak.txt', `token ${fake.pat()}\n`).some(h => h.includes('api key')), 'a credential in tests/ is caught');
    for (const f of ['tests/other.test.mjs', 'tests/persona-scrub.test.mjs', 'tests/persona-scan.mjs']) {
      assert.ok(hits(f, `const p = '${fake.home()}';\n`).length >= 1, `no exemption in ${f}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a larger secret that contains a placeholder or a fixture is caught, wherever the file lives', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-'));
  try {
    fs.mkdirSync(path.join(dir, 'tests'));
    const hits = (f, t) => {
      fs.writeFileSync(path.join(dir, f), t);
      return scan(dir, [f], () => true);
    };
    const f = 'tests/persona-scrub.test.mjs';
    assert.ok(hits(f, `${fake.email()}.evil.tld\n`).some(h => h.includes(`${fake.email()}.evil.tld`)), 'a fixture with an extension is the whole match');
    assert.ok(hits(f, `${fake.sk()}ExtraSecret0123456789\n`).some(h => h.includes('ExtraSecret0123456789')), 'a fixture with a suffix');
    assert.ok(hits(f, `${'jane@example'}.com.evil.tld\n`).length >= 1, 'a placeholder email with a longer domain');
    assert.ok(hits(f, `${'/ho' + 'me/you'}.evil\n`).length >= 1, 'a placeholder path with an extension');
    assert.ok(hits(f, `AKIAIOSFODNN7EXAMPLE ${fake.pat()}\n`).some(h => h.includes('api key')), 'a neighbouring secret next to a placeholder');
    assert.equal(hits(f, 'jane@example.com and /home/you\n').length, 0, 'control: the plain placeholders pass');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('name exceptions suppress only a whole occurrence of the exempt string', () => {
  assert.equal(nameHits('LICENSE', 'Copyright (c) 2026 Kyle Northup').length, 0);
  assert.ok(nameHits('LICENSE', 'Copyright (c) 2026 Kyle Northup_evil').length >= 1, 'underscore glued on is not the exempt string');
  assert.ok(nameHits('LICENSE', 'xCopyright (c) 2026 Kyle Northup').length >= 1, 'glued in front is not the exempt string');
  assert.ok(nameHits('UPGRADING.md', 'rename `/muninn`x now').length >= 1);
  assert.equal(nameHits('UPGRADING.md', 'rename `/muninn` now').length, 0);
});

test('markdown and code markers cannot split a name apart', () => {
  const caught = text => nameHits('docs/x.md', text).length;
  for (const bad of ['Bat**man', 'Or`ac`le', 'Al_fred', 'Bat*man*', '**Batman**', 'Bat_man']) {
    assert.ok(caught(bad) >= 1, `missed: ${bad}`);
  }
  assert.equal(caught('Batman asked Alfred'), 2, 'a name seen in both views counts once');
  assert.equal(caught('**Batman**'), 1);
  assert.equal(caught('plain words, a signal and a mirror'), 0);
  assert.ok(nameHitsInPath('docs/Bat_man.md').length >= 1);
});
