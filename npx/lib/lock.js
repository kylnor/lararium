'use strict';
// A cross-process mutex held as a lock file, for the read-modify-rename of MEMORY.md (several
// stdio servers can share one folder). It is best-effort serialization, not the safety net: the
// store journals every card it writes and re-checks the index after each commit, so a lost index
// line is restored (see store.js). The lock keeps that repair rare. What it does:
//
//   - The file holds a random owner token, the holder's pid and its host name. It is published
//     whole: the content is written to a unique temp file in the same folder, then hard-linked to
//     the lock path (link fails with EEXIST when a lock exists), then the temp is unlinked. No
//     empty or partial lock file is ever visible at the lock path. Needs a local disk.
//   - Release removes the file only while it still holds our token.
//   - A lock file that cannot be parsed (empty, partial, foreign) is never stale: it is treated as
//     busy and left alone.
//   - A lock older than `staleMs` is only reclaimed when its holder is gone: the pid is dead on
//     this host, or the lock came from another host. A holder that is alive on this host (merely
//     slow or paused) is not evicted on age alone.
//   - Reclaim goes through a mutex of its own, a sibling `<lock>.reclaim` marker (same content,
//     same atomic publish). Only the marker's holder takes down a judged-stale lock, after reading
//     it again under the marker. The lock file is never renamed, moved aside or restored.
//   - The marker is released with a token check, and a marker left by a dead process is cleared by
//     the same age-and-dead-pid rule with a short window (`markerStaleMs`).
//   - A holder can ask `assertOwned()` right before it commits.
//
// What this does not promise: the compare-then-unlink steps (releasing, clearing a stale marker,
// taking down a stale lock) are separate system calls on a pathname, so a pause in exactly the
// wrong place can still let two writers overlap. That is why the lock is not load-bearing.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { openNoFollow, readFileNoFollow } = require('./guard');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class LockBusy extends Error {
  constructor(message) {
    super(message);
    this.name = 'LockBusy';
  }
}

class LockLost extends Error {
  constructor(message) {
    super(message);
    this.name = 'LockLost';
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM'; // it exists, it is just not ours to signal
  }
}

// token / pid / host, one per line; null for anything else (an old or foreign file).
function parseOwner(raw) {
  const [token, pid, host] = String(raw).split('\n');
  if (!/^[0-9a-f]{32}$/.test(token || '') || !/^\d+$/.test(pid || '') || !host) return null;
  return { token, pid: Number(pid), host };
}

// Hooks exist so a test can park a process at an exact point (they may return a promise); nothing
// else sets them:
//   beforeLink     (sync) the temp file is complete, the lock path not yet published
//   beforeReclaim  after a lock was judged stale, before the marker is taken
//   underMarker    holding the marker, before the lock is read again
function createLock({ file, staleMs = 10000, markerStaleMs = 5000, waitMs = 15000, hooks = {} }) {
  const host = os.hostname();
  const markerFile = `${file}.reclaim`;

  // Publishes `content` at `target` in one step, or returns false when `target` already exists
  // (a link included: link(2) never follows or replaces what is there). The content goes to a
  // unique temp file first, so `target` is either absent or complete.
  function tryCreate(target, content) {
    const temp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    let fd;
    try {
      fd = openNoFollow(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
      fs.writeFileSync(fd, content);
      fs.closeSync(fd);
      fd = undefined;
      if (hooks.beforeLink) hooks.beforeLink(temp, target);
      try {
        fs.linkSync(temp, target);
      } catch (error) {
        if (error.code === 'EEXIST') return false;
        if (['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(error.code)) {
          throw new Error('this filesystem does not support hard links; keep the memory folder on a local disk');
        }
        throw error;
      }
      return true;
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already failing */ } }
      fs.rmSync(temp, { force: true });
    }
  }

  // What is in `target` right now, or null if there is nothing. A link is a GuardError.
  function inspect(target) {
    let fd;
    try {
      fd = openNoFollow(target, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile()) throw new LockBusy('the memory index lock is not a regular file');
      return { raw: fs.readFileSync(fd, 'utf8'), stat };
    } finally {
      fs.closeSync(fd);
    }
  }

  // Abandoned: old enough, parseable, and not held by a process that is alive on this host. Content
  // that cannot be parsed is never abandoned: it may be someone's lock mid-publish or not ours.
  function isStale(seen, windowMs) {
    if (Date.now() - seen.stat.mtimeMs <= windowMs) return false;
    const owner = parseOwner(seen.raw);
    if (!owner) return false;
    return !(owner.host === host && pidAlive(owner.pid));
  }

  // Unlinks `target` only while it still holds exactly `expected`. Used for release and for clearing
  // a judged-stale marker. Compare and unlink are two calls; see the note at the top.
  function removeIfHolds(target, expected) {
    let current;
    try { current = readFileNoFollow(target); } catch { return false; }
    if (current !== expected) return false;
    try {
      fs.unlinkSync(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return true;
  }

  // A marker left behind by a dead reclaimer; a live one is simply waited out.
  function clearStaleMarker() {
    const marker = inspect(markerFile);
    if (marker && isStale(marker, markerStaleMs)) removeIfHolds(markerFile, marker.raw);
  }

  // Takes down the lock we judged stale, if it is still that lock. Returns once the marker is
  // released (the caller goes back to the ordinary exclusive create), or false when another
  // reclaimer holds the marker (the caller backs off).
  async function reclaim(seen) {
    if (hooks.beforeReclaim) await hooks.beforeReclaim();
    const token = crypto.randomBytes(16).toString('hex');
    const mark = `${token}\n${process.pid}\n${host}\n`;
    if (!tryCreate(markerFile, mark)) {
      clearStaleMarker();
      return false;
    }
    try {
      if (hooks.underMarker) await hooks.underMarker();
      const now = inspect(file);
      if (now && now.raw === seen.raw && isStale(now, staleMs)) {
        try {
          fs.unlinkSync(file);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      return true;
    } finally {
      removeIfHolds(markerFile, mark);
    }
  }

  async function acquire() {
    const token = crypto.randomBytes(16).toString('hex');
    const mine = `${token}\n${process.pid}\n${host}\n`;
    const deadline = Date.now() + waitMs;
    let foreign = false; // the lock path holds something this server did not write
    const busy = () => new LockBusy(foreign
      ? `the memory index lock file (${path.basename(file)}) is not one this server wrote, so it is left alone; if no other process is writing, delete it and try again`
      : 'the memory index is busy (another process is writing it); try again in a moment');
    for (;;) {
      if (tryCreate(file, mine)) return handle(token, mine);
      const seen = inspect(file);
      foreign = Boolean(seen) && !parseOwner(seen.raw);
      if (seen && isStale(seen, staleMs)) {
        const took = await reclaim(seen);
        if (Date.now() >= deadline) throw busy();
        if (took) continue;
      } else if (Date.now() >= deadline) {
        throw busy();
      }
      await sleep(15);
    }
  }

  function handle(token, mine) {
    let released = false;
    return {
      token,
      assertOwned() {
        if (readFileNoFollow(file) !== mine) throw new LockLost('the memory index lock was lost before the write could finish');
      },
      release() {
        if (released) return;
        released = true;
        removeIfHolds(file, mine); // a lock that holds anyone else's token is not ours to remove
      },
    };
  }

  return { acquire };
}

module.exports = { createLock, LockBusy, LockLost, parseOwner };
