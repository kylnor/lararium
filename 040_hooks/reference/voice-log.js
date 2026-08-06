#!/usr/bin/env node
/**
 * Stop hook (reference implementation): the voice logger.
 *
 * Fires on every assistant response. It appends the latest response (plus the
 * prompt that produced it and a timestamp) to a local JSONL file. That file is
 * the raw material for voice-drift monitoring: a separate, scheduled job (a cron
 * you write) samples a handful of these records, scores whether the assistant
 * still sounds like its soul core, and alerts you if the average slips.
 *
 * This hook only CAPTURES. It does no scoring: a Stop hook fires on every single
 * response, so it has to be cheap. Anything expensive (an LLM judge) belongs in
 * the out-of-band job, not here.
 *
 * It tracks a per-session read offset in a state file so the same response is
 * never logged twice as the transcript grows.
 *
 * stdin payload: { "session_id": "...", "transcript_path": "/path/to/transcript.jsonl", "cwd": "..." }
 *
 * Test standalone (no transcript file needed: it no-ops cleanly):
 *   echo '{"session_id":"test","transcript_path":"/nonexistent","cwd":"/tmp"}' | node voice-log.js
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const { redact } = require('./secret-patterns')

const STACK_HOME = path.join(os.homedir(), '.assistant')
const LOG_FILE = path.join(STACK_HOME, 'voice-log.jsonl')
const STATE_FILE = path.join(STACK_HOME, '.voice-log-state.json')
const MAX_RESPONSE_LEN = 8000

// Drift scoring samples a handful of recent records. It never needed the whole
// history, and an unbounded append-only file of everything you have ever said
// to your assistant is a liability with no upside.
const MAX_RECORDS = 500
const FILE_MODE = 0o600

function extractText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}

function writeState(state) {
  // Cap the state file: keep the most recent 200 sessions.
  const keys = Object.keys(state)
  if (keys.length > 200) {
    const keep = keys.slice(-200)
    const trimmed = {}
    for (const k of keep) trimmed[k] = state[k]
    state = trimmed
  }
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state))
}

/**
 * Keep the newest MAX_RECORDS lines. Cheap: a Stop hook fires on every single
 * response, so this only pays the read-and-rewrite cost once the file is
 * actually over the cap, and the check itself is one statSync.
 */
function rotate() {
  try {
    const stat = fs.statSync(LOG_FILE)
    // ~2KB/record is the rough ceiling given the slices above. Skip the read
    // entirely until the file could plausibly be over the line count.
    if (stat.size < MAX_RECORDS * 2048) return
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean)
    if (lines.length <= MAX_RECORDS) return
    const kept = lines.slice(-MAX_RECORDS).join('\n') + '\n'
    fs.writeFileSync(LOG_FILE, kept, { mode: FILE_MODE })
    fs.chmodSync(LOG_FILE, FILE_MODE)
  } catch {
    // Rotation is housekeeping. Never break a session over it.
  }
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input)
    const sessionId = data.session_id
    const transcriptPath = data.transcript_path
    if (!sessionId || !transcriptPath || !fs.existsSync(transcriptPath)) return

    const state = readState()
    const lastOffset = state[sessionId] || 0

    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n')
    let lastUserMsg = null
    let assistantText = ''
    let endIdx = lastOffset

    // Walk forward from where we last stopped: track the newest human prompt and
    // accumulate the assistant response that follows it.
    for (let i = lastOffset; i < lines.length; i++) {
      if (!lines[i]) continue
      let entry
      try { entry = JSON.parse(lines[i]) } catch { continue }

      if (entry.type === 'user') {
        const msg = entry.message || {}
        if (typeof msg.content === 'string' && msg.content.trim() &&
            entry.userType === 'external' && !entry.toolUseResult) {
          lastUserMsg = msg.content
          assistantText = ''
        }
      } else if (entry.type === 'assistant') {
        const text = extractText((entry.message || {}).content)
        if (text.trim()) assistantText += (assistantText ? '\n' : '') + text
      }
      endIdx = i + 1
    }

    if (assistantText && lastUserMsg) {
      // Redact BEFORE anything touches disk. This hook sees every response,
      // which means it sees every credential the assistant was shown or
      // generated. secret-write-guard.js asks before a secret reaches a repo;
      // writing it here unredacted would make that guard theatre.
      const prompt = redact(String(lastUserMsg).slice(0, 1000))
      const response = redact(assistantText.slice(0, MAX_RESPONSE_LEN))
      const redacted = [...new Set([...prompt.hits, ...response.hits])]

      const record = {
        ts: new Date().toISOString(),
        session_id: sessionId,
        prompt: prompt.text,
        response: response.text,
        response_len: assistantText.length,
      }
      if (redacted.length) record.redacted = redacted

      fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
      fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', { mode: FILE_MODE })
      // mode: on appendFileSync only applies at creation, so enforce it every
      // time. A voice log is a transcript of your life; 0644 is not the right
      // answer on a shared or backed-up machine.
      try { fs.chmodSync(LOG_FILE, FILE_MODE) } catch { /* best effort */ }
      rotate()
    }

    if (endIdx > lastOffset) {
      state[sessionId] = endIdx
      writeState(state)
    }
  } catch {
    // Never break the session on a logging failure.
  }
  process.exit(0)
})
