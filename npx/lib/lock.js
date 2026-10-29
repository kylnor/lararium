'use strict';
// A cross-process mutex held as a lock file, for the read-modify-rename of MEMORY.md (several
// stdio servers can share one folder). Ownership is explicit:
//
//   - The file holds a random owner token, the holder's pid and its host name. Creating it is one
//     exclusive open (O_EXCL, never through a link).
//   - Release removes the file only while it still holds our token.
//   - A lock older than `staleMs` is only reclaimed when its holder is gone: the pid is dead on
//     this host, the lock came from another host, or the file is not one of ours. A holder that
//     is alive on this host (merely slow or paused) is never evicted on age alone.
//   - Removal, for release and for reclaim alike, is rename to a unique tombstone (atomic, so only
//     one process ends up holding the file), then a check that the tombstone holds exactly what
//     was inspected, then unlink. If the tombstone holds something else, a newer lock was moved
//     by mistake and is linked straight back.
//   - A holder can ask `assertOwned()` right before it commits, so a lock it somehow lost (a host
//     clock jump, a restored link that could not be put back) stops the write instead of racing.
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

// `hooks.beforeReclaimRename` exists so a test can put another process's move in the gap between
// "inspected" and "renamed"; nothing else sets it.
function createLock({ file, staleMs = 10000, waitMs = 15000, hooks = {} }) {
  const host = os.hostname();

  function tryCreate(content) {
    let fd;
    try {
      fd = openNoFollow(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
    } catch (error) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
    try {
      fs.writeFileSync(fd, content);
    } catch (error) {
      fs.closeSync(fd);
      fs.rmSync(file, { force: true });
      throw error;
    }
    fs.closeSync(fd);
    return true;
  }

  // What is in the lock file right now, or null if there is none. A link is a GuardError.
  function inspect() {
    let fd;
    try {
      fd = openNoFollow(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
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

  function isStale(seen) {
    if (Date.now() - seen.stat.mtimeMs <= staleMs) return false;
    const owner = parseOwner(seen.raw);
    return !(owner && owner.host === host && pidAlive(owner.pid));
  }

  // Moves the lock file aside and deletes it only if it holds `expected`. Returns whether it did.
  function takeDown(expected) {
    const tomb = `${file}.${crypto.randomBytes(6).toString('hex')}.tomb`;
    try {
      fs.renameSync(file, tomb);
    } catch (error) {
      if (error.code === 'ENOENT') return false; // someone else removed it first
      throw error;
    }
    let held = null;
    try { held = readFileNoFollow(tomb); } catch { /* not readable as ours: treated as foreign below */ }
    if (held === expected) {
      fs.rmSync(tomb, { force: true });
      return true;
    }
    // Not what was inspected: a newer lock was in the way. Put it back (link fails if the path was
    // taken again meanwhile; its holder then fails assertOwned rather than writing).
    try { fs.linkSync(tomb, file); } catch { /* path retaken */ }
    fs.rmSync(tomb, { force: true });
    return false;
  }

  function reclaim(seen) {
    const now = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!now || now.ino !== seen.stat.ino || now.dev !== seen.stat.dev) return; // already replaced
    if (hooks.beforeReclaimRename) hooks.beforeReclaimRename();
    takeDown(seen.raw);
  }

  async function acquire() {
    const token = crypto.randomBytes(16).toString('hex');
    const mine = `${token}\n${process.pid}\n${host}\n`;
    const deadline = Date.now() + waitMs;
    for (;;) {
      if (tryCreate(mine)) return handle(token, mine);
      const seen = inspect();
      if (seen && isStale(seen)) {
        reclaim(seen);
        if (Date.now() >= deadline) throw new LockBusy('the memory index is busy (another process is writing it); try again in a moment');
        continue;
      }
      if (Date.now() >= deadline) throw new LockBusy('the memory index is busy (another process is writing it); try again in a moment');
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
        let current;
        try { current = readFileNoFollow(file); } catch { return; }
        if (current === mine) takeDown(mine); // a lock that holds anyone else's token is not ours to remove
      },
    };
  }

  return { acquire };
}

module.exports = { createLock, LockBusy, LockLost, parseOwner };
