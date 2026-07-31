#!/usr/bin/env node
/**
 * Deterministic trajectory evidence from an assistant transcript.
 *
 * What a session DID, recovered from its tool calls, with no model call and no
 * spend. Ported from the detector design in codejunkie99/sageroute (MIT), whose
 * one load-bearing idea is worth restating: a model's own narration is not
 * evidence. "I've got this now" for the fifth time proves nothing. A command
 * that exited zero proves something.
 *
 * READ-ONLY, AND THAT IS LOAD-BEARING. This opens transcripts and never writes
 * to them, never resumes them, never touches their mtime. Session launchers and
 * reapers measure idle age by transcript mtime and decide what to kill from that
 * number, so a process that bumped mtime would make every session look freshly
 * active and permanently unreapable. It fails silently: everything looks healthy
 * and nothing is ever reaped. If you extend this file, extend it read-only.
 *
 *   trajectory.mjs <transcript.jsonl>            human-readable report
 *   trajectory.mjs --json <transcript.jsonl>     machine-readable
 *   trajectory.mjs --json <a.jsonl> <b.jsonl>    one JSON object per line
 *
 * Zero dependencies on purpose, so this can move anywhere on the machine that a
 * consumer wants it without dragging a package tree behind it.
 *
 * Transcript shape assumed: JSONL, one row per event, rows carrying
 * `type: "user" | "assistant"`, a `message.content` string or block array, and
 * `tool_use` / `tool_result` blocks paired by `tool_use_id`. That is Claude
 * Code's format. If your assistant writes something else, this file is the only
 * one that has to learn it: everything downstream reads the derived shape.
 */

import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Tools that change the workspace. A write is not progress; see PROGRESS below.
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Tools that actually verify something. This is the only source of real progress.
const EXEC_TOOLS = new Set(['Bash', 'BashOutput']);

const RECENT_WINDOW = 6;
const REPEAT_ACTION_OBS_THRESHOLD = 3;
const REPEAT_ERROR_CLASS_THRESHOLD = 3;
const PING_PONG_THRESHOLD = 4;

/**
 * Loop detection runs over a trailing window, not the whole transcript, and
 * this is the one place the port had to diverge from its source.
 *
 * SageRoute's unit of work is a single bounded task, so a lifetime counter is
 * a fair reading of it. An assistant transcript is a whole workday: 25 real
 * transcripts measured here ran to 317 tool calls across hours and many
 * unrelated tasks. Over that span every lifetime counter saturates. Three
 * GenericErrors in a row at minute 40 of a session that recovered and finished
 * clean would flag it as thrashing forever after.
 *
 * The question a consumer actually asks is "which conversations did I abandon
 * mid-fight", which is a question about the END of a transcript.
 */
const LOOP_WINDOW = 12;
const PREVIEW_CHARS = 220;
const DIGEST_CHARS = 12;

/**
 * Text markers that mean a tool result failed even when is_error is absent.
 *
 * The harness sets is_error for a tool that threw, but a shell call that runs
 * the test suite and gets "3 failed" is a successful tool call reporting a
 * failed command. That distinction is exactly the one this module exists to
 * make, so the explicit flag is trusted first and the text is only sniffed
 * after.
 */
const FAILURE_MARKERS = [
  'traceback (most recent call last)',
  'error:',
  'error ',
  'exception',
  'failed',
  'failing',
  'no such file',
  'command not found',
  'permission denied',
  'timed out',
  'exit code 1',
  'exit code 2',
  'assertionerror',
  'syntaxerror',
  'cannot find module',
  'fatal:',
];

/**
 * Results that are governance, not failure.
 *
 * The harness sets is_error on a permission denial exactly as it does on a
 * crash, so without this every rule in a serious deny/ask permission list scores
 * as the agent breaking. Measured on 30 real transcripts, permission denials
 * were the single largest is_error category, well ahead of any real error.
 *
 * These are counted separately and excluded from failure math, because a
 * session that stopped because it was not allowed to act is a different open
 * loop from one that stopped because it could not solve the problem, and the
 * two want different responses from the owner.
 */
const BLOCKED_MARKERS = [
  'permission for this action was denied',
  "the user doesn't want to proceed",
  'the tool use was rejected',
  'user rejected',
  'requested permissions',
];

/** Specific classes first; the generic catch-alls must stay last. */
const ERROR_CLASSES = [
  ['modulenotfounderror', 'ModuleNotFoundError'],
  ['importerror', 'ImportError'],
  ['syntaxerror', 'SyntaxError'],
  ['indentationerror', 'IndentationError'],
  ['nameerror', 'NameError'],
  ['typeerror', 'TypeError'],
  ['valueerror', 'ValueError'],
  ['attributeerror', 'AttributeError'],
  ['keyerror', 'KeyError'],
  ['indexerror', 'IndexError'],
  ['assertionerror', 'AssertionError'],
  ['segmentation fault', 'SegFault'],
  ['no such file', 'FileNotFound'],
  ['cannot find module', 'ModuleNotFoundError'],
  ['command not found', 'CommandNotFound'],
  ['permission denied', 'PermissionDenied'],
  ['timed out', 'Timeout'],
  ['connection refused', 'ConnectionRefused'],
  ['merge conflict', 'MergeConflict'],
  ['fatal:', 'GitFatal'],
  ['traceback (most recent call last)', 'PythonTraceback'],
  ['exit code 1', 'NonZeroExit'],
  ['exit code 2', 'NonZeroExit'],
  ['test failed', 'TestFailure'],
  ['tests failed', 'TestFailure'],
  ['failing', 'TestFailure'],
  ['failed', 'GenericFailure'],
  ['error', 'GenericError'],
];

function looksLikeFailure(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return FAILURE_MARKERS.some((marker) => lower.includes(marker));
}

function looksBlocked(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return BLOCKED_MARKERS.some((marker) => lower.includes(marker));
}

function classifyError(text) {
  if (!text) return 'Unknown';
  const lower = text.toLowerCase();
  for (const [needle, name] of ERROR_CLASSES) {
    if (lower.includes(needle)) return name;
  }
  return 'Unknown';
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, DIGEST_CHARS);
}

function preview(text, cap = PREVIEW_CHARS) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
}

/** tool_result content is a string on some turns and a block array on others. */
function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (typeof block === 'string') parts.push(block);
    else if (block && typeof block === 'object' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

/**
 * What the owner actually typed, with the harness's own wrapping removed.
 *
 * The harness prepends system-reminder blocks carrying your global rules file
 * and hook output to real user turns. Counting those as the goal would describe
 * the global instructions instead of the request. A real deployment hit this
 * live and it routed every session on a description of the user's config. The
 * envelopes are several: system-reminders carrying rules and hook output, the
 * local-command caveat, and slash-command name/args tags. All of them sit in
 * FRONT of what the owner actually typed, so a goal taken naively describes the
 * harness instead of the request.
 *
 * Exported because the satisfaction layer asks a harder question of the same
 * text (what did the owner say BACK), and two definitions of "what he typed"
 * would drift apart silently. Anything stricter than this list belongs to the
 * caller: this is the shared floor, not the whole cleaning any one consumer
 * wants.
 */
export function stripHarnessEnvelopes(text) {
  return String(text ?? '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-[a-z-]+>[\s\S]*?<\/local-command-[a-z-]+>/g, '')
    .replace(/<command-(?:message|name|args)>[\s\S]*?<\/command-(?:message|name|args)>/g, '')
    .replace(/<[a-z-]*caveat[a-z-]*>[\s\S]*?<\/[a-z-]*caveat[a-z-]*>/g, '')
    .trim();
}

/**
 * Recover the ordered action sequence from a transcript.
 *
 * Sidechain rows are a dispatched subagent's own conversation, inlined into the
 * parent file. They are excluded by default because a subagent thrashing inside
 * its own context is a different agent's trajectory, and folding it in would
 * make one bad search call look like the main session flailing.
 */
export function extractTrajectory(path, { includeSidechains = false } = {}) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    return { steps: [], pendingCalls: [], goal: '', humanTurns: 0, assistantTurns: 0, lines: 0, error: String(err.message ?? err) };
  }

  const calls = new Map();   // tool_use_id -> partial step
  const order = [];
  let goal = '';
  let humanTurns = 0;
  let assistantTurns = 0;
  let lines = 0;
  let lastEventType = '';

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    lines += 1;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      // Concurrent sessions write transcripts while this runs, so the final line
      // of a live file is routinely a half-written row. Skip it, do not die.
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    if (row.isSidechain && !includeSidechains) continue;

    const type = row.type;
    if (type === 'user' || type === 'assistant') lastEventType = type;

    const message = row.message;
    const content = message?.content;

    if (type === 'user') {
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
          : '';
      const cleaned = stripHarnessEnvelopes(text);
      if (cleaned) {
        humanTurns += 1;
        if (!goal) goal = preview(cleaned, 600);
      }
    }

    if (type === 'assistant') assistantTurns += 1;

    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;

      if (block.type === 'tool_use') {
        const tool = typeof block.name === 'string' ? block.name : 'unknown';
        const args = JSON.stringify(block.input ?? {});
        const step = {
          index: order.length + 1,
          tool,
          argsDigest: digest(`${tool}|${args}`),
          argsPreview: preview(args, 120),
          outputDigest: '',
          outputPreview: '',
          ok: null,
          blocked: false,
          errorClass: '',
        };
        order.push(step);
        if (typeof block.id === 'string') calls.set(block.id, step);
      }

      if (block.type === 'tool_result') {
        const step = calls.get(block.tool_use_id);
        if (!step) continue;
        const text = resultText(block.content);
        step.outputDigest = digest(text);
        step.outputPreview = preview(text);
        // Explicit flag first, text sniff only as a fallback. A shell call that
        // succeeds while the command it ran fails is the case that matters.
        step.blocked = looksBlocked(text);
        step.ok = block.is_error === true ? false : !looksLikeFailure(text);
        step.errorClass = step.blocked ? 'Blocked' : step.ok ? '' : classifyError(text);
      }
    }
  }

  const steps = order.filter((s) => s.ok !== null);
  const pendingCalls = order.filter((s) => s.ok === null);
  let mtime = 0;
  try { mtime = Math.floor(statSync(path).mtimeMs / 1000); } catch { /* reported as 0 */ }

  return { steps, pendingCalls, goal, humanTurns, assistantTurns, lines, lastEventType, mtime };
}

/**
 * Derive the deterministic signals. Answered steps only: a pending call has
 * produced no observation, so it is not yet success, failure, or a loop.
 */
export function computeSignals(trajectory) {
  const steps = trajectory.steps;
  // A blocked call is neither success nor failure. It never happened, because
  // the owner did not let it, so it must not move any counter that measures
  // whether the agent can solve the problem.
  const isFail = (s) => !s.ok && !s.blocked;
  const failures = steps.filter(isFail);
  const blocked = steps.filter((s) => s.blocked);
  const recent = steps.slice(-RECENT_WINDOW).filter((s) => !s.blocked);
  const execSteps = steps.filter((s) => EXEC_TOOLS.has(s.tool) && !s.blocked);

  // PROGRESS is a successful execution, never a file write. This is the whole
  // trick. A naive counter that resets on each write lets an agent rewrite,
  // fail, rewrite, fail forever while looking healthy, because every rewrite
  // resets the clock.
  let stepsSinceProgress = 0;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (EXEC_TOOLS.has(steps[i].tool) && steps[i].ok) break;
    if (steps[i].blocked) continue;
    stepsSinceProgress += 1;
  }

  let consecutiveFailedVerifications = 0;
  for (let i = execSteps.length - 1; i >= 0; i -= 1) {
    if (execSteps[i].ok) break;
    consecutiveFailedVerifications += 1;
  }

  // Catches the agent that rewrites the file DIFFERENTLY every time. It never
  // repeats an identical action, so plain loop detection stays silent while it
  // burns the whole budget. write -> failed exec -> write -> failed exec.
  //
  // Counted twice on purpose. Lifetime is a description of the whole session
  // and says almost nothing (a long healthy day of work reaches 21). Recent is
  // the one health reads, because it answers whether the thrash is happening
  // now or was a rough patch three hours ago that resolved.
  const countCycles = (window) => {
    let cycles = 0;
    let armed = false;
    for (const step of window) {
      if (step.blocked) continue;
      if (WRITE_TOOLS.has(step.tool) && step.ok) armed = true;
      else if (armed && EXEC_TOOLS.has(step.tool) && !step.ok) { cycles += 1; armed = false; }
    }
    return cycles;
  };
  const rewriteRetestCycles = countCycles(steps);
  const recentRewriteRetestCycles = countCycles(steps.slice(-LOOP_WINDOW));

  const lastExec = execSteps.length ? execSteps[execSteps.length - 1] : null;
  const errorClasses = [...new Set(failures.map((s) => s.errorClass).filter(Boolean))].sort();

  return {
    toolCalls: steps.length,
    toolErrors: failures.length,
    blockedCalls: blocked.length,
    pendingCalls: trajectory.pendingCalls.length,
    recentErrorRate: recent.length ? recent.filter(isFail).length / recent.length : 0,
    distinctErrorClasses: errorClasses,
    lastErrorPreview: failures.length ? failures[failures.length - 1].outputPreview : '',
    filesTouched: new Set(steps.filter((s) => WRITE_TOOLS.has(s.tool) && s.ok).map((s) => s.argsDigest)).size,
    verificationsRun: execSteps.length,
    failedVerifications: execSteps.filter((s) => !s.ok).length,
    consecutiveFailedVerifications,
    lastVerificationPassed: lastExec ? lastExec.ok : null,
    rewriteRetestCycles,
    recentRewriteRetestCycles,
    stepsSinceProgress,
    humanTurns: trajectory.humanTurns,
    assistantTurns: trajectory.assistantTurns,
    recentActions: steps.slice(-RECENT_WINDOW)
      .map((s) => `${s.tool}(${preview(s.argsPreview, 40)})->${s.blocked ? 'blocked' : s.ok ? 'ok' : s.errorClass}`),
    // Blocked calls are excluded from loop detection too. An agent retrying
    // something it is not permitted to do is a permission problem to surface,
    // never evidence that it cannot reason.
    ...detectLoops(steps.filter((s) => !s.blocked).slice(-LOOP_WINDOW)),
    trailingBlocked: (() => {
      let n = 0;
      for (let i = steps.length - 1; i >= 0 && steps[i].blocked; i -= 1) n += 1;
      return n;
    })(),
  };
}

function detectLoops(steps) {
  const kinds = [];

  const keyOf = (s) => `${s.tool}|${s.argsDigest}`;
  const fullKeyOf = (s) => `${s.tool}|${s.argsDigest}|${s.outputDigest}`;

  // Same call, same result, three times running: the agent has stopped learning.
  //
  // Restricted to FAILING steps, which the source design did not do. When the
  // repeated call succeeds every time the agent is getting what it asked for:
  // re-reading a file, polling a job, checking a log. That is ordinary work,
  // not a wall, and counting it flagged healthy sessions here.
  let run = 1;
  for (let i = 1; i < steps.length; i += 1) {
    run = fullKeyOf(steps[i]) === fullKeyOf(steps[i - 1]) ? run + 1 : 1;
    if (run >= REPEAT_ACTION_OBS_THRESHOLD && !steps[i].ok) { kinds.push('action_observation_repeat'); break; }
  }

  // Same failure class back to back: stuck on one wall even if the text moves.
  let errRun = 0;
  let lastClass = '';
  for (const step of steps) {
    if (!step.ok && step.errorClass && step.errorClass === lastClass) errRun += 1;
    else errRun = step.ok ? 0 : 1;
    lastClass = step.ok ? '' : step.errorClass;
    if (errRun >= REPEAT_ERROR_CLASS_THRESHOLD) { kinds.push('repeated_error_class'); break; }
  }

  // Oscillating between two wrong fixes.
  const tail = steps.slice(-PING_PONG_THRESHOLD * 2).map(keyOf);
  if (tail.length >= PING_PONG_THRESHOLD && new Set(tail).size === 2) {
    let alternating = true;
    for (let i = 1; i < tail.length; i += 1) if (tail[i] === tail[i - 1]) { alternating = false; break; }
    if (alternating) kinds.push('ping_pong');
  }

  return { loopDetected: kinds.length > 0, loopKinds: kinds };
}

/**
 * The two questions a consumer actually wants answered, derived rather than
 * asked. A model can be paid to narrate these; it should not have to be.
 *
 * `finished` is deliberately conservative. It claims a clean end only when
 * nothing is dangling and the last verification did not fail, because the cost
 * of wrongly calling a session finished is that it drops out of the rollup and
 * the owner never sees it again.
 */
export function deriveState(trajectory, signals) {
  const structuralLoops = [];

  // The most literal open loop there is: the owner spoke last and nothing came
  // back. Measured across 25 real transcripts this was the single most common
  // reason a conversation was unfinished, it needs no model to see, and it
  // cannot be wrong. A dropped connection, a killed pane, and a question that
  // never got an answer all land here.
  if (trajectory.lastEventType === 'user') {
    structuralLoops.push('ended on your turn, no reply recorded');
  }
  for (const call of trajectory.pendingCalls) {
    structuralLoops.push(`${call.tool} call issued, no result recorded`);
  }
  if (signals.consecutiveFailedVerifications >= 2) {
    structuralLoops.push(
      `${signals.consecutiveFailedVerifications} failed checks in a row, last: ${preview(signals.lastErrorPreview, 80)}`,
    );
  }
  if (signals.loopDetected) {
    structuralLoops.push(`stuck: ${signals.loopKinds.join(', ')}`);
  }
  if (signals.stepsSinceProgress >= 8 && signals.verificationsRun > 0) {
    structuralLoops.push(`${signals.stepsSinceProgress} actions since anything last passed`);
  }
  if (signals.recentRewriteRetestCycles >= 2) {
    structuralLoops.push(`${signals.recentRewriteRetestCycles} rewrite and retest cycles with no pass`);
  }
  if (signals.trailingBlocked > 0) {
    structuralLoops.push('stopped on a permission you denied, waiting on you');
  }

  const finished =
    trajectory.pendingCalls.length === 0 &&
    signals.lastVerificationPassed !== false &&
    !signals.loopDetected &&
    trajectory.lastEventType === 'assistant';

  // Health is one word a human can scan 30 rows of.
  //
  // Every input here is a TRAILING signal, never a lifetime count. The question
  // is what state the conversation was in when it stopped, not whether it ever
  // had a bad hour. A lifetime reading marked 15 of 25 real sessions
  // "struggling", which is the same as marking none of them.
  let health = 'ok';
  if (signals.trailingBlocked > 0) health = 'blocked';
  else if (signals.loopDetected || signals.consecutiveFailedVerifications >= 3) health = 'thrashing';
  else if (signals.consecutiveFailedVerifications >= 1 || signals.recentRewriteRetestCycles >= 2) health = 'struggling';
  else if (trajectory.pendingCalls.length > 0) health = 'dangling';

  return { finished, health, structuralLoops };
}

export function report(path, options) {
  const trajectory = extractTrajectory(path, options);
  // An unreadable transcript must never render as a healthy empty session.
  // It did during development: a shell glob returned nothing, the empty path
  // threw inside readFileSync, and the zero-filled result printed as a clean
  // report with health=ok. A swallowed failure that looks like data is worse
  // than a crash, because a consumer cannot tell it apart from a real answer.
  if (trajectory.error) return { path, error: trajectory.error };
  const signals = computeSignals(trajectory);
  const state = deriveState(trajectory, signals);
  return { path, goal: trajectory.goal, mtime: trajectory.mtime, ...state, signals };
}

function renderHuman(r) {
  const s = r.signals;
  const lines = [
    `TASK: ${r.goal || '(none recovered)'}`,
    '',
    `health=${r.health} finished=${r.finished}`,
    `tool_calls=${s.toolCalls} tool_errors=${s.toolErrors} pending=${s.pendingCalls} recent_error_rate=${s.recentErrorRate.toFixed(2)}`,
    `error_classes=${s.distinctErrorClasses.join(',') || 'none'}`,
    `loop_detected=${s.loopDetected} loop_kinds=${s.loopKinds.join(',') || 'none'}`,
    `verifications_run=${s.verificationsRun} failed=${s.failedVerifications} consecutive_failed=${s.consecutiveFailedVerifications} last_passed=${s.lastVerificationPassed}`,
    `rewrite_retest_cycles=${s.rewriteRetestCycles} steps_since_progress=${s.stepsSinceProgress} files_touched=${s.filesTouched}`,
    `human_turns=${s.humanTurns} assistant_turns=${s.assistantTurns}`,
  ];
  if (r.structuralLoops.length) {
    lines.push('', 'open loops (structural, no model call):');
    for (const loop of r.structuralLoops) lines.push(`  - ${loop}`);
  }
  if (s.recentActions.length) {
    lines.push('', 'recent actions:');
    for (const action of s.recentActions) lines.push(`  ${action}`);
  }
  return lines.join('\n');
}

const invoked = process.argv[1] && process.argv[1].endsWith('trajectory.mjs');
if (invoked) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const paths = args.filter((a) => !a.startsWith('--'));
  if (!paths.length) {
    console.error('usage: trajectory.mjs [--json] <transcript.jsonl> [...]');
    process.exit(2);
  }
  let failed = 0;
  for (const path of paths) {
    const r = report(path);
    if (r.error) {
      // Reported per file and counted, so one bad path never kills a batch and
      // never passes for a clean result either.
      console.error(`cannot read ${path}: ${r.error}`);
      failed += 1;
      continue;
    }
    if (asJson) console.log(JSON.stringify(r));
    else console.log(renderHuman(r) + (paths.length > 1 ? '\n' + '-'.repeat(60) : ''));
  }
  if (failed) process.exit(1);
}
