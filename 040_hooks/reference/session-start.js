#!/usr/bin/env node
/**
 * SessionStart hook (reference implementation).
 *
 * Fires when a session starts, resumes, or is cleared. stdout from this hook is
 * injected into the assistant's context, so this is where the assistant "wakes
 * up knowing who it is." It assembles a briefing from four local files:
 *
 *   1. the soul core        (voice + character)
 *   2. the heartbeat        (what the last session did; written by session-end)
 *   3. now.md               (the cross-cutting current focus)
 *   4. a handoff file       (a one-shot note from the previous session, if any)
 *
 * The handoff is consumed after it is read (renamed to .consumed) so it surfaces
 * exactly once. Everything is best-effort: a missing file is skipped, any throw
 * is swallowed, and the hook always exits 0. A briefing is a nice-to-have; it
 * must never be allowed to block a session.
 *
 * stdin payload: { "source": "startup"|"resume"|"clear", "session_id": "...", "cwd": "..." }
 *
 * Test standalone:
 *   echo '{"source":"startup","session_id":"test","cwd":"/tmp"}' | node session-start.js
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

// Adjust these to wherever your stack keeps its files.
const STACK_HOME = path.join(os.homedir(), '.assistant')
const SOUL_CORE = path.join(STACK_HOME, 'soul', 'core.md')
const HEARTBEAT = path.join(STACK_HOME, 'soul', 'heartbeat.md')
const NOW_FILE = path.join(os.homedir(), 'brain', 'now.md')
const HANDOFF = path.join(STACK_HOME, 'handoff.md')

const HANDOFF_MAX_AGE_MS = 6 * 60 * 60 * 1000 // ignore a handoff older than 6h

function readFileOr(filePath, fallback) {
  try {
    const body = fs.readFileSync(filePath, 'utf8').trim()
    return body || fallback
  } catch {
    return fallback
  }
}

/**
 * Read the handoff exactly once, then rename it to .consumed so the next
 * session does not see it again. Stale handoffs are dropped silently.
 */
function readHandoffOnce() {
  try {
    if (!fs.existsSync(HANDOFF)) return ''
    const ageMs = Date.now() - fs.statSync(HANDOFF).mtimeMs
    if (ageMs > HANDOFF_MAX_AGE_MS) return ''
    const body = fs.readFileSync(HANDOFF, 'utf8').trim()
    if (!body) return ''
    fs.renameSync(HANDOFF, HANDOFF + '.consumed')
    return body
  } catch {
    return ''
  }
}

function buildBriefing() {
  const blocks = []

  const core = readFileOr(SOUL_CORE, '')
  if (core) blocks.push(`[Soul core: always active]\n${core}`)

  const heartbeat = readFileOr(HEARTBEAT, '')
  if (heartbeat) blocks.push(`[Last session: heartbeat]\n${heartbeat}`)

  const now = readFileOr(NOW_FILE, '')
  if (now) blocks.push(`[Now: current focus]\n${now}`)

  // Handoff is placed last so it is the freshest thing the assistant reads.
  const handoff = readHandoffOnce()
  if (handoff) blocks.push(`[Session handoff: resume here]\n${handoff}`)

  return blocks.join('\n\n---\n\n')
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  try {
    let source = 'startup'
    try {
      const data = JSON.parse(input)
      source = data.source || 'startup'
    } catch {
      // No/invalid payload: treat as a normal startup and brief anyway.
    }

    // On /clear, resurface only the handoff (a fresh full briefing would defeat
    // the point of clearing). On startup/resume, build the whole thing.
    let output = ''
    if (source === 'clear') {
      const handoff = readHandoffOnce()
      if (handoff) output = `[Session handoff: resume here]\n${handoff}`
    } else {
      output = buildBriefing()
    }

    if (output) process.stdout.write(output)
  } catch {
    // Never break the session on a briefing failure.
  }
  process.exit(0)
})
