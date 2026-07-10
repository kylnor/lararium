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

const PATTERNS = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9-]{20,}/ },
  { name: 'OpenAI key', re: /\bsk-(proj-)?[A-Za-z0-9]{32,}/ },
  { name: 'Stripe live key', re: /\b[sr]k_live_[A-Za-z0-9]{20,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: 'Slack token', re: /\bxox[bpors]-[0-9A-Za-z-]{10,}/ },
  { name: 'Telegram bot token', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}/ },
  { name: 'Private key block', re: /-----BEGIN (RSA|EC|OPENSSH|PGP|DSA)? ?PRIVATE KEY-----/ },
  { name: 'DB URL with password', re: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis):\/\/[^:\s'"]+:[^@\s'"]+@/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
]

function main(raw) {
  let input
  try { input = JSON.parse(raw) } catch { return }

  const toolName = input.tool_name || ''
  if (toolName !== 'Write' && toolName !== 'Edit') return

  const ti = input.tool_input || {}
  const filePath = ti.file_path || ''
  const base = path.basename(filePath)

  // Sanctioned secret homes and our own pattern definitions.
  if (base.startsWith('.env')) return
  if (filePath.includes('/.claude/hooks/')) return

  const content = toolName === 'Write' ? (ti.content || '') : (ti.new_string || '')
  if (!content) return

  const findings = []
  const lines = content.split('\n')
  for (const { name, re } of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) findings.push(`line ${i + 1}: ${name}`)
    }
  }
  if (!findings.length) return

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason:
        `Possible secret in pending write to ${base} (${findings.slice(0, 5).join('; ')}` +
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
