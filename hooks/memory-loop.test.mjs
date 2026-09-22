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

test('shipped hooks find their own stack without LARARIUM_ROOT and follow a moved folder', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-shipped-'));
  const stack = path.join(base, 'Desktop', 'my stack');
  const env = { ...process.env };
  delete env.LARARIUM_ROOT;
  const run = (root, name, data) => spawnSync(process.execPath,
    [path.join(root, 'hooks/reference', name)], { env, input: JSON.stringify(data), encoding: 'utf8' });
  try {
    fs.mkdirSync(path.join(stack, 'hooks/reference'), { recursive: true });
    fs.mkdirSync(path.join(stack, 'brain'), { recursive: true });
    fs.mkdirSync(path.join(stack, 'soul'), { recursive: true });
    for (const name of ['session-start.js', 'session-end-heartbeat.js']) {
      fs.copyFileSync(path.join(dir, 'reference', name), path.join(stack, 'hooks/reference', name));
    }
    fs.copyFileSync(path.join(dir, '../brain/CLAUDE.md'), path.join(stack, 'brain/CLAUDE.md'));
    fs.copyFileSync(path.join(dir, '../brain/now.md'), path.join(stack, 'brain/now.md'));
    fs.copyFileSync(path.join(dir, '../soul/core.md'), path.join(stack, 'soul/core.md'));

    const fresh = run(stack, 'session-start.js', { source: 'startup' }).stdout;
    assert.match(fresh, /brain\/now\.md is still the blank template/);
    assert.match(fresh, /soul\/core\.md is still the blank template/);
    assert.doesNotMatch(fresh, /\[Your Assistant's Name\]/);

    const transcript = path.join(base, 'transcript.jsonl');
    fs.writeFileSync(transcript, [
      { type: 'user', message: { content: 'The pot is terracotta' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Noted' }] } },
    ].map(e => JSON.stringify(e)).join('\n'));
    assert.equal(run(stack, 'session-end-heartbeat.js', { transcript_path: transcript }).status, 0);
    assert.match(fs.readFileSync(path.join(stack, 'soul/heartbeat.md'), 'utf8'), /terracotta/);

    fs.writeFileSync(path.join(stack, 'brain/now.md'), '# Now\n\n- Switch clients to receipt photos\n');
    const moved = path.join(base, 'Documents', 'my stack');
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.renameSync(stack, moved);
    const after = run(moved, 'session-start.js', { source: 'startup' }).stdout;
    assert.match(after, /terracotta/);
    assert.match(after, /\[Now: current focus\]\n# Now\n\n- Switch clients/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('shipped project settings register memory with no absolute paths', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '../.claude/settings.json'), 'utf8'));
  const commands = Object.values(settings.hooks).flat().flatMap(g => g.hooks).map(h => h.command);
  assert.deepEqual(commands, [
    'node "$CLAUDE_PROJECT_DIR/hooks/reference/session-start.js"',
    'node "$CLAUDE_PROJECT_DIR/hooks/reference/session-end-heartbeat.js"',
  ]);
  assert.equal(settings.env, undefined);
  const text = JSON.stringify(settings);
  assert.doesNotMatch(text, /"\/|~\/|[A-Za-z]:\\\\/);
});

test('update check reads the STACK_VERSION of the stack it ships in', () => {
  const stack = fs.mkdtempSync(path.join(os.tmpdir(), 'update-shipped-'));
  try {
    fs.mkdirSync(path.join(stack, 'hooks/reference'), { recursive: true });
    fs.copyFileSync(path.join(dir, 'reference/update-check.js'), path.join(stack, 'hooks/reference/update-check.js'));
    fs.writeFileSync(path.join(stack, 'STACK_VERSION'), 'v0.1\n');
    const out = spawnSync(process.execPath, [path.join(stack, 'hooks/reference/update-check.js')], {
      env: { ...process.env, STACK_UPDATE_CHECK_FIXTURE: 'v0.2' }, input: '{"source":"startup"}', encoding: 'utf8' }).stdout;
    assert.match(out, /you are on v0\.1/);
  } finally { fs.rmSync(stack, { recursive: true, force: true }); }
});
