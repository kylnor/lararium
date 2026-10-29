// The server's packaging has to say the same thing everywhere: one version in package.json and its
// lockfile, one Node floor in the engines, the CI matrix and every sentence of documentation.
// The floor is Node 20 because a locked dependency (hono) requires it; Node 18 is end of life.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackedFiles, readText } from './persona-scan.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = file => JSON.parse(fs.readFileSync(path.join(repo, file), 'utf8'));

test('package.json and package-lock.json carry the same version and the same Node floor', () => {
  const pkg = json('npx/package.json');
  const lock = json('npx/package-lock.json');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(pkg.engines.node, '>=20');
  assert.equal(lock.packages[''].engines.node, '>=20');
});

test('no locked dependency needs a newer Node than the declared floor', () => {
  const lock = json('npx/package-lock.json');
  const floor = 20;
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name || !entry.engines || !entry.engines.node) continue;
    if (entry.dev || entry.optional) continue;
    const needs = /^>=\s*(\d+)/.exec(entry.engines.node);
    if (needs) assert.ok(Number(needs[1]) <= floor, `${name} needs Node ${entry.engines.node}`);
  }
});

test('the CI matrix tests Node 20 and 22, and nothing claims Node 18', () => {
  const workflow = fs.readFileSync(path.join(repo, '.github/workflows/memory-checks.yml'), 'utf8');
  assert.match(workflow, /node:\s*\[\s*20\s*,\s*22\s*\]/);
  const claims = [];
  for (const file of trackedFiles(repo)) {
    if (file === 'npx/package-lock.json') continue;
    const text = readText(repo, file);
    if (text === null) continue;
    text.split('\n').forEach((line, i) => {
      if (/\bnode(?:\.js)?\s*18\b|>=\s*18\b|\b18\s*\+|\b18 or (?:newer|later)\b|node:\s*\[\s*18/i.test(line)) claims.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(claims.filter(c => !c.startsWith('tests/serve-package.test.mjs')), []);
});
