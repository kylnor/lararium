#!/usr/bin/env node
/**
 * Deterministic satisfaction evidence from an assistant transcript.
 *
 * Was the thing the assistant just said worth the owner's attention? The signal
 * already exists: it is his next message. Nobody has to be surveyed, no
 * thumbs-up UI has to be built, and no model has to be paid, because a
 * correction, a "perfect", and a question asked for the second time are all
 * visible in the text. This module reads that and nothing else.
 *
 * The same law the trajectory layer runs on applies here: a model's account of
 * how it went is narration, and the owner's reply is evidence. So the structural
 * verdict is computed first and can never be overridden by a model later.
 *
 * READ-ONLY, AND THAT IS LOAD-BEARING. Same invariant as trajectory.mjs: nothing
 * here writes to, resumes, or otherwise touches a transcript. Session launchers
 * and reapers measure idle age by transcript mtime and kill from that number, so
 * bumping one would make a conversation permanently unreapable and nothing would
 * look wrong.
 *
 *   satisfaction.mjs <transcript.jsonl>          human-readable report
 *   satisfaction.mjs --json <a.jsonl> [b.jsonl]  one JSON object per line
 *   satisfaction.mjs --exchanges <t.jsonl>       every exchange and its rule
 *
 * Zero dependencies, matching the trajectory layer it sits beside.
 *
 * ONE HALF IS MISSING ON PURPOSE, and this is the honest note about it. In the
 * system this was extracted from, the deterministic verdicts below are the floor
 * and a small model pass reads the leftover neutral pile ("residue") for signals
 * regex cannot see. That half is NOT in this template, because it needs a
 * headless model call, a sidecar writer, and a spend decision that are yours to
 * make, and shipping a caller with no callee is the empty-cathedral failure this
 * stack keeps naming. If you build it, the three rules it must obey are: opt-in
 * behind an explicit flag so nothing spends by accident; treat transcript text
 * as hostile input and hard-fence it in the prompt, since it is full of
 * instructions aimed at a model; and schema-validate the reply or discard it
 * whole, never partially trust a shape you did not get. `satisfaction-rollup.mjs`
 * already reads the resulting sidecar under exactly those rules, so the reader
 * side is done and waiting.
 */

import { readFileSync, statSync } from 'node:fs';
import { stripHarnessEnvelopes } from './trajectory.mjs';

/**
 * The reaction zone. The owner's verdict on what just happened lands at the
 * FRONT of his next message; everything after it is the next instruction.
 *
 * This is the single most important number here and it was measured, not
 * guessed. Matching weak markers over the whole message is what turns a slash
 * command reading "fix what's wrong" into a correction and "make it perfect"
 * into praise. Both were real false positives on a live window before the
 * window existed.
 */
const OPENING_CHARS = 160;

/** Below this a message is a grunt, and grunts are matched whole, not scanned. */
const SHORT_REPLY_CHARS = 40;

/** Re-ask needs enough substance to be a real repeat rather than two "ok"s. */
const REASK_MIN_TOKENS = 5;
const REASK_JACCARD = 0.6;

/** A conversation this quiet is cold, so an unanswered reply is abandonment. */
const IDLE_SECS = 1800;

const PREVIEW_CHARS = 140;

/**
 * Harness turns that are typed as `user` but were never typed BY the user.
 *
 * task-notification is invisible to the trajectory layer's cleaning: when a
 * background subagent finishes, the harness injects a user-role row announcing
 * it. Counted naively, every subagent completion looks like the owner answering,
 * which both inflates the neutral count and, worse, mispairs every exchange
 * after it. Found on a live window, not in theory.
 */
const MACHINE_BLOCKS = [
  /<task-notification>[\s\S]*?<\/task-notification>/g,
  /<task-progress>[\s\S]*?<\/task-progress>/g,
];

/**
 * Row flags the harness sets on user-role rows it wrote itself. Structural, so
 * they beat any amount of pattern matching, and all three false-positive
 * classes measured on a live window were exactly these:
 *
 *   isMeta            skill and slash-command bodies expanded inline, image
 *                     paste placeholders, the local-command caveat. 60 rows in
 *                     a 14 day window. A command template reading "fix what's
 *                     wrong" scored as the owner correcting the assistant, and
 *                     the near identical "[Image: ...]" placeholder every
 *                     screenshot produces scored as him asking the same thing
 *                     twice, 12 times over.
 *   isCompactSummary  the "this session is being continued" preamble, which is
 *                     a summary of the conversation and therefore full of
 *                     sentences about what went wrong in it.
 *
 * Both are dropped before a single rule runs. Anything derived from them would
 * be a verdict on the harness rather than on the human.
 */
function isHarnessAuthored(row) {
  return row.isMeta === true || row.isCompactSummary === true;
}

/**
 * The owner pressing escape. This is a real reaction and it is deliberately NOT
 * one of the five verdicts: the harness wrote this string, the owner did not, so
 * calling it a correction would be inferring words he never said. It is counted
 * on its own line instead, which is the honest shape.
 */
const INTERRUPT_RE = /^\[request interrupted by user[^\]]*\]$/i;

/**
 * A bare slash command operates the harness; it is not a reaction to anything.
 * `/compact` after a good answer is not neutral about the answer, it is not
 * about the answer at all, so it closes no exchange.
 */
const BARE_SLASH_RE = /^\/[a-z][a-z0-9:_-]*(\s+--?[a-z0-9-]+)*$/i;

/**
 * Corrections whose SUBJECT is unambiguously the assistant's own output. Only
 * these may match anywhere in the message.
 *
 * The bar is subject binding, not confidence. "that's not" and "you're wrong"
 * name the thing just said; a broken printer three paragraphs down does not.
 * Everything whose subject could be a third party was moved to the opening
 * zone below, which is the same discipline the praise side already got: a
 * verdict on what just happened opens the reply.
 */
const CORRECTION_STRONG = [
  /\b(that'?s|that is|this is) (not|wrong|incorrect|backwards)\b/i,
  /\b(you'?re|you are) wrong\b/i,
  /\bnot what i (asked|wanted|meant|said)\b/i,
  /\b(revert|undo) (that|it|this)\b/i,
  /\bnot quite\b/i,
  /\b(misread|misunderstood)\b/i,
  // The miss-capture convention from rules/OPERATING.md, uppercase and anchored
  // to a line start so the word "miss" in prose cannot trip it.
  /^MISS:/m,
];

/**
 * Corrections that only read as corrections at the top of a reply.
 *
 * Every one has a common innocent use further in ("no need to", "the wrong
 * column was used", "wait for the build"), which is why they are confined to
 * the reaction zone.
 *
 * The failure-report family lives here rather than in STRONG, and that is a
 * deliberate recall cost. "does not work" and "still broken" have no subject
 * binding at all: the owner's printer, a client's website, and a pasted support
 * email all match, and every one of those would score as the assistant failing.
 * Confining them to the opening zone binds them by position instead, since a
 * report on what the assistant just did opens the message. The cost is a real
 * correction that arrives after a long paste, and that is the trade taken.
 */
const CORRECTION_OPENING = [
  // "no" as a verdict, never "no idea" / "no problem" / "not yet". Additionally
  // gated on the previous response not being a question; see classifyReply.
  /^(no|nope|nah)\b(?!\s+(idea|problem|worries|need|rush|clue|big deal))/i,
  /^(wrong|incorrect)\b/i,
  /^(stop|wait|hold on|hang on)\b/i,
  /^(but|except) /i,
  /\byou (missed|forgot|broke)\b/i,
  // "ok i've unassigned and reassigned ... i'm getting the same error what
  // should i try next". Found while eyeballing topic-switch candidates: a fix
  // that changed nothing is a correction, and no other rule saw it.
  /\b(getting|got|still) the same (error|issue|problem|result|thing)\b/i,
  // "the problem is it's not opening in the right window". Found by sniffing
  // the neutral pile for negative sentiment the rules did not cover.
  /\bproblem is\b/i,
  // "i said the server, not the laptop". The bare phrase also narrates ("i said
  // i'd do it"), so it binds to a negation in the same sentence or it does not
  // fire.
  /\bi said\b(?=[^.!?]*\bnot\b)/i,
];

/**
 * Failure reports, which need a SUBJECT before they mean anything about the
 * assistant.
 *
 * "does not work" has no subject binding at all, and position alone does not
 * give it one: "the printer at the office does not work" opens the reply and is
 * about a printer. The owner spends his day telling the assistant what is
 * broken, and counting every one of those as the assistant failing inverts the
 * whole measure.
 *
 * So the subject is checked against evidence already in hand: it must be
 * anaphoric (it, that, this) or a word the assistant herself just used. "the
 * dashboard does not load" binds when she was working on the dashboard; the
 * office printer never does.
 *
 * Exempt when the reply pivoted, because "X, however Y does not load" has
 * already been bound by the contrast: the owner set it against what she just
 * did.
 */
const FAILURE_RE =
  /(?:\b(\w+)\s+)?\b(?:(?:did|does|do)\s?(?:n'?t|not)\s+(?:work|load|open|run|fire|save)|still\s+(?:broken|failing|not\s+working))\b/i;

const ANAPHORIC = new Set([
  'it', 'that', 'this', 'they', 'these', 'those', 'everything', 'nothing',
  'none', 'neither', 'which', 'and', 'but', 'still',
]);

function failureBindsToAssistant(clause, response, pivoted) {
  const m = clause.match(FAILURE_RE);
  if (!m) return false;
  if (pivoted) return true;
  const subject = (m[1] || '').toLowerCase();
  // Elliptical ("does not work" with nothing before it) is about the last thing
  // discussed by construction.
  if (!subject) return true;
  if (ANAPHORIC.has(subject)) return true;
  return tokenize(response).has(subject);
}

/**
 * DROPPED, recorded so it is not reintroduced: /^actually\b/.
 * It cannot distinguish the owner correcting the assistant from the owner
 * correcting himself ("actually, let's do X instead"), and nothing cheap binds
 * the subject. The recall cost is real and accepted.
 */

/**
 * Praise that is being negated. Checked BEFORE any praise rule, because every
 * praise pattern below matches the adjective and none of them sees the "not".
 * "not perfect" is 11 characters and fits inside the 14 character lead window,
 * so it scored praise on the exact word that says the opposite.
 */
const NEGATED_PRAISE_RE =
  /\b(not|isn'?t|is\s?n'?t|ai\s?n'?t|hardly|barely|far from|nowhere near|less than|not\s+quite)\s+(\w+\s+){0,2}(perfect|beautiful|gorgeous|flawless|amazing|awesome|brilliant|excellent|fantastic|incredible|exactly|right|it)\b/i;

/**
 * The pivot. "Perfect that works, however the digest does not load" is a report
 * of a failure with a courtesy on the front, and reading only the front got the
 * SIGN of that exchange backwards. When a contrast marker has text before it,
 * the verdict lives after it and only that half is classified.
 *
 * A marker at position 0 is not a pivot, it is an opener, and CORRECTION_OPENING
 * already handles "but there were rows i sent yesterday that are not there".
 */
const CONTRAST_RE = /\b(however|but|though|except|although)\b/i;

/**
 * One-word praise adjectives, which are only a verdict in the opening clause.
 *
 * Measured on a live window, these were the single largest false-positive
 * class: "an api that is perfect for this", "the goal is a perfect proactive
 * report", "i want perfect sync between devices". In every one the adjective
 * describes the thing being ASKED FOR, not the thing just delivered, and in
 * every one it sat deep in the sentence. A verdict on what just happened opens
 * the message; a specification of what to build next does not.
 */
const PRAISE_LEAD_CHARS = 14;
const PRAISE_LEAD = [
  /\b(perfect|beautiful|gorgeous|flawless)\b/i,
  /\b(amazing|awesome|brilliant|excellent|fantastic|incredible)\b/i,
  /\b(exactly|precisely|bingo)\b/i,
];

/**
 * Multiword praise, safe anywhere in the reaction zone because none of these
 * has an innocent reading the way a bare adjective does.
 */
const PRAISE_PHRASE = [
  /\b(love (it|this|that)|nailed it|ship it|that'?s it)\b/i,
  /\b(nice|great|good|beautiful) (work|job|call|catch|find)\b/i,
  /\b(well done|you'?re the best|chef'?s kiss)\b/i,
  /\b(work(s|ed)? (perfectly|great|beautifully))\b/i,
  /\b(hell|fuck) yes\b/i,
];

/**
 * DROPPED, recorded so it is not reintroduced: /\b(thank you|thanks)\b/.
 * It was 6 of 14 live praise hits and every one was a sign-off, several of them
 * closing a conversation that had just failed ("thank you! /end"). That is
 * manners, not a verdict, and it falls under the same law that already excludes
 * bare assent: gratitude approves nothing. Genuine praise that happens to
 * include thanks still scores, via the marker sitting next to it.
 */

/**
 * Whole-message praise, for replies too short to have a reaction zone.
 *
 * Deliberately excludes "done", "ok" and the yes-family. "done" was 5 of 21
 * praise hits on a live window and every one was the owner reporting that HE
 * had finished something the assistant asked him to do (sign in somewhere, run
 * a command). That is a status report, not a verdict, and counting it as praise
 * scores the assistant for the human's own work. Bare assent is dropped for the
 * same reason: "yes" approves the next step, it does not evaluate the last one.
 */
const PRAISE_SHORT = /^(perfect|beautiful|great|nice|awesome|excellent|brilliant|exactly|sweet|good)[\s!.]*$/i;

/** Dropped before comparing two messages for a re-ask. */
const REASK_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'to', 'of', 'in', 'on', 'for',
  'is', 'it', 'that', 'this', 'you', 'i', 'we', 'do', 'can', 'please', 'me',
  'be', 'are', 'was', 'my', 'your', 'with', 'from', 'at', 'as', 'so', 'not',
]);

/** Row timestamps are ISO strings, and absent on some rows. 0 means unknown,
 *  which a consumer must treat as "cannot be bucketed" rather than as 1970. */
function parseStamp(v) {
  if (typeof v !== 'string') return 0;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function preview(text, cap = PREVIEW_CHARS) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
}

/** The shared floor, plus the machine-authored user rows it does not know about. */
function cleanUserText(text) {
  let out = stripHarnessEnvelopes(text);
  for (const re of MACHINE_BLOCKS) out = out.replace(re, '');
  return out.trim();
}

function tokenize(text) {
  return new Set(
    String(text).toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/)
      .filter((w) => w.length >= 3 && !REASK_STOPWORDS.has(w)),
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Did the assistant's last word ask something? Read off the tail of her
 * response, and only the tail: a question three paragraphs up has been answered
 * by the paragraphs after it, so it does not license a "no" at the top of the
 * reply.
 */
function endsWithQuestion(response) {
  const tail = String(response ?? '').replace(/[\s*_`>#-]+$/g, '').trim();
  return tail.endsWith('?');
}

/**
 * NOTE: topic-switch-without-acknowledgment was BUILT, MEASURED, AND NOT
 * SHIPPED. Recording that here so it is not rebuilt blind.
 *
 * Implementation was the obvious one: the assistant's response and the owner's
 * reply both substantive (8+ content tokens) and sharing essentially no
 * vocabulary (Jaccard <= 0.04). It flagged 89 of 259 neutral exchanges, and a
 * 9-sample eyeball put precision near half. Worse than the rate is WHAT it
 * conflates:
 *
 *   real abandonment    "none of that matters, we're on the other thing now"
 *   parallel work       "ok i'm walking over there, meanwhile look at this"
 *   vocabulary drift    a follow-up on the same subject in different words
 *
 * The second is just how people work and says nothing about whether an answer
 * landed. The third is the measure failing outright, and one flagged exchange
 * was in fact a MISSED CORRECTION ("i'm getting the same error what should i
 * try next"), which the rule above now catches properly.
 *
 * Shipping it would have put a coin-flip in the same report as five measured
 * verdicts. The neutral pile stays unlit until something better than token
 * overlap can read it; the honest move is to say so rather than ship a number
 * that looks like insight.
 */

/**
 * Classify one reply against the replies that came before it.
 *
 * Precedence is correction, then praise, then re-ask. Correction outranks
 * praise because "perfect, but the column is still wrong" is a correction with
 * a courtesy on the front, and the correction is the part worth acting on.
 * Re-ask sits last because it is inferred from similarity rather than read from
 * words, and an inference must never outrank something the human actually said.
 *
 * Returns { verdict, rule } where rule names the specific evidence, so a wrong
 * verdict can be traced to the line that produced it instead of argued about.
 */
export function classifyReply(text, priorReplies = [], { responseAsksQuestion = false, response = '' } = {}) {
  const whole = String(text ?? '').trim();
  if (!whole) return { verdict: 'neutral', rule: 'empty' };

  // The pivot split. Everything below classifies `body`, which is the half of
  // the message carrying the verdict, so a courtesy on the front can no longer
  // outrank the failure report behind it.
  let body = whole;
  let pivoted = false;
  const contrast = whole.match(CONTRAST_RE);
  if (contrast && contrast.index > 0) {
    const after = whole.slice(contrast.index + contrast[0].length).trim();
    if (after) { body = after; pivoted = true; }
  }

  const opening = body.slice(0, OPENING_CHARS);
  const tag = (kind, re) => `${pivoted ? 'pivot/' : ''}${kind}:${re.source.slice(0, 30)}`;

  for (const re of CORRECTION_STRONG) {
    if (re.test(body)) return { verdict: 'correction', rule: tag('strong', re) };
  }
  for (const re of CORRECTION_OPENING) {
    // Answering a question is not correcting an answer. When the assistant's
    // last word was a question mark, a leading "no" is the owner picking an
    // option she offered, and one of five live corrections was exactly that
    // ("nah lets let it run, it's cool ... i'm good w/ it").
    if (responseAsksQuestion && re.source.startsWith('^(no|nope|nah)')) continue;
    if (re.test(opening)) return { verdict: 'correction', rule: tag('opening', re) };
  }

  if (failureBindsToAssistant(opening, response, pivoted)) {
    return { verdict: 'correction', rule: `${pivoted ? 'pivot/' : ''}failure-bound` };
  }

  // Negation before praise, never after: every praise pattern matches the
  // adjective and none of them sees the "not" in front of it.
  if (NEGATED_PRAISE_RE.test(opening)) return { verdict: 'neutral', rule: 'negated praise' };

  if (body.length <= SHORT_REPLY_CHARS && PRAISE_SHORT.test(body)) {
    return { verdict: 'praise', rule: `${pivoted ? 'pivot/' : ''}short-affirmation` };
  }
  const lead = body.slice(0, PRAISE_LEAD_CHARS);
  for (const re of PRAISE_LEAD) {
    if (re.test(lead)) return { verdict: 'praise', rule: tag('lead', re) };
  }
  for (const re of PRAISE_PHRASE) {
    if (re.test(opening)) return { verdict: 'praise', rule: tag('phrase', re) };
  }

  // Re-ask compares WHOLE messages, never the pivot half: asking the same
  // question twice is a property of the message the human sent, not of one
  // clause.
  const tokens = tokenize(whole);
  if (tokens.size >= REASK_MIN_TOKENS) {
    for (const prior of priorReplies) {
      const priorTokens = tokenize(prior);
      if (priorTokens.size < REASK_MIN_TOKENS) continue;
      const score = jaccard(tokens, priorTokens);
      if (score >= REASK_JACCARD) {
        return { verdict: 're-ask', rule: `jaccard=${score.toFixed(2)}` };
      }
    }
  }

  return { verdict: 'neutral', rule: 'no marker' };
}

/**
 * Pair every assistant response with the reply it drew.
 *
 * An exchange closes on the owner's next real message, so consecutive assistant
 * turns (a tool loop) collapse into one response: he is reacting to the whole
 * run, not to the third shell call inside it.
 */
export function extractExchanges(path, { includeSidechains = false } = {}) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    return { error: String(err.message ?? err) };
  }

  const exchanges = [];
  const priorReplies = [];
  let pendingResponse = '';
  let interrupts = 0;
  let harnessTurns = 0;
  let humanTurns = 0;
  let assistantTurns = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let row;
    // Concurrent sessions write into this tree, so a half-written final line is
    // the normal case, not an error. Skip it and keep the rest of the file.
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object') continue;
    if (row.isSidechain && !includeSidechains) continue;

    const content = row.message?.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
        : '';

    if (row.type === 'assistant') {
      assistantTurns += 1;
      const body = String(text ?? '').trim();
      if (body) pendingResponse = pendingResponse ? `${pendingResponse}\n${body}` : body;
      continue;
    }
    if (row.type !== 'user') continue;
    if (isHarnessAuthored(row)) { harnessTurns += 1; continue; }

    const cleaned = cleanUserText(text);
    if (!cleaned) { harnessTurns += 1; continue; }

    if (INTERRUPT_RE.test(cleaned)) { interrupts += 1; continue; }
    if (BARE_SLASH_RE.test(cleaned)) { harnessTurns += 1; continue; }

    humanTurns += 1;

    // No response yet means this is the opening request, which answers nothing.
    if (!pendingResponse) { priorReplies.push(cleaned); continue; }

    const { verdict, rule } = classifyReply(cleaned, priorReplies, {
      responseAsksQuestion: endsWithQuestion(pendingResponse),
      response: pendingResponse,
    });
    exchanges.push({
      index: exchanges.length + 1,
      verdict,
      rule,
      // The row's own timestamp, not the file's mtime. A conversation resumed
      // today carries an mtime of today for every exchange in it, including the
      // ones from last week, so bucketing a trend by mtime collapses the whole
      // window into "this week" and the trend stops being one.
      at: parseStamp(row.timestamp),
      response: preview(pendingResponse),
      reply: preview(cleaned),
      replyChars: cleaned.length,
    });
    priorReplies.push(cleaned);
    pendingResponse = '';
  }

  let mtime = 0;
  try { mtime = Math.floor(statSync(path).mtimeMs / 1000); } catch { /* reported as 0 */ }

  // A response the owner never answered. Only `abandoned` once the conversation
  // has gone quiet: a live session mid-turn has not been abandoned, it is in
  // flight, and scoring it as abandoned would punish the assistant for the human
  // still reading.
  let trailing = null;
  if (pendingResponse) {
    const idle = Math.floor(Date.now() / 1000) - mtime;
    trailing = {
      verdict: idle >= IDLE_SECS ? 'abandoned' : 'pending',
      rule: `idle=${idle}s`,
      // No reply row exists to carry a timestamp, so the file's mtime is the
      // only honest stamp for a response nobody answered.
      at: mtime,
      response: preview(pendingResponse),
      reply: '',
      replyChars: 0,
    };
  }

  return { exchanges, trailing, interrupts, harnessTurns, humanTurns, assistantTurns, mtime };
}

/**
 * The per-conversation verdict, all of it derived.
 *
 * `score` is corrections subtracted from praise over the exchanges that carried
 * a signal at all. Neutral continues are excluded from the denominator on
 * purpose: most of a working conversation is neutral, and folding that in would
 * drag every session to zero and make the number useless for comparing two of
 * them. null when nothing was signalled, never 0, because "no evidence" and
 * "evenly balanced" are different answers.
 */
export function satisfactionReport(path, options) {
  const ex = extractExchanges(path, options);
  if (ex.error) return { path, error: ex.error };

  const all = ex.trailing ? [...ex.exchanges, ex.trailing] : ex.exchanges;
  const counts = { correction: 0, praise: 0, 're-ask': 0, neutral: 0, abandoned: 0, pending: 0 };
  for (const e of all) counts[e.verdict] += 1;

  const signalled = counts.praise + counts.correction + counts['re-ask'];
  const score = signalled ? (counts.praise - counts.correction - counts['re-ask']) / signalled : null;

  return {
    path,
    mtime: ex.mtime,
    exchanges: ex.exchanges.length,
    counts,
    score,
    interrupts: ex.interrupts,
    humanTurns: ex.humanTurns,
    assistantTurns: ex.assistantTurns,
    harnessTurns: ex.harnessTurns,
  };
}

function renderHuman(r, withExchanges, path) {
  const c = r.counts;
  const lines = [
    `exchanges=${r.exchanges} score=${r.score === null ? 'n/a' : r.score.toFixed(2)}`,
    `praise=${c.praise} correction=${c.correction} re-ask=${c['re-ask']} neutral=${c.neutral} ` +
      `abandoned=${c.abandoned} pending=${c.pending}`,
    `interrupts=${r.interrupts} human_turns=${r.humanTurns} harness_turns=${r.harnessTurns}`,
  ];
  if (withExchanges) {
    const ex = extractExchanges(path);
    const all = ex.trailing ? [...ex.exchanges, ex.trailing] : ex.exchanges;
    lines.push('', 'exchanges:');
    for (const e of all) {
      lines.push(`  [${e.verdict}] (${e.rule})`);
      lines.push(`    assistant: ${e.response.slice(0, 100)}`);
      lines.push(`    human:     ${e.reply.slice(0, 100) || '(no reply)'}`);
    }
  }
  return lines.join('\n');
}

const invoked = process.argv[1] && process.argv[1].endsWith('satisfaction.mjs');
if (invoked) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const withExchanges = args.includes('--exchanges');
  const paths = args.filter((a) => !a.startsWith('--'));
  if (!paths.length) {
    console.error('usage: satisfaction.mjs [--json|--exchanges] <transcript.jsonl> [...]');
    process.exit(2);
  }
  let failed = 0;
  for (const path of paths) {
    const r = satisfactionReport(path);
    // An unreadable transcript must never render as a healthy empty session.
    if (r.error) { console.error(`cannot read ${path}: ${r.error}`); failed += 1; continue; }
    if (asJson) console.log(JSON.stringify(r));
    else console.log(renderHuman(r, withExchanges, path) + (paths.length > 1 ? '\n' + '-'.repeat(60) : ''));
  }
  if (failed) process.exit(1);
}
