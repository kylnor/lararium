'use strict';
// The one door to the memory folder. Every read and write goes through resolveInside, so a
// name from a tool call can never name a file outside the folder: no separators, no dots at the
// front, no "..", and the resolved path (symlinks followed) must still sit directly in the folder.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class GuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GuardError';
  }
}

const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_NAME_LENGTH = 120;

// Normalizes a card name to its file name ("prefers-short-replies" -> "prefers-short-replies.md").
function toFileName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new GuardError('name must be a non-empty string of at most 120 characters');
  }
  if (name.includes('\0')) throw new GuardError('name contains a NUL byte');
  const file = name.endsWith('.md') ? name : `${name}.md`;
  if (!FILE_NAME_RE.test(file) || file.includes('..')) {
    throw new GuardError('name may only contain letters, digits, dot, dash and underscore, and may not contain ".."');
  }
  return file;
}

// Returns the absolute path of <root>/<name>.md, or throws GuardError. Does not require the file
// to exist, so remember can use it for a new card.
function resolveInside(root, name) {
  const file = toFileName(name);
  const realRoot = fs.realpathSync(root);
  const target = path.join(realRoot, file);
  if (path.dirname(target) !== realRoot) throw new GuardError('name resolves outside the memory folder');
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return target;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new GuardError('symbolic links are not served');
  if (!stat.isFile()) throw new GuardError('not a regular file');
  const real = fs.realpathSync(target);
  if (path.dirname(real) !== realRoot) throw new GuardError('name resolves outside the memory folder');
  return real;
}

// ---- auxiliary files: open without following, then work on the descriptor ------------------------
// The server keeps a few files beside the cards: the index (MEMORY.md), the lock file and the
// vector cache (.index/). A path check followed by a separate open leaves a gap in which a link
// could be put in the file's place, so these files are opened with O_NOFOLLOW (a link at the last
// component fails the open itself) and then read or written through the descriptor, after fstat
// says it is a regular file. The messages name the entry, never the owner's absolute path, because
// they travel back to the app.
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const O_NONBLOCK = fs.constants.O_NONBLOCK || 0;
const linkRefusal = file => new GuardError(`${path.basename(file)} is a symbolic link; refusing to follow it out of the memory folder`);

// fs.openSync that refuses a symbolic link at `file` instead of following it. `flags` is numeric.
function openNoFollow(file, flags, mode = 0o644) {
  if (!O_NOFOLLOW) { // no O_NOFOLLOW on this platform: the best that is left is a look right before
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (stat && stat.isSymbolicLink()) throw linkRefusal(file);
  }
  try {
    return fs.openSync(file, flags | O_NOFOLLOW, mode);
  } catch (error) {
    if (error.code === 'ELOOP' || error.code === 'EMLINK') throw linkRefusal(file);
    throw error;
  }
}

// The text of a regular file read through a no-follow descriptor, or null when it is not there.
// A symbolic link (even a dangling one) is a GuardError, never an empty file.
function readFileNoFollow(file, encoding = 'utf8') { // encoding null returns the exact bytes as a Buffer
  let fd;
  try {
    fd = openNoFollow(file, fs.constants.O_RDONLY | O_NONBLOCK); // O_NONBLOCK: a FIFO must not hang the open
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) throw new GuardError(`${path.basename(file)} is not a regular file`);
    return encoding === null ? fs.readFileSync(fd) : fs.readFileSync(fd, encoding);
  } finally {
    fs.closeSync(fd);
  }
}

// Writes `data` to a new temp file beside `file` (exclusive create, never through a link) and
// renames it into place. `beforeCommit` runs after the temp file is complete and just before the
// rename, the last point at which the caller can still back out.
function writeFileAtomic(file, data, { mode = 0o644, beforeCommit } = {}) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let fd;
  try {
    fd = openNoFollow(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, mode);
    fs.writeFileSync(fd, data);
    fs.closeSync(fd);
    fd = undefined;
    if (beforeCommit) beforeCommit();
    fs.renameSync(temp, file); // replaces whatever is at `file`, a link included, without following it
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already failing */ } }
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// A real directory directly inside the memory folder, pinned: `check()` looks again (lstat) and
// refuses if the entry became a link, stopped being a directory, or is no longer the same
// directory (device and inode) that was validated. Call it after the I/O that depends on the
// directory and before anything is committed. Returns null when absent unless `create`.
function pinAuxDir(root, name, { create = false } = {}) {
  const realRoot = fs.realpathSync(root);
  const target = path.join(realRoot, name);
  const refuse = why => new GuardError(`${name} ${why}`);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!create) return null;
    try { fs.mkdirSync(target, { mode: 0o755 }); } catch (mkError) { if (mkError.code !== 'EEXIST') throw mkError; }
    stat = fs.lstatSync(target);
  }
  if (stat.isSymbolicLink()) throw new GuardError(`${name} is a symbolic link; refusing to follow it out of the memory folder`);
  if (!stat.isDirectory()) throw new GuardError(`${name} is not a folder`);
  if (fs.realpathSync(target) !== target) throw refuse('resolves outside the memory folder');
  const { dev, ino } = stat;
  const check = () => {
    const now = fs.lstatSync(target, { throwIfNoEntry: false });
    if (!now || now.isSymbolicLink() || !now.isDirectory() || now.dev !== dev || now.ino !== ino) {
      throw refuse('changed while in use; refusing to continue');
    }
  };
  return { path: target, check };
}

module.exports = { GuardError, resolveInside, openNoFollow, readFileNoFollow, writeFileAtomic, pinAuxDir, toFileName };
