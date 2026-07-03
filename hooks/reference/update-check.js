#!/usr/bin/env node
/**
 * SessionStart hook (reference implementation): the update checker.
 *
 * A clone is a detached copy: nothing tells you an upstream release exists. This
 * hook is that signal, delivered into the session instead of relying on you to
 * watch the repo. Once a day it asks the upstream template what its current
 * version is, compares it to your local STACK_VERSION, and if you are behind it
 * injects one line: "a newer template is out, type /upgrade." That is all it does.
 *
 * Throttle: at most one network check per 24h. Between checks it reads a cached
 * remote version from a small state file, so the nudge keeps showing every
 * session until you upgrade while the network is touched only once a day.
 *
 * SECURITY (this is the whole reason the hook is shaped the way it is). The
 * fetched body is untrusted remote input flowing into a session's context. A
 * SessionStart hook's stdout is injected into the model, so anything this hook
 * echoes from the network is content the upstream repo owner could put in front
 * of every subscriber's assistant. Therefore:
 *   - The ONLY thing accepted from the network is a version string matching
 *     ^v\d+(\.\d+)*$ (trimmed, length-capped). Anything else is treated as a
 *     failed check and dropped silently.
 *   - No other remote content is ever injected. No changelog text, no release
 *     notes, no message from the response body. The nudge is LOCAL STATIC text
 *     assembled here from two version numbers. If it were not, the upstream
 *     owner could inject instructions into every subscriber's session.
 *
 * Fail soft on everything: no network, bad DNS, a 404, a timeout, a garbage
 * body, a disabled flag: emit nothing, exit 0. A missed nudge is nothing; a
 * blocked session is not acceptable.
 *
 * Output contract (only when a newer version is found), printed to stdout:
 *   { "hookSpecificOutput": {
 *       "hookEventName": "SessionStart",
 *       "additionalContext": "Template <remote> is available ..."
 *   } }
 * Otherwise print nothing. Always exit 0.
 *
 * Config. The hook resolves three knobs, each overridable:
 *   - templateUpstream: which repo to check. Default below; forks re-point it.
 *   - updateCheck: on/off. Default on.
 *   Both are read from your Claude Code settings.json under a "stackUpdateCheck"
 *   block (see hooks/settings.example.json), falling back to the constants below
 *   when that file or block is absent. The env var STACK_UPDATE_CHECK is a hard
 *   kill: set it to 0/off/false/no to disable without editing any file.
 *
 * Privacy: an enabled check makes one HTTPS GET to GitHub per day, which exposes
 * your IP to GitHub the same way visiting the repo would. Turn it off (env var or
 * the config flag) if that matters to you.
 *
 * stdin payload: { "source": "startup"|"resume"|"clear", "session_id": "...", "cwd": "..." }
 *
 * Test standalone (a fixture seam stands in for the network so the five paths are
 * exercisable without a mock framework; unset it for a real fetch):
 *   # behind: local v2.3, remote v2.4 -> emits a nudge
 *   echo '{"source":"startup"}' | STACK_UPDATE_CHECK_FIXTURE=v2.4 node update-check.js
 *   # current: local == remote -> silent
 *   echo '{"source":"startup"}' | STACK_UPDATE_CHECK_FIXTURE=v2.3 node update-check.js
 *   # garbage response -> silent
 *   echo '{"source":"startup"}' | STACK_UPDATE_CHECK_FIXTURE='rm -rf /' node update-check.js
 *   # disabled -> silent
 *   echo '{"source":"startup"}' | STACK_UPDATE_CHECK=off node update-check.js
 *   # unreachable / real fetch -> hits the upstream, silent unless you are behind
 *   echo '{"source":"startup"}' | node update-check.js
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const https = require('https')

// ── Config defaults (constants; overridden by settings.json, see the doc block) ──
const DEFAULT_UPSTREAM = 'kylnor/agentic-stack'
const DEFAULT_ENABLED = true

// Where the pieces live. Named constants: point them at your own layout.
const STACK_HOME = path.join(os.homedir(), '.assistant')
const STATE_FILE = path.join(STACK_HOME, '.update-check-state.json')
const LOCAL_VERSION_FILE = path.join(STACK_HOME, 'STACK_VERSION') // your installed stamp
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json')

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // one network check per 24h
const FETCH_TIMEOUT_MS = 2500 // short: a briefing must not wait on the network
const VERSION_RE = /^v\d+(\.\d+)*$/
const MAX_VERSION_LEN = 20 // a real stamp is tiny; cap before we even test it

/**
 * The one gate every version string passes through, remote or local. Trim,
 * length-cap, then match the strict shape. Returns the clean string or null.
 * Everything downstream can trust a non-null return absolutely.
 */
function sanitizeVersion(raw) {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v || v.length > MAX_VERSION_LEN) return null
  return VERSION_RE.test(v) ? v : null
}

/** Numeric per-segment compare. v2.10 > v2.9. Returns >0 if a>b, <0 if a<b, 0 equal. */
function compareVersions(a, b) {
  const pa = a.slice(1).split('.').map(Number) // both already passed sanitize
  const pb = b.slice(1).split('.').map(Number)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da !== db) return da - db
  }
  return 0
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return null }
}

/** Resolve config: constants, overlaid by settings.json, with the env kill on top. */
function resolveConfig() {
  let enabled = DEFAULT_ENABLED
  let upstream = DEFAULT_UPSTREAM

  const settings = readJson(SETTINGS_FILE)
  const block = settings && settings.stackUpdateCheck
  if (block && typeof block === 'object') {
    if (typeof block.updateCheck === 'boolean') enabled = block.updateCheck
    if (typeof block.templateUpstream === 'string' && block.templateUpstream.trim()) {
      upstream = block.templateUpstream.trim()
    }
  }

  // Hard env kill overrides everything.
  const kill = String(process.env.STACK_UPDATE_CHECK || '').trim().toLowerCase()
  if (kill === '0' || kill === 'off' || kill === 'false' || kill === 'no') enabled = false

  // Reject an upstream that is not a plain "owner/repo": it goes into a URL.
  if (!/^[\w.-]+\/[\w.-]+$/.test(upstream)) upstream = DEFAULT_UPSTREAM

  return { enabled, upstream }
}

/** The local stamp. Absent means a pre-stamp stack: treat as v1 = always behind. */
function readLocalVersion() {
  try {
    return sanitizeVersion(fs.readFileSync(LOCAL_VERSION_FILE, 'utf8')) || 'v1'
  } catch {
    return 'v1'
  }
}

/**
 * Fetch the upstream STACK_VERSION over HTTPS, stdlib only. Resolves to a clean
 * version string or null. A test fixture short-circuits the network so the hook
 * is standalone-testable; any real failure path also resolves null (fail soft).
 */
function fetchRemoteVersion(upstream) {
  if (Object.prototype.hasOwnProperty.call(process.env, 'STACK_UPDATE_CHECK_FIXTURE')) {
    return Promise.resolve(sanitizeVersion(process.env.STACK_UPDATE_CHECK_FIXTURE))
  }
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    try {
      const url = `https://raw.githubusercontent.com/${upstream}/main/STACK_VERSION`
      const req = https.get(url, (res) => {
        if (res.statusCode !== 200) { res.resume(); return done(null) }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
          if (body.length > 256) { req.destroy(); done(sanitizeVersion(body)) } // never read a large body
        })
        res.on('end', () => done(sanitizeVersion(body)))
      })
      req.setTimeout(FETCH_TIMEOUT_MS, () => { req.destroy(); done(null) })
      req.on('error', () => done(null))
    } catch {
      done(null)
    }
  })
}

function readState() { return readJson(STATE_FILE) || {} }

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(state))
  } catch {
    // A state write failure just means we re-check sooner; never fatal.
  }
}

/**
 * Decide the remote version to compare against, honoring the 24h throttle.
 * Inside the window we reuse the cached value and skip the network entirely.
 * Outside it we fetch; on a successful fetch we refresh the cache, on a failed
 * one we fall back to whatever was cached. Returns a clean version or null.
 */
async function resolveRemoteVersion(upstream) {
  const state = readState()
  const cached = sanitizeVersion(state.lastRemote)
  const lastAt = Number(state.lastCheckAt) || 0
  const fresh = Date.now() - lastAt < CHECK_INTERVAL_MS

  if (fresh && cached) return cached

  const fetched = await fetchRemoteVersion(upstream)
  if (fetched) {
    writeState({ lastCheckAt: Date.now(), lastRemote: fetched })
    return fetched
  }
  // Fetch failed: stamp the attempt so we do not hammer a down endpoint every
  // session, but keep the last good cached value to compare against.
  writeState({ lastCheckAt: Date.now(), lastRemote: cached || null })
  return cached
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', async () => {
  try {
    const { enabled, upstream } = resolveConfig()
    if (!enabled) return process.exit(0)

    const local = readLocalVersion()
    const remote = await resolveRemoteVersion(upstream)
    if (!remote) return process.exit(0) // no trustworthy remote: say nothing

    if (compareVersions(remote, local) > 0) {
      // LOCAL STATIC text. The only values interpolated are two version strings
      // that each passed sanitizeVersion; no remote body content reaches here.
      const context =
        `Template ${remote} is available (you are on ${local}). ` +
        `Type /upgrade to apply, or see CHANGELOG.md upstream.`
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: context,
        },
      }))
    }
  } catch {
    // Never break a session on an update-check failure.
  }
  process.exit(0)
})
