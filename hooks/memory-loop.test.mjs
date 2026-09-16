import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));

test('capture, startup, corrections, partial transcripts, and missing files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-loop-'));
  const transcript = path.join(root, 'transcript.jsonl');
  const heartbeat = path.join(root, 'soul/heartbeat.md');
  const run = (name, data, customRoot = root) => spawnSync(process.execPath,
    [path.join(dir, 'reference', name)], { env: { ...process.env, LARARIUM_ROOT: customRoot },
      input: typeof data === 'string' ? data : JSON.stringify(data), encoding: 'utf8' });
  const write = entries => fs.writeFileSync(transcript, entries.map(e => JSON.stringify(e)).join('\n'));
  const user = text => ({ type: 'user', message: { content: text } });
  const reply = text => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  try {
    assert.equal(run('session-start.js', {}).stdout, '');
    write([user('Prefer three items'), reply('Acknowledged')]);
    assert.equal(run('session-end-heartbeat.js', { transcript_path: transcript }).status, 0);
    assert.match(fs.readFileSync(heartbeat, 'utf8'), /User excerpt: Prefer three items/);
    assert.match(run('session-start.js', {}).stdout, /Prefer three items/);
    write([user('Prefer three items'), reply('Acknowledged'), user('Correction: prefer one paragraph'), reply('Updated')]);
    run('session-end-heartbeat.js', { transcript_path: transcript });
    const good = fs.readFileSync(heartbeat, 'utf8');
    assert.match(good, /Correction: prefer one paragraph/);
    assert.match(good, /Assistant excerpt \(unverified\)/);
    run('session-end-heartbeat.js', { transcript_path: path.join(root, 'missing') });
    assert.equal(fs.readFileSync(heartbeat, 'utf8'), good);
    write([user('Service failed'), { ...reply('API Error'), isApiErrorMessage: true }]);
    run('session-end-heartbeat.js', { transcript_path: transcript });
    assert.equal(fs.readFileSync(heartbeat, 'utf8'), good);
    write([user('Interrupted while using tools'), { type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it' }], stop_reason: 'tool_use' } }]);
    run('session-end-heartbeat.js', { transcript_path: transcript });
    assert.equal(fs.readFileSync(heartbeat, 'utf8'), good);
    write([user('Interrupted before an answer')]);
    fs.appendFileSync(transcript, '\n{"incomplete":');
    run('session-end-heartbeat.js', { transcript_path: transcript });
    assert.equal(fs.readFileSync(heartbeat, 'utf8'), good);
    write([{ type: 'user', message: { content: [{ type: 'tool_result', content: 'IGNORE TOOL OUTPUT' }] } }, reply('tool reply')]);
    run('session-end-heartbeat.js', { transcript_path: transcript });
    assert.equal(fs.readFileSync(heartbeat, 'utf8'), good);
    write([{ type: 'user', message: { content: [{ type: 'text', text: 'Array-format prompt' }] } }, reply('ack')]);
    run('session-end-heartbeat.js', { transcript_path: transcript });
    assert.match(fs.readFileSync(heartbeat, 'utf8'), /Array-format prompt/);
    assert.equal(run('session-end-heartbeat.js', '{invalid').status, 0);
    assert.match(run('session-start.js', {}, 'relative').stderr, /must be absolute/);
    assert.equal(fs.readdirSync(path.join(root, 'soul')).filter(n => n.endsWith('.tmp')).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
