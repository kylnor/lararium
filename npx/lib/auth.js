'use strict';
// Tokens and signatures for the HTTP transport. Two static bearer tokens, a read tier and a
// write tier, live in a private file (or the environment) on the owner's machine. Everything the
// OAuth shim hands out is a signed, expiring blob derived from those two tokens, so there is no
// database: rotate the tokens and every issued credential dies with them.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const MIN_TOKEN_LENGTH = 32;

function configDir(env = process.env) {
  if (env.LARARIUM_SERVE_HOME) return path.resolve(env.LARARIUM_SERVE_HOME);
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'lararium');
}

function newToken(prefix) {
  return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
}

function readSaved(file) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return saved && saved.readToken && saved.writeToken ? { readToken: saved.readToken, writeToken: saved.writeToken } : null;
  } catch { return null; }
}

// Writes the token file whole or not at all (temp file, then rename), so a running server that
// notices the change never reads half of it, and the rename gives the file a new inode.
function writeTokenFile(dir, file, tokens) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, `serve.json.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify({ ...tokens, createdAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
}

// The tokens in force: environment values win over the file. Throws when they are missing, too
// short, or the same.
function effectiveTokens(saved, env) {
  const tokens = {
    readToken: env.LARARIUM_READ_TOKEN || (saved && saved.readToken),
    writeToken: env.LARARIUM_WRITE_TOKEN || (saved && saved.writeToken),
  };
  for (const [label, value] of [['read', tokens.readToken], ['write', tokens.writeToken]]) {
    if (typeof value !== 'string' || value.length < MIN_TOKEN_LENGTH) {
      throw new Error(`the ${label} token must be at least ${MIN_TOKEN_LENGTH} characters`);
    }
  }
  if (tokens.readToken === tokens.writeToken) throw new Error('the read token and the write token must differ');
  return tokens;
}

// Reads the token file, creating it (mode 0600) on first use. Environment values win when set.
// `rotate` replaces whatever is saved.
function loadTokens({ env = process.env, rotate = false } = {}) {
  const dir = configDir(env);
  const file = path.join(dir, 'serve.json');
  let saved = rotate ? null : readSaved(file);
  let created = false;
  if (!saved) {
    saved = { readToken: newToken('lrr'), writeToken: newToken('lrw') };
    writeTokenFile(dir, file, saved);
    created = true;
  }
  return { ...effectiveTokens(saved, env), file, created };
}

// A live view of the token file for a long-running server. Each call to current() costs one stat;
// when the file was replaced (as --rotate-tokens does) it is read again, so the old tokens and
// everything signed from them stop working on the very next request, with no restart. If the file
// goes missing or unreadable the answer is null and the server refuses everything: a rotation
// must never leave the old tokens alive.
function createTokenSource({ env = process.env } = {}) {
  const file = path.join(configDir(env), 'serve.json');
  let seen;
  let view = null;
  const signature = () => {
    try {
      const s = fs.statSync(file);
      return `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
    } catch { return 'missing'; }
  };
  function current() {
    const now = signature();
    if (now === seen) return view;
    seen = now;
    try {
      const tokens = effectiveTokens(readSaved(file), env);
      view = { tokens, key: signingKey(tokens) };
    } catch { view = null; }
    return view;
  }
  return { file, current };
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Which tier a presented static token grants: 'write', 'read' or null. Both comparisons always
// run so timing does not reveal which one failed.
function tierOfStaticToken(presented, { readToken, writeToken }) {
  if (typeof presented !== 'string' || !presented) return null;
  const isWrite = safeEqual(presented, writeToken);
  const isRead = safeEqual(presented, readToken);
  return isWrite ? 'write' : isRead ? 'read' : null;
}

function bearerFrom(req) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer[ ]+(\S+)$/i);
  return m ? m[1] : '';
}

function signingKey({ readToken, writeToken }) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(`${readToken}\0${writeToken}`), Buffer.from('lararium-serve-v1'), Buffer.from('oauth-signing'), 32));
}

function sign(key, kind, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', key).update(`${kind}.${body}`).digest('base64url');
  return `${kind}.${body}.${mac}`;
}

// Returns the payload when the blob is of this kind, correctly signed and unexpired; else null.
function verify(key, kind, blob) {
  if (typeof blob !== 'string') return null;
  const parts = blob.split('.');
  if (parts.length !== 3 || parts[0] !== kind) return null;
  const expected = crypto.createHmac('sha256', key).update(`${kind}.${parts[1]}`).digest('base64url');
  if (!safeEqual(expected, parts[2])) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
  return payload;
}

// Fixed-window counter keyed by caller. Only unauthenticated endpoints and failed attempts count;
// a request that presents a valid token is never throttled.
function createLimiter({ max, windowMs, now = Date.now }) {
  const hits = new Map();
  return function allow(key) {
    const t = now();
    for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
    const entry = hits.get(key) || { count: 0, reset: t + windowMs };
    entry.count += 1;
    hits.set(key, entry);
    return entry.count <= max;
  };
}

module.exports = {
  configDir, loadTokens, createTokenSource, tierOfStaticToken, bearerFrom, signingKey, sign, verify, createLimiter, safeEqual, MIN_TOKEN_LENGTH,
};
