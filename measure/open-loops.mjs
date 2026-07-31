#!/usr/bin/env node
/**
 * What did each conversation leave unfinished, and which subjects have been
 * started more than once.
 *
 * Two questions a session list cannot answer. The list knows what exists; this
 * knows what is still hanging. An unfinished thread is not a fact, so a memory
 * pipeline built to extract facts throws it away, and a repeated intent is
 * signal precisely BECAUSE it repeats, which is the one thing a deduplicating
 * pipeline is built to suppress. That is why this is a separate organ.
 *
 * THIS ONLY EVER READS TRANSCRIPTS, AND THAT IS LOAD-BEARING. Nothing here
 * writes to, resumes, or otherwise touches one: session launchers and reapers
 * measure idle age by transcript mtime and kill from that number, so bumping one
 * would make a conversation permanently unreapable and nothing would look wrong.
 * The failure is silent, which is why it is stated in every file that opens a
 * transcript.
 *
 *   open-loops.mjs           render-ready TSV, see EMIT below
 *   open-loops.mjs --json    the whole thing as JSON, for tests
 *
 * Env:
 *   MEASURE_PROJECTS_ROOT    where transcripts live. Defaults to
 *                            ~/.claude/projects, Claude Code's own layout.
 *
 * EMIT (tab separated, fields never contain tabs: slugs are [a-z0-9-] only and
 * every free-text field is whitespace-collapsed before it is written):
 *   C <name> <count>                              a repeated subject
 *   M <sid> <mtime> <label>                       one member of the cluster above
 *   L <sid> <mtime> <label> <next_move> <health>  an unfinished thread
 *   O <text>                                      one open loop of the L above
 *   E <text>                                      a note about missing inputs
 *
 * THE SIDECAR HALF HAS NO WRITER IN THIS TEMPLATE, on purpose, and the E line
 * above exists so that absence is never silent. The evidence floor below (health,
 * finished, structural open loops) is computed from tool calls and needs nothing
 * but the filesystem, so the unfinished-thread half works the moment you clone
 * this. Clustering needs topic slugs, and topics come from a model pass you have
 * not built yet. Its contract is in `README.md`; write a sidecar that matches and
 * clustering lights up with no change here.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
// The evidence layer: health, finished, and the structural open loops, all
// derived from tool calls at zero cost. It is the FLOOR here, not a fallback,
// so this command works with no sidecars at all and a stale sidecar can never
// suppress a loop the transcript still proves.
import { report } from './trajectory.mjs';

const PROJECTS_ROOT = process.env.MEASURE_PROJECTS_ROOT || join(homedir(), '.claude', 'projects');
const LOOPS_VERSION = 1;         // bump in lockstep with your sidecar writer
const MAX_AGE_DAYS = 14;
const MIN_TOKEN_LEN = 3;
const MIN_CLUSTER = 2;           // one conversation about a subject is not a repeat
const MIN_HUMAN_TURNS = 2;       // a one-shot headless run is machine work, not a
                                 // conversation. Without this gate a real corpus put
                                 // 392 transcripts in the list of which about 39 were
                                 // things a human actually said.
const MAX_TOKEN_SHARE = 0.4;     // see tooCommon()

const JSON_OUT = process.argv.slice(2).includes('--json');

// Words that name a category rather than a subject.
//
// The second group is the one that earns its keep, and it was measured, not
// guessed. On a real 34-conversation window the rollup's top four rows came
// back "system (11)", "data (7)", "management (7)", "infrastructure (6)": every
// one a bucket that half the machine falls into, sorting straight to the top and
// burying the two-conversation cluster that was the entire point of the report.
// These are how a model hedges when asked to name a subject, so they are dropped
// before clustering. Measured on that window: 41 clusters down to 26, and the
// top of the list becomes real subjects.
//
// tooCommon() below is still the backstop for whatever the list misses.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'this', 'that',
  'new', 'old', 'via', 'per', 'misc', 'general', 'stuff', 'thing', 'things',

  'system', 'systems', 'data', 'management', 'infrastructure', 'configuration',
  'analysis', 'development', 'integration', 'optimization', 'delivery',
  'automation', 'pipeline', 'tracking', 'engine', 'platform', 'workflow',
  'tool', 'tools', 'setup', 'update', 'updates', 'review', 'work',
]);

/**
 * Validate a `.loops.json` sidecar, or return null.
 *
 * Strict on purpose. These are model output written next to files that
 * concurrent sessions are appending to, so truncated, hand-edited, empty, and
 * future-version files are all expected. Any of them returns null and the
 * session simply loses its sidecar, rather than taking the run down. This is the
 * schema-validate-or-discard rule: never partially trust a shape you did not get.
 *
 * session_id is never read from the file. It comes from the filename.
 */
function loadLoops(path) {
  let d;
  try { d = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (d.v !== LOOPS_VERSION) return null;

  const open_loops = (Array.isArray(d.open_loops) ? d.open_loops : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim().slice(0, 120))
    .slice(0, 3);

  const topics = (Array.isArray(d.topics) ? d.topics : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim().toLowerCase().slice(0, 40))
    .slice(0, 4);

  const next_move = typeof d.next_move === 'string' && d.next_move.trim()
    ? d.next_move.trim().slice(0, 200)
    : null;

  return { open_loops, topics, next_move, finished: d.finished === true };
}

function readLabel(path) {
  try { return readFileSync(path, 'utf8').trim().slice(0, 300) || null; } catch { return null; }
}

/** One pass over the projects tree collecting transcripts and their sidecars. */
function collect() {
  const byId = new Map();
  const entry = (sid) => {
    if (!byId.has(sid)) byId.set(sid, { sid, jsonl: null, mtime: 0, loops: null, label: null });
    return byId.get(sid);
  };

  let dirs;
  // A missing projects root is a normal first-run state, not a crash. It is
  // reported as a note below rather than rendering as a clean empty report.
  try { dirs = readdirSync(PROJECTS_ROOT); } catch { return { sessions: [], rootMissing: true, sidecars: 0 }; }
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
      } else if (f.endsWith('.loops.json')) {
        entry(f.slice(0, -'.loops.json'.length)).loops = loadLoops(path);
      } else if (f.endsWith('.label')) {
        entry(f.slice(0, -'.label'.length)).label = readLabel(path);
      }
    }
  }

  const cutoff = Date.now() / 1000 - MAX_AGE_DAYS * 86400;
  const live = [...byId.values()]
    .filter((e) => e.jsonl && e.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime);

  // Merge evidence over each sidecar. A session with no sidecar still gets
  // health, finished, and its structural loops; it simply has no topics, so it
  // cannot cluster. A session WITH a sidecar has its finished and health
  // replaced by the derived values and its structural loops put back at the
  // front, because a sidecar asked a model those questions and this is where
  // that answer stops being trusted.
  const out = [];
  let sidecars = 0;
  for (const e of live) {
    const ev = report(e.jsonl);
    if (ev.error) continue;
    if (ev.signals.humanTurns < MIN_HUMAN_TURNS) continue;
    const model = e.loops ?? { open_loops: [], topics: [], next_move: null };
    const merged = [...ev.structuralLoops];
    for (const l of model.open_loops) if (!merged.includes(l)) merged.push(l);
    if (e.loops) sidecars += 1;
    e.loops = {
      open_loops: merged,
      topics: model.topics,
      next_move: model.next_move,
      finished: ev.finished,
      health: ev.health,
      hasSidecar: Boolean(e.loops),
    };
    out.push(e);
  }
  return { sessions: out, rootMissing: false, sidecars };
}

/** Words inside a session's topic slugs, which is what clustering joins on.
 *
 * Exact slug equality does not work, and that is not a tuning detail: the two
 * conversations this was built for produced "claude-launcher" and
 * "conversation-launcher" for the same subject. A model naming a thing freely
 * agrees on the words far more often than on the whole phrase, so the join key
 * is the word.
 */
function tokensOf(session) {
  const out = new Set();
  for (const topic of session.loops.topics) {
    for (const w of topic.split('-')) {
      if (w.length >= MIN_TOKEN_LEN && !STOPWORDS.has(w)) out.add(w);
    }
  }
  return out;
}

/** A token most of the window carries is a house style, not a subject.
 *
 * Every tree has two or three words that everything in it is about (the
 * assistant's name, "script", the main repo). Those would cluster the entire
 * backlog into one useless heap that sorts to the top. This is measured against
 * the actual window rather than kept as a word list, so it keeps working when
 * the vocabulary moves.
 */
function tooCommon(count, total) {
  return total >= 5 && count > total * MAX_TOKEN_SHARE;
}

function cluster(sessions) {
  const byToken = new Map();
  for (const s of sessions) {
    for (const t of tokensOf(s)) {
      if (!byToken.has(t)) byToken.set(t, []);
      byToken.get(t).push(s);
    }
  }

  // Group tokens that select exactly the same conversations. Four tokens all
  // pointing at the same two sessions is one repeated subject, not four.
  const merged = new Map();
  for (const [token, members] of byToken) {
    if (members.length < MIN_CLUSTER) continue;
    if (tooCommon(members.length, sessions.length)) continue;
    const key = members.map((m) => m.sid).sort().join(' ');
    if (!merged.has(key)) merged.set(key, { tokens: [], members });
    merged.get(key).tokens.push(token);
  }

  return [...merged.values()]
    .map((c) => ({
      name: c.tokens.sort().join(', '),
      count: c.members.length,
      newest: Math.max(...c.members.map((m) => m.mtime)),
      // Newest first inside a cluster: the most recent restatement of an idea
      // is the one worth reopening.
      members: [...c.members].sort((a, b) => b.mtime - a.mtime),
    }))
    .sort((a, b) => b.count - a.count || b.newest - a.newest);
}

/**
 * Notes about missing inputs.
 *
 * A working state and a broken state must never produce the same observable. An
 * empty cluster list because nothing repeated and an empty cluster list because
 * no sidecar writer exists are different answers, and without this line they
 * print identically.
 */
function notes({ rootMissing, sidecars }, sessions, clusters) {
  const out = [];
  if (rootMissing) {
    out.push(`no transcripts: ${PROJECTS_ROOT} does not exist (set MEASURE_PROJECTS_ROOT)`);
    return out;
  }
  if (!sessions.length) out.push(`no conversations in the last ${MAX_AGE_DAYS} days under ${PROJECTS_ROOT}`);
  if (sessions.length && !sidecars && !clusters.length) {
    out.push('clusters empty because no .loops.json sidecar exists, not because nothing repeated (see measure/README.md)');
  }
  return out;
}

function main() {
  const collected = collect();
  const sessions = collected.sessions;
  const clusters = cluster(sessions);
  const unfinished = sessions.filter((s) => !s.loops.finished || s.loops.open_loops.length);
  const note = notes(collected, sessions, clusters);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      projects_root: PROJECTS_ROOT,
      sessions: sessions.length,
      sidecars: collected.sidecars,
      notes: note,
      clusters: clusters.map((c) => ({
        name: c.name, count: c.count, members: c.members.map((m) => m.sid),
      })),
      unfinished: unfinished.map((s) => ({
        session_id: s.sid, mtime: Math.floor(s.mtime), label: s.label,
        health: s.loops.health, has_sidecar: s.loops.hasSidecar,
        next_move: s.loops.next_move, open_loops: s.loops.open_loops,
      })),
    }, null, 2));
    return;
  }

  const row = (...f) => process.stdout.write(f.join('\t') + '\n');
  for (const c of clusters) {
    row('C', c.name, c.count);
    for (const m of c.members) row('M', m.sid, Math.floor(m.mtime), m.label || '(no label)');
  }
  for (const s of unfinished) {
    row('L', s.sid, Math.floor(s.mtime), s.label || '(no label)', s.loops.next_move || '', s.loops.health);
    for (const l of s.loops.open_loops) row('O', l);
  }
  for (const n of note) row('E', n);
}

main();
