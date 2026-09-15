import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./memory-check.mjs', import.meta.url));
test('reports missing files, accepts readable files, and never prints their contents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-check-'));
  const run = () => spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  try {
    assert.equal(run().status, 1);
    fs.mkdirSync(path.join(root, 'brain'));
    for (const name of ['CLAUDE.md', 'now.md']) fs.writeFileSync(path.join(root, 'brain', name), 'PRIVATE_FIXTURE_TEXT');
    const result = run();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Fresh-session recall: unverified/);
    assert.doesNotMatch(result.stdout, /PRIVATE_FIXTURE_TEXT/);
    assert.equal(fs.readFileSync(path.join(root, 'brain/now.md'), 'utf8'), 'PRIVATE_FIXTURE_TEXT');
    fs.writeFileSync(path.join(root, 'brain/now.md'), '  ');
    assert.equal(run().status, 1);
    fs.unlinkSync(path.join(root, 'brain/now.md'));
    fs.mkdirSync(path.join(root, 'brain/now.md'));
    assert.equal(run().status, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
