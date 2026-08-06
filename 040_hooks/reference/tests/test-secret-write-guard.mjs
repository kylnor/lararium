#!/usr/bin/env node
// Corpus for secret-write-guard.js.
//   node 040_hooks/reference/tests/test-secret-write-guard.mjs
//
// The Bash cases are the reason this file exists: the guard was wired to
// Write|Edit only, so `cat > f <<EOF ... EOF` put a credential on disk without
// ever touching the Write tool. A rule that covers one tool instead of the act
// is not a rule.

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const GUARD = join(HERE, '..', 'secret-write-guard.js')

const AWS = 'AKIAIOSFODNN7EXAMPLE'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'

function run(payload) {
  const out = execFileSync('node', [GUARD], {
    input: JSON.stringify(payload), encoding: 'utf8',
  }).trim()
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : null
}

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } })
const write = (file_path, content) => ({ tool_name: 'Write', tool_input: { file_path, content } })
const edit = (file_path, new_string) => ({ tool_name: 'Edit', tool_input: { file_path, new_string } })

const CASES = [
  // ── Shell writes: the gap that Write|Edit-only matching left open ────────
  [bash(`cat > cfg.py <<EOF\nKEY="${AWS}"\nEOF`), 'ask', 'REGRESSION: heredoc shell write'],
  [bash(`echo "${AWS}" > creds.txt`), 'ask', 'REGRESSION: echo redirect'],
  [bash(`printf '%s' "${AWS}" >> creds.txt`), 'ask', 'REGRESSION: printf append'],
  [bash(`echo "${AWS}" | tee creds.txt`), 'ask', 'REGRESSION: piped into tee'],
  [bash(`cat > t.json <<EOF\n{"jwt":"${JWT}"}\nEOF`), 'ask', 'REGRESSION: JWT in a heredoc'],

  // ── Original Write/Edit coverage still intact ────────────────────────────
  [write('/tmp/x.py', `k = "${AWS}"`), 'ask', 'Write with an AWS key'],
  [edit('/tmp/x.py', `k = "${AWS}"`), 'ask', 'Edit with an AWS key'],
  [write('/tmp/x.py', '-----BEGIN RSA PRIVATE KEY-----'), 'ask', 'private key block'],
  [write('/tmp/x.env.sample', `k="${AWS}"`), 'ask', 'env.sample is not .env'],

  // ── Exemptions and quiet cases ───────────────────────────────────────────
  [write('/tmp/.env', `AWS_KEY="${AWS}"`), null, '.env is the sanctioned home'],
  [write('/tmp/.env.local', `AWS_KEY="${AWS}"`), null, '.env.local exempt'],
  [write('/home/u/.claude/hooks/p.js', `re: /${AWS}/`), null, 'the hooks dir defines patterns'],
  [write('/tmp/x.py', 'k = "not a secret"'), null, 'ordinary content'],
  [bash('ls -la'), null, 'a non-write command'],
  [bash('cat README.md'), null, 'a read, not a write'],
  [bash('echo hello > /tmp/greeting.txt'), null, 'a write with no secret in it'],
  [{ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } }, null, 'unrelated tool'],
]

let pass = 0
const failures = []
for (const [payload, expected, label] of CASES) {
  const actual = run(payload)
  if (actual === expected) pass++
  else failures.push({ label, expected, actual })
}
for (const f of failures) {
  console.log(`FAIL  ${f.label}\n      expected: ${f.expected}   actual: ${f.actual}\n`)
}
console.log(`${pass}/${CASES.length} passed${failures.length ? `, ${failures.length} FAILED` : ''}`)
process.exit(failures.length ? 1 : 0)
