#!/usr/bin/env node
// L8 harness primitive: the verifier owns feature state, the agent does not.
// Runs each feature's verification command; exit 0 -> "passing", else "failing".
// 'blocked' features are human switches and are skipped. Rewrites feature_list.json in place.
//
//   node scripts/verify-features.mjs            # verify all runnable features
//   node scripts/verify-features.mjs F03        # verify one feature
//   node scripts/verify-features.mjs --report   # print state table, run nothing
//
// ponytail: no test-runner abstraction, no watch mode. Add when a second project needs it.

import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const path = join(root, 'feature_list.json')
const doc = JSON.parse(readFileSync(path, 'utf8'))

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
