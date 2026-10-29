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

// The same containment for the files the server keeps beside the cards: the index (MEMORY.md),
// the vector cache folder (.index/) and the temp files written on the way. None of them may be a
// symbolic link, because a link would carry a read or a write out of the memory folder. The
// messages name the entry, never the owner's absolute path, because they travel back to the app.
function resolveAuxFile(dir, name) {
  const target = path.join(dir, name);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return target;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new GuardError(`${name} is a symbolic link; refusing to follow it out of the memory folder`);
  if (!stat.isFile()) throw new GuardError(`${name} is not a regular file`);
  return target;
}

// A real directory directly inside the memory folder. Returns null when absent unless `create`.
function resolveAuxDir(root, name, { create = false } = {}) {
  const realRoot = fs.realpathSync(root);
  const target = path.join(realRoot, name);
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
  if (fs.realpathSync(target) !== target) throw new GuardError(`${name} resolves outside the memory folder`);
  return target;
}

module.exports = { GuardError, resolveInside, resolveAuxFile, resolveAuxDir, toFileName };
