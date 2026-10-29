'use strict';
// A cross-process mutex held as a lock file, for the read-modify-rename of MEMORY.md (several
// stdio servers can share one folder). Ownership is explicit:
//
//   - The file holds a random owner token, the holder's pid and its host name. Creating it is one
//     exclusive open (O_EXCL, never through a link). That is the only way a lock is ever taken.
//   - Release removes the file only while it still holds our token.
//   - A lock older than `staleMs` is only reclaimed when its holder is gone: the pid is dead on
//     this host, the lock came from another host, or the file is not one of ours. A holder that
//     is alive on this host (merely slow or paused) is never evicted on age alone.
//   - Reclaim goes through a mutex of its own, a sibling `<lock>.reclaim` marker (same token, pid,
//     host content, same exclusive create). Only the marker's holder may touch a judged-stale
//     lock, and only after reading it again under the marker: it must still be the very file that
//     was judged and still be stale. The lock file is never renamed, moved aside or restored, so
//     no instant exists in which a live holder's lock is absent from its path. A reclaimer that
//     judged a lock stale and then paused finds, on waking, a different lock and leaves it alone.
//   - The marker is released with the same token check. A marker left by a process that died
//     inside the (microsecond) reclaim window is cleared by the same age-and-dead-pid rule as a
//     lock, with a short window (`markerStaleMs`); a marker from a live process is respected.
//   - A holder can ask `assertOwned()` right before it commits. Since nobody can remove a live
//     holder's lock, that check is sufficient to keep two writers out of the index rename.
const fs = require('node:fs');
const os = require('node:os');
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
//   beforeReclaim  after a lock was judged stale, before the marker is taken
//   underMarker    holding the marker, before the lock is read again
function createLock({ file, staleMs = 10000, markerStaleMs = 5000, waitMs = 15000, hooks = {} }) {
  const host = os.hostname();
  const markerFile = `${file}.reclaim`;

  // One exclusive create of `target` holding `content`. False when it already exists.
  function tryCreate(target, content) {
    let fd;
    try {
      fd = openNoFollow(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
    } catch (error) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
    try {
      fs.writeFileSync(fd, content);
    } catch (error) {
      fs.closeSync(fd);
      fs.rmSync(target, { force: true });
      throw error;
    }
    fs.closeSync(fd);
    return true;
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

  // Abandoned: old enough, and not held by a process that is alive on this host.
  function isStale(seen, windowMs) {
    if (Date.now() - seen.stat.mtimeMs <= windowMs) return false;
    const owner = parseOwner(seen.raw);
    return !(owner && owner.host === host && pidAlive(owner.pid));
  }

  // Unlinks `target` only while it still holds exactly `expected`. Used for release (the file is
  // ours and cannot be reclaimed from under us, see above) and for clearing a judged-stale marker.
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
    const busy = () => new LockBusy('the memory index is busy (another process is writing it); try again in a moment');
    for (;;) {
      if (tryCreate(file, mine)) return handle(token, mine);
      const seen = inspect(file);
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
