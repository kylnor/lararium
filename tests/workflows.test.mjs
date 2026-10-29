// A GitHub template copy brings .github/ along, so every contributor workflow must refuse to run
// anywhere but the upstream repository. This reads each workflow and checks its jobs carry the guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.github/workflows');
const GUARD = "if: github.repository == 'kylnor/lararium'";

// Job names are the two-space-indented keys under the top-level `jobs:` block.
function jobs(text) {
  const body = text.slice(text.indexOf('\njobs:\n') + 6);
  const found = [];
  let current = null;
  for (const line of body.split('\n')) {
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (key) { current = { name: key[1], lines: [] }; found.push(current); }
    else if (current) current.lines.push(line);
  }
  return found;
}

test('every job in every workflow runs only in the upstream repository', () => {
  const files = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f));
  assert.ok(files.includes('memory-checks.yml') && files.includes('release.yml'), 'expected both workflows');
  for (const f of files) {
    const list = jobs(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(list.length > 0, `${f}: no jobs found`);
    for (const job of list) {
      assert.ok(job.lines.some(l => l.trim() === GUARD), `${f} job "${job.name}" lacks: ${GUARD}`);
    }
  }
});
