#!/usr/bin/env node
// L8 harness primitive: the verifier owns feature state, the agent does not.
// Runs each feature's verification command; exit 0 -> "passing", else "failing".
// 'blocked' features are human switches and are skipped. Rewrites feature_list.json in place.
//
//   node scripts/verify-features.mjs            # verify all runnable features
//   node scripts/verify-features.mjs F03        # verify one feature
//   node scripts/verify-features.mjs --report   # print state table, run nothing
//
// WHAT "MACHINE-OWNED" DOES AND DOES NOT MEAN
//
// It means: an agent cannot write `"state": "passing"` and have it stick. Only
// an exit code sets state, and this file is the only thing that writes it.
// That is a real property and it is worth having.
//
// It does NOT mean the board is trustworthy on its own. The verification
// COMMAND is agent-authored, and it is handed to a shell here. A feature whose
// check is `true` will be green forever. So the board is exactly as honest as
// its weakest check, and reviewing the commands is the part a human still owns.
// Obviously-vacuous checks are warned about at startup; a check that runs the
// wrong test looks identical to one that runs the right test, and no harness
// can tell you which you wrote.
//
// ponytail: no test-runner abstraction, no watch mode. Add when a second project needs it.

import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Repo-relative by design: this file is COPIED into a target repo's scripts/,
// so '..' is that repo's root and feature_list.json sits beside it. Running it
// from the lararium skill directory is a category error, and the raw ENOENT it
// used to throw did not say so.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const path = join(root, 'feature_list.json')

let doc
try {
  doc = JSON.parse(readFileSync(path, 'utf8'))
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(`verify-features: no feature_list.json at ${path}\n`)
    console.error('This script is a template. Copy it into the repo you want to verify:')
    console.error('  <repo>/scripts/verify-features.mjs   <- this file')
    console.error('  <repo>/feature_list.json             <- the board it reads')
    console.error('\nThen run it from that repo: node scripts/verify-features.mjs --report')
    console.error('See SKILL.md step 2 for the feature_list.json shape.')
  } else {
    console.error(`verify-features: could not read ${path}: ${err.message}`)
  }
  process.exit(2)
}

if (!doc || !Array.isArray(doc.features)) {
  console.error(`verify-features: ${path} has no "features" array.`)
  process.exit(2)
}

// The state is machine-owned; the CHECK is not. Nothing stops a feature from
// carrying `"verification": "true"`, which exits 0 forever and paints the board
// green without proving anything. That is the one way this harness lies, and it
// lies in the direction people want to believe, so it is called out loudly
// rather than left for someone to notice.
const VACUOUS = /^\s*(true|:|exit\s+0|echo\b[^|&;]*)\s*$/
const vacuous = doc.features.filter((f) => f.verification && VACUOUS.test(f.verification))
if (vacuous.length) {
  console.error('verify-features: WARNING — these checks cannot fail, so "passing" means nothing:')
  for (const f of vacuous) console.error(`  ${f.id}  ${f.verification}`)
  console.error('  A verification command must be able to return non-zero. Fix these first.\n')
}

const args = process.argv.slice(2)
const reportOnly = args.includes('--report')
const only = args.filter((a) => !a.startsWith('--'))

const table = () =>
  doc.features
    .map((f) => `  ${f.state === 'passing' ? '✓' : f.state === 'blocked' ? '·' : f.state === 'failing' ? '✗' : '○'} ${f.id.padEnd(4)} ${f.state.padEnd(11)} ${f.behavior.slice(0, 64)}`)
    .join('\n')

if (reportOnly) {
  console.log(table())
  const passing = doc.features.filter((f) => f.state === 'passing').length
  const gated = doc.features.filter((f) => f.verification).length
  console.log(`\n${passing}/${gated} verified · ${doc.features.filter((f) => f.state === 'blocked').length} blocked on a human`)
  process.exit(0)
}

let changed = false
for (const f of doc.features) {
  if (only.length && !only.includes(f.id)) continue
  if (f.state === 'blocked' || !f.verification) continue

  f.state = 'active'
  process.stdout.write(`${f.id} … `)
  try {
    execSync(f.verification, { cwd: root, stdio: 'ignore' })
    f.state = 'passing'
    f.evidence = `verified via: ${f.verification}`
    console.log('passing')
  } catch {
    f.state = 'failing'
    f.evidence = `FAILED: ${f.verification}`
    console.log('FAILING')
  }
  changed = true
}

if (changed) writeFileSync(path, JSON.stringify(doc, null, 2) + '\n')
console.log('\n' + table())

const failing = doc.features.filter((f) => f.state === 'failing')
process.exit(failing.length ? 1 : 0)
