#!/usr/bin/env node
/**
 * The satisfaction trend: is the assistant getting better or worse at being
 * useful, measured from what the human said back.
 *
 * Why a separate script from whatever writes the sidecars: this makes no model
 * call and needs no key. Folding it in would mean the trend dying on a missing
 * credential while the evidence it wants is sitting on disk, fully readable.
 * Generation and reading have different failure modes, so they are different
 * programs.
 *
 * THIS ONLY EVER READS TRANSCRIPTS, AND ONLY THEIR MTIME. Nothing here writes
 * to, resumes, or otherwise touches one: session launchers and reapers measure
 * idle age by transcript mtime and kill from that number, so bumping one would
 * make a conversation permanently unreapable and nothing would look wrong.
 *
 *   satisfaction-rollup.mjs           render-ready TSV, see EMIT below
 *   satisfaction-rollup.mjs --json    the whole thing as JSON, for tests
 *
 * Env:
 *   MEASURE_PROJECTS_ROOT    where transcripts live. Defaults to
 *                            ~/.claude/projects, Claude Code's own layout.
 *
 * EMIT (tab separated, fields never contain tabs):
 *   B <name> <exchanges> <praise> <correction> <re-ask> <interrupts>
 *   C <sid> <mtime> <praise> <correction> <re-ask> <label>
 *   R <scored> <satisfied> <dissatisfied> <unclear>
 *   E <text>
 *
 * WHAT IS NOT HERE. The system this came from prints a second table beside the
 * trend: an outcome scoreboard per proactive surface (how many proposals were
 * accepted, dismissed, or rotted unread), read from its task store. That half is
 * not in this template because it would have to assume your schema. The doctrine
 * it implements is in `../rules/MEASUREMENT.md` ("every proactive surface gets
 * outcome accounting, and ROT counts against the producer"), and it is worth
 * building against whatever store you use. The R row below is the other optional
 * half: a model-read residue sidecar, also with no writer here. Both absences
 * print as an E line rather than as a clean empty table, because an empty queue
 * and an unbuilt reader must never look the same.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
// The evidence layer. It is the FLOOR here, not a fallback, so this works with
// no sidecars at all and a stale sidecar can never suppress a verdict the
// transcript still proves.
import { extractExchanges } from './satisfaction.mjs';

const PROJECTS_ROOT = process.env.MEASURE_PROJECTS_ROOT || join(homedir(), '.claude', 'projects');
const SAT_VERSION = 1;           // bump in lockstep with your residue writer
const WINDOW_DAYS = 14;
const BUCKET_DAYS = 7;           // this week against last week
const MIN_HUMAN_TURNS = 2;       // one-shot headless runs are machine work
const WORST_ROWS = 5;

const JSON_OUT = process.argv.slice(2).includes('--json');

// Piping this into `head` closes the pipe mid-write, and an unhandled EPIPE
// turns that ordinary shell move into a stack trace. Exit quietly instead.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

/** Same strictness as loadLoops() next door: model output written beside files
 * that concurrent sessions append to, so truncated, hand-edited, empty and
 * future-version files are all expected. Any of them returns null and the
 * session simply loses its residue rather than taking the run down. */
function loadSat(path) {
  let d;
  try { d = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (d.v !== SAT_VERSION) return null;
  const r = d.residue;
  if (!r || typeof r !== 'object') return null;
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  return { satisfied: n(r.satisfied), dissatisfied: n(r.dissatisfied), unclear: n(r.unclear), scored: n(r.scored) };
}

function readLabel(path) {
  try { return readFileSync(path, 'utf8').trim().slice(0, 300) || null; } catch { return null; }
}

/** One pass over the projects tree collecting transcripts and their sidecars. */
function collect() {
  const byId = new Map();
  const entry = (sid) => {
    if (!byId.has(sid)) byId.set(sid, { sid, jsonl: null, mtime: 0, residue: null, label: null });
    return byId.get(sid);
  };

  let dirs;
  // A missing projects root is a normal first-run state, not a crash. It is
  // reported as a note rather than rendering as a clean empty report.
  try { dirs = readdirSync(PROJECTS_ROOT); } catch { return { sessions: [], rootMissing: true }; }
  for (const dir of dirs) {
    const full = join(PROJECTS_ROOT, dir);
    let st; try { st = statSync(full); } catch { continue; }
    if (!st.isDirectory()) continue;
    let files; try { files = readdirSync(full); } catch { continue; }
    for (const f of files) {
      const path = join(full, f);
      if (f.endsWith('.jsonl')) {
        let s; try { s = statSync(path); } catch { continue; }
        const e = entry(f.slice(0, -'.jsonl'.length));
        // A session id can appear under two project dirs. Keep the newest.
        if (s.mtimeMs / 1000 > e.mtime) { e.mtime = s.mtimeMs / 1000; e.jsonl = path; }
      } else if (f.endsWith('.sat.json')) {
        entry(f.slice(0, -'.sat.json'.length)).residue = loadSat(path);
      } else if (f.endsWith('.label')) {
        entry(f.slice(0, -'.label'.length)).label = readLabel(path);
      }
    }
  }

  const cutoff = Date.now() / 1000 - WINDOW_DAYS * 86400;
  const out = [];
  for (const e of [...byId.values()].filter((x) => x.jsonl && x.mtime >= cutoff)) {
    const ev = extractExchanges(e.jsonl);
    if (ev.error) continue;
    // A one-shot headless run is machine work, not a conversation, and counting
    // its unanswered reply as an abandonment buries the real ones: ungated, 435
    // of 466 verdicts on a real window were "abandoned" machine runs and the
    // number said nothing at all.
    if (ev.humanTurns < MIN_HUMAN_TURNS) continue;
    const all = ev.trailing ? [...ev.exchanges, ev.trailing] : ev.exchanges;
    const counts = { correction: 0, praise: 0, 're-ask': 0, neutral: 0, abandoned: 0, pending: 0 };
    for (const x of all) counts[x.verdict] += 1;
    out.push({ ...e, ev, all, counts });
  }
  return { sessions: out.sort((a, b) => b.mtime - a.mtime), rootMissing: false };
}

function emptyCounts() {
  return { exchanges: 0, praise: 0, correction: 0, 're-ask': 0, neutral: 0, abandoned: 0, interrupts: 0 };
}

/**
 * `abandoned` is deliberately NOT on the trend line.
 *
 * It was 32 of 36 conversations on a real window and dominated every other
 * number on the row, but it is not a satisfaction signal: it is the count of
 * conversations nobody came back to, which is the cold-session count
 * `open-loops.mjs` already reports and reports better. Leaving it here made the
 * trend look catastrophic every week regardless of how the replies actually
 * went. Kept in the JSON, kept per session, off the row a human reads as a
 * verdict.
 */
function addExchange(acc, x) {
  if (x.verdict !== 'abandoned' && x.verdict !== 'pending') acc.exchanges += 1;
  if (acc[x.verdict] !== undefined) acc[x.verdict] += 1;
}

function main() {
  const { sessions, rootMissing } = collect();
  const now = Date.now() / 1000;

  // Two buckets rather than a daily series. At ordinary volume (a few hundred
  // exchanges over 14 days) a per-day line is mostly noise, and the question a
  // trend answers is "better or worse than last week", which two buckets answer
  // honestly.
  const buckets = [
    { name: `last-${BUCKET_DAYS}d`, ...emptyCounts() },
    { name: `prior-${BUCKET_DAYS}d`, ...emptyCounts() },
  ];
  const residue = { scored: 0, satisfied: 0, dissatisfied: 0, unclear: 0 };
  let withResidue = 0;

  for (const s of sessions) {
    // Bucket each exchange by its OWN timestamp. A conversation resumed today
    // carries today's mtime for every exchange in it, so bucketing by session
    // collapsed the whole window into "last 7 days" and the prior bucket read
    // zero on a fortnight of real work.
    for (const x of s.all) {
      const stamp = x.at || s.mtime;
      const age = (now - stamp) / 86400;
      addExchange(buckets[age <= BUCKET_DAYS ? 0 : 1], x);
    }
    buckets[(now - s.mtime) / 86400 <= BUCKET_DAYS ? 0 : 1].interrupts += s.ev.interrupts;
    if (s.residue) {
      withResidue += 1;
      residue.scored += s.residue.scored;
      residue.satisfied += s.residue.satisfied;
      residue.dissatisfied += s.residue.dissatisfied;
      residue.unclear += s.residue.unclear;
    }
  }

  // The conversations that cost the most, worst first. Corrections rank above
  // re-asks because a correction is the human saying so; a re-ask is inferred.
  const worst = sessions
    .filter((s) => s.counts.correction || s.counts['re-ask'])
    .sort((a, b) =>
      (b.counts.correction - a.counts.correction) ||
      (b.counts['re-ask'] - a.counts['re-ask']) || (b.mtime - a.mtime))
    .slice(0, WORST_ROWS);

  const notes = [];
  if (rootMissing) {
    notes.push(`no transcripts: ${PROJECTS_ROOT} does not exist (set MEASURE_PROJECTS_ROOT)`);
  } else if (!sessions.length) {
    notes.push(`no conversations in the last ${WINDOW_DAYS} days under ${PROJECTS_ROOT}`);
  }
  if (sessions.length && !withResidue) {
    notes.push('no residue row: nothing writes .sat.json sidecars in this template (see measure/README.md)');
  }

  return { sessions, buckets, residue, withResidue, worst, notes };
}

const { sessions, buckets, residue, withResidue, worst, notes } = main();

if (JSON_OUT) {
  console.log(JSON.stringify({
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    projects_root: PROJECTS_ROOT,
    conversations: sessions.length,
    buckets,
    residue: withResidue ? { ...residue, sessions: withResidue } : null,
    notes,
    worst: worst.map((s) => ({
      session_id: s.sid, mtime: Math.floor(s.mtime), label: s.label,
      praise: s.counts.praise, correction: s.counts.correction, 're-ask': s.counts['re-ask'],
    })),
  }, null, 2));
} else {
  const row = (...f) => process.stdout.write(f.join('\t') + '\n');
  for (const b of buckets) {
    row('B', b.name, b.exchanges, b.praise, b.correction, b['re-ask'], b.interrupts);
  }
  if (withResidue) row('R', residue.scored, residue.satisfied, residue.dissatisfied, residue.unclear);
  for (const s of worst) {
    row('C', s.sid, Math.floor(s.mtime), s.counts.praise, s.counts.correction,
      s.counts['re-ask'], s.label || '(no label)');
  }
  for (const n of notes) row('E', n);
}
