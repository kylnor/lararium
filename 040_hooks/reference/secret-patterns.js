'use strict'
/**
 * Shared credential patterns. One source of truth for every hook that has an
 * opinion about secrets.
 *
 * This module exists because two hooks in this directory used to disagree.
 * secret-write-guard.js asked for confirmation before a credential reached
 * disk; voice-log.js then appended every prompt and every response to a JSONL
 * file, verbatim and forever. Whatever the first hook stopped you writing into
 * a repo, the second one wrote to disk anyway. A rule enforced in one place and
 * ignored in another is not a rule.
 *
 * Add a pattern here and every consumer gets it.
 */

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

/**
 * Replace every credential-shaped run with a labelled marker.
 *
 * Redaction, not detection: the caller wants text it is safe to persist, and
 * it must be safe even when a pattern matches something that only looks like a
 * key. Losing a false positive from a log costs nothing; keeping a real key
 * costs everything.
 */
function redact(text) {
  if (typeof text !== 'string' || !text) return { text: text || '', hits: [] }
  let out = text
  const hits = []
  for (const { name, re } of PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    if (global.test(out)) {
      hits.push(name)
      global.lastIndex = 0
      out = out.replace(global, `[REDACTED:${name}]`)
    }
  }
  return { text: out, hits }
}

/** Line numbers and names for a "you are about to write this" warning. */
function findSecrets(content) {
  const findings = []
  if (typeof content !== 'string' || !content) return findings
  const lines = content.split('\n')
  for (const { name, re } of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) findings.push(`line ${i + 1}: ${name}`)
    }
  }
  return findings
}

module.exports = { PATTERNS, redact, findSecrets }
