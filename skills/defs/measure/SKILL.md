---
name: measure
description: Grade the assistant from transcript evidence, no model call and no survey. Reports unfinished threads, subjects started more than once, and the satisfaction trend read off what the owner said back. Triggers on "/measure", "what did I leave unfinished", "what am I working on twice", "how am I doing", "open loops", "satisfaction trend", "am I getting better".
---

# /measure -- Grade the work from evidence, not self-report

Runs the `measure/` layer and reads its output back in prose. Every number here is computed from
tool calls and the owner's own replies. Nothing is asked of a model, so nothing here can be flattered
into a good score. Doctrine: `rules/MEASUREMENT.md`. Command reference: `measure/README.md`.

## When to trigger

- `/measure`, "what did I leave unfinished", "what am I working on twice", "open loops",
  "satisfaction trend", "how am I doing lately".
- Before dispatching a build, to check whether a live session is already on it. A duplicated build
  is exactly what the cluster half catches.
- Do NOT run this to decide whether the current session went well. It reads transcripts on disk; the
  conversation you are in is still being written.

## Step 0: The invariant

These scripts only ever read transcripts. **Never** add a step that resumes, edits, or otherwise
touches one, and never pipe their paths into a tool that writes. Idle age is measured by transcript
mtime, and a reader that bumps it makes every conversation look permanently active with no visible
error.

## Step 1: Unfinished threads and repeated subjects

```bash
node measure/open-loops.mjs
```

Tab-separated, one record per line: `C` a repeated subject with its count, `M` a member of the
cluster above it, `L` an unfinished thread, `O` one open loop belonging to it, `E` a note about a
missing input. Read `E` lines out loud rather than skipping them: they are the difference between
"nothing repeated" and "the cluster half has no writer yet."

Present the `L` rows first, worst health first (`thrashing`, `blocked`, `struggling`, `dangling`,
`ok`), with each row's open loops underneath and the session id needed to resume. Then the `C`
clusters, if any, as "you have started this more than once."

## Step 2: The satisfaction trend

```bash
node measure/satisfaction-rollup.mjs
```

`B` rows are the two buckets, this week and the prior week: exchanges, praise, corrections, re-asks,
interrupts. `C` rows are the conversations that cost the owner the most, worst first. Report the
direction (corrections up or down against last week) and name the worst conversations by label.

Do not editorialize the number into a grade. Corrections are not failures; a week with more of them
may just be a week with more work in it. Report the counts and the direction, and say what changed.

## Step 3 (on request): one conversation in detail

```bash
node measure/satisfaction.mjs --exchanges <transcript.jsonl>
node measure/trajectory.mjs <transcript.jsonl>
```

Use this when the owner asks why a session scored the way it did. Every verdict carries the rule that
produced it, so a wrong one is traceable. **If a verdict is wrong, that is a finding, not an
argument:** the fix is a rule in `measure/satisfaction.mjs` with a comment saying what it cost, not a
one-off override here.

## Step 4: Close the loop

If a correction in the report names a real miss the assistant made, capture it per the miss-capture
protocol in `rules/OPERATING.md`. If it names a case where memory failed (a fact the store held and
did not surface, a stale belief served as current), it belongs in the recall-miss ledger instead,
replayable, as that file's laws require.

## Rules

- Read the `E` lines. A silent absence is the failure this whole layer exists to prevent.
- Never re-run a script to get a different answer. Same input, same verdict, by design.
- Keep the report short. Unfinished threads, the trend direction, the worst two conversations. The
  owner can ask for detail.
