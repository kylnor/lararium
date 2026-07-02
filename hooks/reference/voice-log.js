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

const STACK_HOME = path.join(os.homedir(), '.assistant')
const LOG_FILE = path.join(STACK_HOME, 'voice-log.jsonl')
const STATE_FILE = path.join(STACK_HOME, '.voice-log-state.json')
const MAX_RESPONSE_LEN = 8000

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
      const record = {
        ts: new Date().toISOString(),
        session_id: sessionId,
        prompt: String(lastUserMsg).slice(0, 1000),
        response: assistantText.slice(0, MAX_RESPONSE_LEN),
        response_len: assistantText.length,
      }
      fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
      fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n')
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
