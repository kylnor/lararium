#!/usr/bin/env node
/**
 * SessionEnd hook (reference implementation): the heartbeat writer.
 *
 * This is the write half of "remember yesterday." When a session ends, it reads
 * the transcript, extracts a cheap summary of what happened, and writes it to a
 * heartbeat file. The next session's SessionStart hook reads that file, so the
 * assistant wakes up knowing where you left off.
 *
 * This reference version writes a mechanical summary: the last few user prompts
 * plus the opening line of each assistant reply. That is deliberately dumb and
 * dependency-free. See the marked block below for where you would swap in an LLM
 * summarization call to turn the raw tail into a paragraph in the assistant's
 * own voice.
 *
 * stdin payload: { "session_id": "...", "transcript_path": "/path/to/transcript.jsonl", "cwd": "..." }
 *
 * The transcript is JSONL: one JSON object per line. Human turns are
 * { type: "user", message: { content: "..." }, userType: "external" }. Assistant
 * turns are { type: "assistant", message: { content: [ { type: "text", text } ] } }.
 *
 * Test standalone (missing transcript preserves the previous heartbeat):
 *   echo '{"session_id":"test","transcript_path":"/nonexistent","cwd":"/tmp"}' | node session-end-heartbeat.js
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

// Same root resolution as session-start.js: LARARIUM_ROOT, else the stack this
// file ships in, else the legacy ~/.assistant layout.
const ENV_ROOT = process.env.LARARIUM_ROOT
if (ENV_ROOT && !path.isAbsolute(ENV_ROOT)) { console.error('Lararium memory: LARARIUM_ROOT must be absolute.'); process.exit(0) }
const SHIPPED_ROOT = path.resolve(__dirname, '..', '..')
const ROOT = ENV_ROOT || (fs.existsSync(path.join(SHIPPED_ROOT, 'brain', 'CLAUDE.md')) ? SHIPPED_ROOT : '')
const STACK_HOME = ROOT || path.join(os.homedir(), '.assistant')
const HEARTBEAT = path.join(STACK_HOME, 'soul', 'heartbeat.md')
const MIN_EXCHANGES = 1 // a single completed exchange can carry useful context

/** Pull plain text out of an assistant content array (or a bare string). */
function extractText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
}

/** Parse the transcript into { user, assistant } exchange pairs. */
function parseExchanges(transcriptPath) {
  const exchanges = []
  const raw = fs.readFileSync(transcriptPath, 'utf8')
  let pendingUser = null
  let pendingAssistant = ''

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }

    if (entry.type === 'user') {
      const msg = entry.message || {}
      const userText = extractText(msg.content).trim()
      const isHuman = userText &&
        (entry.userType === undefined || entry.userType === 'external') &&
        !entry.toolUseResult && !entry.isMeta && !entry.isSidechain
      if (isHuman) {
        if (pendingUser && pendingAssistant) {
          exchanges.push({ user: pendingUser, assistant: pendingAssistant })
        }
        pendingUser = userText
        pendingAssistant = ''
      }
    } else if (entry.type === 'assistant' && !entry.isSidechain && !entry.isApiErrorMessage) {
      const message = entry.message || {}
      // Modern transcripts identify final answers; do not save an interrupted tool turn.
      if ('stop_reason' in message && message.stop_reason !== 'end_turn' && message.stop_reason !== 'stop_sequence') continue
      const text = extractText(message.content)
      if (text.trim()) pendingAssistant += (pendingAssistant ? '\n' : '') + text.trim()
    }
  }
  if (pendingUser && pendingAssistant) {
    exchanges.push({ user: pendingUser, assistant: pendingAssistant })
  }
  return exchanges
}

/** Build a cheap, deterministic summary from the tail of the conversation. */
function cheapSummary(exchanges) {
  const tail = exchanges.slice(-4)
  const lines = tail.map((ex) => {
    const ask = ex.user.replace(/\s+/g, ' ').slice(0, 600)
    const firstReplyLine = ex.assistant.split('\n').find((l) => l.trim()) || ''
    const did = firstReplyLine.replace(/\s+/g, ' ').slice(0, 600)
    return `- User excerpt: ${ask}\n  Assistant excerpt (unverified): ${did}`
  })
  return lines.join('\n')

  // ── UPGRADE POINT ─────────────────────────────────────────────────────────
  // Replace the mechanical tail above with a single LLM call: pass the last
  // ~12 exchanges to a cheap/fast model and ask for 1-3 sentences in the
  // assistant's own first-person voice ("you shipped X, left Y unresolved").
  // That paragraph is what makes the next session's wake-up feel alive rather
  // than like reading a diff. Keep it fail-soft: on any API error, fall back to
  // the cheap summary so the heartbeat still gets written.
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input)
    const transcriptPath = data.transcript_path
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return

    const exchanges = parseExchanges(transcriptPath)
    if (exchanges.length < MIN_EXCHANGES) return

    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const body = `_Last updated ${stamp} UTC: ${exchanges.length} completed exchanges_\n\nRecent conversation excerpts only. Earlier statements may be superseded; assistant replies are not verified facts.\n\n${cheapSummary(exchanges)}\n`

    fs.mkdirSync(path.dirname(HEARTBEAT), { recursive: true })
    const temporary = HEARTBEAT + '.' + process.pid + '.tmp'
    try {
      fs.writeFileSync(temporary, body, { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, HEARTBEAT) // atomic replacement: readers see a complete file
    } finally {
      try { fs.unlinkSync(temporary) } catch {}
    }
  } catch {
    // Never break session shutdown on a heartbeat failure.
  }
  process.exit(0)
})
