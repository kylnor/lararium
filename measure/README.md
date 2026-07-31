# Measure

Four small programs that grade your assistant from evidence it already produced, with no model
call, no spend, and no survey. They read session transcripts and answer three questions the rest of
the stack cannot:

- **What did this session actually do?** Recovered from tool calls, not from the model's own
  account of itself (`trajectory.mjs`).
- **What did I leave unfinished, and what have I started twice?** (`open-loops.mjs`)
- **Is the assistant getting better or worse at being useful?** Read off what the human said back
  (`satisfaction.mjs`, `satisfaction-rollup.mjs`).

The doctrine these implement is in [`../rules/MEASUREMENT.md`](../rules/MEASUREMENT.md). The one
line worth carrying: **evidence before self-report.** A model asked how it went says it went well. A
command that exited zero says something. Anything tool calls can prove is computed here and never
asked of a model.

Zero dependencies, plain Node, nothing to install. Beside the six layers, like `lab/`.

## The invariant, stated once and repeated in every file

**Anything that reads a transcript must never modify it or bump its mtime.**

Session launchers and reapers measure idle age by transcript mtime and decide what to kill from
that number. A reader that touched mtime would make every conversation look freshly active and
permanently unreapable, and nothing would look wrong: no error, no alert, just a list that quietly
stops being true. Every file here opens transcripts read-only and says so in its header. If you
extend one, extend it read-only, and prove it: a `find` on your transcripts filtered by modification
time, run before and after, is the whole test.

## The commands

```
node measure/trajectory.mjs            <transcript.jsonl>   # one session, human-readable
node measure/trajectory.mjs --json     <a.jsonl> <b.jsonl>  # one JSON object per line

node measure/satisfaction.mjs          <transcript.jsonl>   # verdict counts for one session
node measure/satisfaction.mjs --exchanges <transcript.jsonl> # every exchange and the rule that fired

node measure/open-loops.mjs                                 # unfinished threads across all sessions
node measure/satisfaction-rollup.mjs                        # this week against last week
```

The last two walk your whole transcript tree. They default to `~/.claude/projects` (Claude Code's
layout) and honor `MEASURE_PROJECTS_ROOT` if yours lives elsewhere, which is also how you point them
at a fixture directory to test them.

Try it before you trust it, on the invented fixtures that ship here:

```
node measure/trajectory.mjs   measure/fixtures/example-project/example-session.jsonl
node measure/satisfaction.mjs --exchanges measure/fixtures/example-project/example-session.jsonl
MEASURE_PROJECTS_ROOT=measure/fixtures node measure/open-loops.mjs
MEASURE_PROJECTS_ROOT=measure/fixtures node measure/satisfaction-rollup.mjs
```

The fixtures are made up. They exist to show the output shape and to give the rules something to
bite on, nothing more. They sit one directory deep because that is the layout the tree-walkers
expect: a projects root holding one directory per project, each holding `<session-id>.jsonl`.

The fixture timestamps are fixed, so as they age they fall out of the rollup's current bucket and
into the prior one, and eventually past the 14 day window entirely. That is the trend working
correctly, not a broken fixture.

### Wiring it into your day

There is no daemon and no schedule here on purpose; these are cheap enough to run on demand. The two
useful wirings, in order of payoff:

1. **A launcher subcommand.** If you have a script that lists and resumes conversations, give it a
   `loops` verb that shells out to `open-loops.mjs` and renders the TSV. That is where this gets
   used: at the moment you are picking what to reopen.
2. **The `/measure` skill** (`../skills/defs/measure/SKILL.md`) runs them and reads the output back
   to you in prose, which is the version you will actually reach for.

## How the verdicts are made

**Trajectory** classifies every tool result as ok, failed, or *blocked*, and blocked is the one that
matters most. A permission denial arrives flagged exactly like a crash, so without separating them
every rule in a serious deny/ask list scores as the agent breaking; on real corpora denials were the
largest error category by volume. A stopped-because-not-allowed session is a different open loop
from a stopped-because-stuck one, and they want different responses from you.

Progress is a **successful execution, never a file write**. A counter that resets on each write lets
an agent rewrite, fail, rewrite, fail forever while looking healthy. Loop detection reads a trailing
window rather than the session's lifetime, because a whole workday saturates any lifetime counter
and the question is what state the conversation was in when it *stopped*.

**Satisfaction** classifies the human's next message into correction, praise, re-ask, neutral,
abandoned, or pending, and reports the rule that fired so a wrong verdict can be traced instead of
argued about. The hard-won parts, all of which cost a false-positive class to learn:

- **The reaction zone.** A verdict on what just happened opens the reply; a specification of what to
  build next does not. "an API that is perfect for this" is not praise.
- **The negation guard runs before every praise rule**, because each praise pattern matches the
  adjective and none of them sees the "not" in front of it.
- **The contrast pivot.** "Perfect, but the digest still does not load" is a failure report with a
  courtesy on the front. Split at the contrast marker and classify the half that carries the verdict,
  or you get the sign of the exchange backwards.
- **Subject binding on failure reports.** "Does not work" says nothing about the assistant until you
  know what does not work. It binds only when the subject is anaphoric or a word the assistant's own
  response just used, because most of what a human reports as broken is not the assistant.
- **A leading "no" is gated on whether the assistant's last word was a question.** Answering a
  question is not correcting an answer.
- **Bare assent and thanks are excluded.** "Yes" approves the next step; "done" is usually the human
  reporting *his own* work; gratitude is manners. None of them evaluates what was just delivered.

Harness-authored rows are dropped before any rule runs: slash-command bodies, compaction preambles,
subagent completion notices, image placeholders. Every one of those was a measured false positive, and
a verdict derived from them is a verdict on the harness rather than on the human.

## What does not ship here, and why the absence is loud

Two optional halves have readers here and no writers, and both print a note (`E` line) rather than an
empty table, because an empty queue and an unbuilt producer must never look the same.

**Topic sidecars** (`<session-id>.loops.json`, next to the transcript). Feed the cluster half of
`open-loops.mjs`, which answers "what have I started twice." Topics need a model to name them, so
that writer is yours to build. Contract, validated strictly on read and discarded whole if it does
not match:

```json
{
  "v": 1,
  "finished": false,
  "next_move": "one sentence, <= 200 chars, what to do first on resume",
  "open_loops": ["<= 3 strings, <= 120 chars each"],
  "topics": ["<= 4 slugs, lowercase, <= 40 chars, hyphenated"]
}
```

Clustering joins on the *words inside* the slugs, not the whole slug, because a model naming a thing
freely agrees on the words far more often than the phrase: `csv-exporter` and `widget-exporter` are
the same subject and never match as strings.

**Residue sidecars** (`<session-id>.sat.json`). A model pass over the neutral exchanges the
deterministic rules could not read, counted as satisfied / dissatisfied / unclear:

```json
{ "v": 1, "residue": { "scored": 12, "satisfied": 7, "dissatisfied": 2, "unclear": 3 } }
```

If you build either writer, three rules are not optional. **Opt in behind an explicit flag**, so
nothing spends by accident. **Treat transcript text as hostile input** and fence it in the prompt: a
transcript is full of instructions aimed at a model, and you are about to feed it to one.
**Schema-validate or discard whole**, never partially trust a shape you did not get. The readers
here already do their half of that.

**The outcome scoreboard** is the third absence, and the largest. The system this came from prints a
table beside the trend counting what happened to every proactive item the assistant filed: accepted,
dismissed, held, or *rotted unread*. It is not here because it would have to assume your task
schema. Build it against whatever store you use, and keep the rule that makes it honest: **rot counts
against the producer, not against the human.** Details in `../rules/MEASUREMENT.md`.

## A known blind spot, recorded so it is not rebuilt

Topic-switch-without-acknowledgment (the human silently changing subject, which reads as an answer
that did not land) was built, measured, and **not shipped**. Implemented as low vocabulary overlap
between the response and the reply, it flagged 89 of 259 neutral exchanges at roughly coin-flip
precision, and it conflated real abandonment with ordinary parallel work and with the same subject
described in different words. Shipping it would have put a guess in the same report as five measured
verdicts. The neutral pile stays unlit until something better than token overlap can read it.

That note lives in the source too. Recording a measured negative result is cheaper than rediscovering
it, and it is the same discipline as the recall-miss ledger in the brain layer.
