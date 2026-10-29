'use strict';
// The one door to the memory folder. Every read and write goes through resolveInside, so a
// name from a tool call can never name a file outside the folder: no separators, no dots at the
// front, no "..", and the resolved path (symlinks followed) must still sit directly in the folder.
const fs = require('node:fs');
const path = require('node:path');

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

module.exports = { GuardError, resolveInside, toFileName };
