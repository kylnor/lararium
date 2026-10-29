// The primitives under the memory server's hardening: opens that refuse a link instead of following
// it, a pinned folder that notices being swapped, and the index lock's ownership rules (release
// only what is ours, reclaim only what is abandoned and only under the reclaim marker, a live
// holder's lock is never moved, exactly one reclaimer wins).
// Needs no dependencies beyond the repo: node --test tests/serve-lock.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const guardPath = path.join(repo, 'npx/lib/guard.js');
const lockPath = path.join(repo, 'npx/lib/lock.js');
const { GuardError, openNoFollow, readFileNoFollow, writeFileAtomic, pinAuxDir } = require(guardPath);
const { createLock, LockBusy, LockLost } = require(lockPath);

function sandbox() {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-lock-'));
  const outside = path.join(top, 'outside');
  const dir = path.join(top, 'memory');
  fs.mkdirSync(outside);
  fs.mkdirSync(dir);
  return { top, dir, outside, lockFile: path.join(dir, '.memory-index.lock'), done: () => fs.rmSync(top, { recursive: true, force: true }) };
}

const hex = () => crypto.randomBytes(16).toString('hex');
const ownerText = (pid, host = os.hostname()) => `${hex()}\n${pid}\n${host}\n`;
function deadPid() { // a pid that has just exited
  const child = spawnSync(process.execPath, ['-e', '0']);
  return child.pid;
}
const age = (file, ms) => { const t = new Date(Date.now() - ms); fs.utimesSync(file, t, t); };
const leftovers = dir => fs.readdirSync(dir).filter(n => n.endsWith('.tomb') || n.endsWith('.tmp') || n.endsWith('.reclaim'));
const gate = () => { let open; const passed = new Promise(resolve => { open = resolve; }); return { passed, open }; };
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
const addToIndex = (indexFile, entry) => { // a read-modify-write, the shape of the real index update
  const before = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8') : '';
  fs.writeFileSync(indexFile, `${before}${entry}\n`);
};

// ---- opens that do not follow -------------------------------------------------------------

test('readFileNoFollow refuses a symlinked MEMORY.md, a dangling one included, and reads a real one', () => {
  const s = sandbox();
  try {
    const secret = path.join(s.outside, 'notes.txt');
    fs.writeFileSync(secret, 'outside text');
    const index = path.join(s.dir, 'MEMORY.md');
    assert.equal(readFileNoFollow(index), null, 'absent is null');
    fs.symlinkSync(secret, index);
    assert.throws(() => readFileNoFollow(index), err => err instanceof GuardError && /symbolic link/.test(err.message) && !err.message.includes(s.top));
    fs.rmSync(index);
    fs.symlinkSync(path.join(s.outside, 'not-there-yet.txt'), index); // dangling: looks absent to a path check
    assert.throws(() => readFileNoFollow(index), GuardError);
    fs.rmSync(index);
    fs.writeFileSync(index, '# Memory\n');
    assert.equal(readFileNoFollow(index), '# Memory\n');
  } finally { s.done(); }
});

test('a lock file that is a symlink is refused at open, and its target is never created or written', async () => {
  const s = sandbox();
  try {
    const target = path.join(s.outside, 'victim.txt');
    fs.symlinkSync(target, s.lockFile); // dangling
    assert.throws(() => openNoFollow(s.lockFile, fs.constants.O_WRONLY | fs.constants.O_CREAT, 0o644), GuardError);
    await assert.rejects(() => createLock({ file: s.lockFile, waitMs: 100 }).acquire(), GuardError);
    assert.equal(fs.existsSync(target), false, 'the dangling target was not created through the link');
    fs.rmSync(s.lockFile);
    fs.writeFileSync(target, 'keep');
    fs.symlinkSync(target, s.lockFile);
    await assert.rejects(() => createLock({ file: s.lockFile, waitMs: 100 }).acquire(), GuardError);
    assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
  } finally { s.done(); }
});

test('writeFileAtomic replaces a link at the destination without writing through it, and cleans up when it backs out', () => {
  const s = sandbox();
  try {
    const target = path.join(s.outside, 'victim.txt');
    fs.writeFileSync(target, 'keep');
    const file = path.join(s.dir, 'MEMORY.md');
    fs.symlinkSync(target, file);
    writeFileAtomic(file, 'new');
    assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
    assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'new');
    assert.throws(() => writeFileAtomic(file, 'x', { beforeCommit: () => { throw new Error('back out'); } }), /back out/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'new');
    assert.deepEqual(leftovers(s.dir), []);
  } finally { s.done(); }
});

test('a pinned folder notices being swapped for a link or for another folder after it was validated', () => {
  const s = sandbox();
  try {
    const name = '.index';
    fs.mkdirSync(path.join(s.dir, name));
    const other = path.join(s.top, 'other'); // made now, so its inode cannot be a reused one
    fs.mkdirSync(other);
    const pin = pinAuxDir(s.dir, name);
    pin.check();
    fs.rmSync(path.join(s.dir, name), { recursive: true });
    fs.symlinkSync(s.outside, path.join(s.dir, name));
    assert.throws(() => pin.check(), err => err instanceof GuardError && /changed while in use/.test(err.message));
    assert.throws(() => pinAuxDir(s.dir, name), /symbolic link/);
    fs.rmSync(path.join(s.dir, name));
    fs.renameSync(other, path.join(s.dir, name)); // a different directory under the same name
    assert.throws(() => pin.check(), /changed while in use/);
    assert.equal(pinAuxDir(s.dir, 'absent'), null);
  } finally { s.done(); }
});

// ---- lock ownership -----------------------------------------------------------------------

test('release removes our own lock', async () => {
  const s = sandbox();
  try {
    const held = await createLock({ file: s.lockFile }).acquire();
    assert.match(fs.readFileSync(s.lockFile, 'utf8'), new RegExp(`^${held.token}\\n${process.pid}\\n`));
    held.release();
    assert.equal(fs.existsSync(s.lockFile), false);
    held.release(); // twice is fine
  } finally { s.done(); }
});

test('release does not delete a lock that holds someone else\'s token, and assertOwned notices the loss', async () => {
  const s = sandbox();
  try {
    const held = await createLock({ file: s.lockFile }).acquire();
    held.assertOwned();
    const foreign = ownerText(process.pid);
    fs.rmSync(s.lockFile);
    fs.writeFileSync(s.lockFile, foreign); // our lock was taken over; a successor now holds it
    assert.throws(() => held.assertOwned(), LockLost);
    held.release();
    assert.equal(fs.readFileSync(s.lockFile, 'utf8'), foreign, 'the successor\'s lock is untouched');
    assert.deepEqual(leftovers(s.dir), []);
  } finally { s.done(); }
});

test('a stale lock whose holder is gone is reclaimed; a live holder on this host is never evicted on age alone', async () => {
  const s = sandbox();
  try {
    // dead pid on this host
    fs.writeFileSync(s.lockFile, ownerText(deadPid()));
    age(s.lockFile, 60000);
    const first = await createLock({ file: s.lockFile, staleMs: 1000, waitMs: 500 }).acquire();
    assert.notEqual(fs.readFileSync(s.lockFile, 'utf8').split('\n')[0], '', 'a fresh lock is in place');
    first.release();

    // a file that is not one of ours, and a lock from another host
    fs.writeFileSync(s.lockFile, 'someone else');
    age(s.lockFile, 60000);
    (await createLock({ file: s.lockFile, staleMs: 1000, waitMs: 500 }).acquire()).release();
    fs.writeFileSync(s.lockFile, ownerText(process.pid, 'some-other-host'));
    age(s.lockFile, 60000);
    (await createLock({ file: s.lockFile, staleMs: 1000, waitMs: 500 }).acquire()).release();

    // the holder (this very process) is alive: old, but not abandoned
    const live = ownerText(process.pid);
    fs.writeFileSync(s.lockFile, live);
    age(s.lockFile, 60000);
    await assert.rejects(() => createLock({ file: s.lockFile, staleMs: 1000, waitMs: 200 }).acquire(), LockBusy);
    assert.equal(fs.readFileSync(s.lockFile, 'utf8'), live, 'a live holder keeps its lock');
    assert.deepEqual(leftovers(s.dir), []);
  } finally { s.done(); }
});

test('a reclaimer that judged a lock stale and paused cannot remove the lock that replaced it, and no third process slips in', async () => {
  const s = sandbox();
  try {
    const index = path.join(s.dir, 'index.txt');
    fs.writeFileSync(s.lockFile, ownerText(deadPid()));
    age(s.lockFile, 60000);

    // A judges the abandoned lock stale and pauses before it does anything about it.
    const aJudged = gate();
    const aResume = gate();
    const aPending = createLock({
      file: s.lockFile, staleMs: 1000, waitMs: 5000,
      hooks: { beforeReclaim: async () => { aJudged.open(); await aResume.passed; } },
    }).acquire();
    await aJudged.passed;

    // B reclaims the same lock, acquires, and has passed its ownership check, about to rename the index.
    const b = await createLock({ file: s.lockFile, staleMs: 1000, waitMs: 500 }).acquire();
    age(s.lockFile, 60000); // old on disk, and still not abandoned: its holder is alive
    b.assertOwned();
    const bLock = fs.readFileSync(s.lockFile, 'utf8');
    assert.match(bLock, new RegExp(`^${b.token}\n`));

    // C arrives while B holds it: it must not get in.
    await assert.rejects(() => createLock({ file: s.lockFile, staleMs: 1000, waitMs: 150 }).acquire(), LockBusy);

    // A wakes up holding a stale verdict about a lock that is gone.
    aResume.open();
    await settle(150);
    assert.equal(fs.readFileSync(s.lockFile, 'utf8'), bLock, 'A did not remove or replace B\'s lock');
    b.assertOwned();
    addToIndex(index, 'B'); // B's index rename lands
    b.release();

    // Now the others take their turns, one at a time, and every entry survives.
    const a = await aPending;
    a.assertOwned();
    addToIndex(index, 'A');
    a.release();
    const c = await createLock({ file: s.lockFile, staleMs: 1000, waitMs: 500 }).acquire();
    addToIndex(index, 'C');
    c.release();
    assert.deepEqual(fs.readFileSync(index, 'utf8').trim().split('\n'), ['B', 'A', 'C'], 'no index entry was lost');
    assert.equal(fs.existsSync(s.lockFile), false);
    assert.deepEqual(leftovers(s.dir), []);
  } finally { s.done(); }
});

test('a holder paused after assertOwned keeps its lock against a contender, even an old-looking lock', async () => {
  const s = sandbox();
  try {
    const held = await createLock({ file: s.lockFile }).acquire();
    age(s.lockFile, 60000);
    held.assertOwned(); // ...paused here, just before the index rename
    const before = fs.readFileSync(s.lockFile, 'utf8');
    for (let n = 0; n < 3; n += 1) {
      await assert.rejects(() => createLock({ file: s.lockFile, staleMs: 1000, waitMs: 120 }).acquire(), LockBusy);
      assert.equal(fs.readFileSync(s.lockFile, 'utf8'), before, 'the lock was never moved or replaced');
    }
    held.assertOwned(); // still ours when the holder resumes
    held.release();
    assert.deepEqual(leftovers(s.dir), []);
  } finally { s.done(); }
});

test('a reclaimer under the marker re-reads the lock and leaves a live holder\'s lock alone', async () => {
  const s = sandbox();
  try {
    fs.writeFileSync(s.lockFile, ownerText(deadPid()));
    age(s.lockFile, 60000);
    const underMarker = gate();
    const resume = gate();
    const reclaimer = createLock({
      file: s.lockFile, staleMs: 1000, waitMs: 400,
      hooks: { underMarker: async () => { underMarker.open(); await resume.passed; } },
    }).acquire();
    await underMarker.passed;
    assert.equal(fs.existsSync(`${s.lockFile}.reclaim`), true, 'the marker is held while it decides');

    // Meanwhile the abandoned lock goes away by other means and a live process takes the lock.
    fs.rmSync(s.lockFile);
    const live = await createLock({ file: s.lockFile, staleMs: 1000, waitMs: 200 }).acquire();
    age(s.lockFile, 60000);
    const liveText = fs.readFileSync(s.lockFile, 'utf8');
    live.assertOwned();

    resume.open();
    await assert.rejects(() => reclaimer, LockBusy);
    assert.equal(fs.readFileSync(s.lockFile, 'utf8'), liveText, 'the live holder\'s lock survived the reclaimer\'s re-read');
    live.assertOwned();
    live.release();
    assert.deepEqual(leftovers(s.dir), [], 'the marker was released');
  } finally { s.done(); }
});

test('while one reclaimer holds the marker, another does not touch the lock', async () => {
  const s = sandbox();
  try {
    const stale = ownerText(deadPid());
    fs.writeFileSync(s.lockFile, stale);
    age(s.lockFile, 60000);
    const underMarker = gate();
    const resume = gate();
    const first = createLock({
      file: s.lockFile, staleMs: 1000, waitMs: 2000,
      hooks: { underMarker: async () => { underMarker.open(); await resume.passed; } },
    }).acquire();
    await underMarker.passed;
    await assert.rejects(() => createLock({ file: s.lockFile, staleMs: 1000, waitMs: 200 }).acquire(), LockBusy);
    assert.equal(fs.readFileSync(s.lockFile, 'utf8'), stale, 'the second reclaimer waited out the marker');
    resume.open();
    const held = await first;
    held.assertOwned();
    held.release();
    assert.deepEqual(leftovers(s.dir), []);
  } finally { s.done(); }
});

test('a reclaim marker from a dead process is cleared once it is old; one from a live process, or a young one, is respected', async () => {
  const s = sandbox();
  const markerFile = `${s.lockFile}.reclaim`;
  try {
    const abandonLock = () => { fs.writeFileSync(s.lockFile, ownerText(deadPid())); age(s.lockFile, 60000); };

    // dead pid, old: the crash-inside-the-window leftover. It is cleared and the reclaim goes through.
    abandonLock();
    fs.writeFileSync(markerFile, ownerText(deadPid()));
    age(markerFile, 60000);
    const held = await createLock({ file: s.lockFile, staleMs: 1000, waitMs: 1000 }).acquire();
    held.assertOwned();
    held.release();
    assert.deepEqual(leftovers(s.dir), []);

    // dead pid but young: inside the short window, so it is respected and nothing is reclaimed.
    abandonLock();
    const young = ownerText(deadPid());
    fs.writeFileSync(markerFile, young);
    await assert.rejects(() => createLock({ file: s.lockFile, staleMs: 1000, markerStaleMs: 60000, waitMs: 200 }).acquire(), LockBusy);
    assert.equal(fs.readFileSync(markerFile, 'utf8'), young);
    fs.rmSync(markerFile);

    // live pid, however old: a reclaimer that is merely slow keeps the marker.
    const live = ownerText(process.pid);
    fs.writeFileSync(markerFile, live);
    age(markerFile, 60000);
    await assert.rejects(() => createLock({ file: s.lockFile, staleMs: 1000, waitMs: 200 }).acquire(), LockBusy);
    assert.equal(fs.readFileSync(markerFile, 'utf8'), live);
    assert.equal(fs.existsSync(s.lockFile), true, 'the stale lock was not reclaimed behind the live marker');
  } finally { s.done(); }
});

test('the marker is released when the reclaim fails, and a marker that is a link is refused', async () => {
  const s = sandbox();
  try {
    fs.writeFileSync(s.lockFile, ownerText(deadPid()));
    age(s.lockFile, 60000);
    const boom = createLock({ file: s.lockFile, staleMs: 1000, waitMs: 200, hooks: { underMarker: () => { throw new Error('boom'); } } });
    await assert.rejects(() => boom.acquire(), /boom/);
    assert.equal(fs.existsSync(`${s.lockFile}.reclaim`), false, 'a failed reclaim does not strand its marker');

    const target = path.join(s.outside, 'victim.txt');
    fs.symlinkSync(target, `${s.lockFile}.reclaim`);
    await assert.rejects(() => createLock({ file: s.lockFile, staleMs: 1000, waitMs: 200 }).acquire(), GuardError);
    assert.equal(fs.existsSync(target), false, 'nothing was created through the link');
  } finally { s.done(); }
});

// Real processes, released together, all finding the same abandoned lock: exactly one may hold it.
const CONTENDER = `
const fs = require('node:fs');
const { createLock } = require(process.argv[1]);
const [file, go] = [process.argv[2], process.argv[3]];
const wait = new Int32Array(new SharedArrayBuffer(4));
while (!fs.existsSync(go)) Atomics.wait(wait, 0, 0, 2);
createLock({ file, staleMs: 1000, waitMs: 300 }).acquire().then(
  held => { console.log('ACQUIRED'); setTimeout(() => { held.release(); }, 1200); },
  error => { console.log(error.name); },
);
`;

test('two or more concurrent reclaimers of one abandoned lock: exactly one acquires', async () => {
  const s = sandbox();
  try {
    fs.writeFileSync(s.lockFile, ownerText(deadPid()));
    age(s.lockFile, 60000);
    const go = path.join(s.top, 'go');
    const run = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', CONTENDER, lockPath, s.lockFile, go], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', c => { out += c; });
      child.stderr.on('data', c => { err += c; });
      child.on('close', code => (code === 0 ? resolve(out.trim()) : reject(new Error(err))));
    });
    const children = Array.from({ length: 6 }, run);
    await new Promise(resolve => setTimeout(resolve, 400)); // let every child reach the starting line
    fs.writeFileSync(go, '');
    const results = await Promise.all(children);
    assert.equal(results.filter(r => r === 'ACQUIRED').length, 1, `results: ${results.join(', ')}`);
    assert.equal(results.filter(r => r === 'LockBusy').length, 5, `results: ${results.join(', ')}`);
    assert.equal(fs.existsSync(s.lockFile), false, 'the winner released');
    assert.deepEqual(leftovers(s.dir), []);
  } finally { s.done(); }
});
