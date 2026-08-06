#!/usr/bin/env node
/**
 * PreToolUse hook (matcher: Write|Edit): secret-write guard.
 *
 * Scans the content ABOUT TO BE WRITTEN (tool_input.content / new_string)
 * for credential patterns and returns "ask" with line numbers on a hit.
 * Enforces the standing rule: no secrets hardcoded outside ~/.env.
 *
 * Idea from liberzon/claude-hooks secret-scanner.js (MIT); rebuilt because
 * the original read argv instead of stdin and scanned the on-disk file
 * instead of the pending write. This version scans the pending write.
 *
 * Exemptions: files named .env* (the sanctioned secret home, globally
 * gitignored) and this hook's own directory (pattern definitions).
 *
 * CONTRACT: fail open. Any uncaught error = no output = normal flow.
 * "ask", never "deny": a matched pattern can be a test fixture; false-
 * blocking the owner's real work is worse than one extra confirmation.
 */

'use strict'

const path = require('path')
const { findSecrets } = require('./secret-patterns')

// A shell write is still a write. Wiring this hook to Write|Edit alone left the
// obvious hole open: `cat > config.py <<EOF ... EOF` puts a key on disk without
// ever touching the Write tool. Matched here so the rule covers the ACT rather
// than the tool that performed it. Register on Bash too (settings.example.json).
const SHELL_WRITE_RE =
  /(?:^|[\s;&|])(?:cat|tee|printf|echo)\b[^\n]*?(?:>>?|\|\s*tee)\s*\S|<<-?\s*['"]?\w+/

/** Best-effort redirect target, for a friendlier message. Not a security check. */
function targetOf(command) {
  const m = command.match(/(?:>>?|\|\s*tee\s+)\s*(['"]?)([^\s'"]+)\1/)
  return m ? m[2] : ''
}

function main(raw) {
  let input
  try { input = JSON.parse(raw) } catch { return }

  const toolName = input.tool_name || ''
  const ti = input.tool_input || {}

  let content = ''
  let filePath = ''

  if (toolName === 'Write') {
    content = ti.content || ''
    filePath = ti.file_path || ''
  } else if (toolName === 'Edit') {
    content = ti.new_string || ''
    filePath = ti.file_path || ''
  } else if (toolName === 'Bash') {
    const command = ti.command || ''
    if (!SHELL_WRITE_RE.test(command)) return
    // Scan the whole command. The secret may be in a heredoc body, an echo
    // argument, or a printf format string; taking the command apart correctly
    // is bash-deny-guard.py's job, not this hook's.
    content = command
    filePath = targetOf(command)
  } else {
    return
  }

  const base = path.basename(filePath)

  // Sanctioned secret homes and our own pattern definitions. Note this is the
  // RUNTIME path of your installed hooks (~/.claude/hooks/), not a path inside
  // this repo, so it is deliberately not the 040_hooks/ layout name.
  if (base.startsWith('.env')) return
  if (filePath.includes('/.claude/hooks/')) return

  if (!content) return

  const findings = findSecrets(content)
  if (!findings.length) return

  const where = base ? `pending write to ${base}` : 'pending shell write'
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason:
        `Possible secret in ${where} (${findings.slice(0, 5).join('; ')}` +
        `${findings.length > 5 ? `; +${findings.length - 5} more` : ''}). ` +
        'Secrets belong in ~/.env. If this is a fixture/placeholder, approve.',
    },
  }))
}

try {
  let raw = ''
  process.stdin.on('data', (d) => { raw += d })
  process.stdin.on('end', () => { try { main(raw) } catch { /* fail open */ } })
} catch { /* fail open */ }
