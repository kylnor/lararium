---
name: recall-miss-ledger
description: "The memory eval, cheap version: an append-only ledger of every time memory failed you live. Each entry is written to be replayable, so the ledger IS the future eval corpus. Twenty entries graduate it to a replay harness. Ships empty; the two examples are invented and get deleted."
type: reference
status: living
updated: 2026-01-01
---

# Recall-miss ledger

The hardest question to ask a memory system is how good it actually is. Every stack in this space
answers it the same way: it does not. Recall either feels fine or it does not, nobody measures, and
the store grows anyway.

This is the answer built the cheap way. Not a synthetic benchmark, not a harness, not a schema. A
ledger of **real failures, captured at the moment they happen, written so each one can be re-asked
later by a machine.** Zero infrastructure: it is a markdown file you append to. The corpus grows on
its own because the failures happen on their own, and it grows out of your life rather than out of
someone else's imagination of it.

It sits beside the miss-capture protocol in `../../../../rules/OPERATING.md`, not inside it. A miss
is anything the assistant got wrong. A **recall miss** is narrower and more diagnostic: the system
*held* the answer, or should have, and did not put it in front of you. Those two want different
fixes, so they get different files.

## The law of the ledger

1. **A miss is logged the moment it is caught.** Same discipline as the miss-capture protocol, and
   it does not wait for the end of the conversation. If you correct a fact, if a recall comes back
   empty on something the corpus provably holds, if a stale belief surfaces as current, it goes here
   before the work continues.
2. **Every entry must be replayable.** The `Replay` line is a question a future harness can ask the
   memory system verbatim, with a checkable expected answer. An entry that cannot be re-asked is a
   diary line, not an eval case; tighten it until it can be.
3. **Log the layer, not just the failure.** Recall tool, session briefing, cross-surface digest,
   brain card, fact store, or the assistant's own inference on top of correct data. The fix for each
   is different, and the distribution across layers is the finding this file exists to produce.
4. **Misses only, plus the occasional calibration save.** A `save` entry (memory got it right when it
   mattered) is allowed sparingly, because a ledger of only failures reads as "memory is broken" when
   the true rate might be fine. That rate is the whole question.
5. **At 20 miss entries, build the replay harness.** Run every `Replay` question against live recall,
   grade against `Expected`, report by layer. That is your own eval, grown from real soil instead of
   invented. Until then: no harness, no infrastructure, no schema. Twenty is not a magic number, it
   is the point where the layer distribution stops being anecdote, and building the harness before
   you have the corpus is building a benchmark out of guesses.

## Entry shape

```
## YYYY-MM-DD <slug>
Kind: miss | save
Surface: terminal | chat | voice | briefing | daily-report | queue
Needed: what you actually needed to know
Memory said: what was returned or surfaced (or "nothing")
Truth: the right answer, with how it was established
Layer: recall | briefing | digest | brain-card | fact-store | inference
Cost: low | medium | high, one clause on what it cost
Fix class: the corrected rule, imperative voice
Replay: the verbatim re-askable question
Expected: the checkable right answer
```

`Truth` carries **how it was established**, not just what it is, because an entry whose truth was
itself asserted rather than checked will grade a future harness against a second guess. `Cost` is
what makes the ledger readable as a priority list later: a confident wrong name caught in the same
sentence and a week of work built on a false premise are both misses and are not the same problem.

## The graduation

At 20 misses the file has earned tooling. The harness is small: parse the `Replay` and `Expected`
pairs, ask each question through the same path your assistant uses (the recall tool, not the
database), grade, and report **by layer**. The layer column is the payoff. A ledger that comes back
80% `inference` says retrieval is fine and the assistant is over-reaching on correct data. One that
comes back 80% `recall` says the index is the problem. Those are opposite fixes, and without the
column you would guess.

Then the ledger keeps running. The harness reads it; it does not replace it.

---

<!-- Delete both examples below once you have real entries. They are invented, and they are here
     only to show the shape and the two most common failure classes. -->

## 2026-01-01 example-inference-by-adjacency

Kind: miss
Surface: terminal
Needed: which teammate asked for the export-format change
Memory said: the name of the person whose message sat next to it in the same morning's digest
Truth: a different teammate entirely, corrected in the conversation
Layer: inference. The digest data was correct; the request was attributed to a person by topic
adjacency instead of by sender
Cost: low, caught in-line, but it was a confident wrong name said out loud
Fix class: never attribute a request to a person by topic adjacency; digests truncate and strip
senders, so when the asker matters, verify the sender or ask
Replay: who requested the export-format change on 2026-01-01, and who reported the related bug?
Expected: two different people, named, with the sender field of each source message as the receipt.

## 2026-01-01 example-designed-around-an-existing-table

Kind: miss
Surface: terminal
Needed: whether the index already had a store for the thing about to be built
Memory said: nothing. A long design pass specified a new table and no layer surfaced that a table
with most of those columns already existed and held six figures of rows
Truth: it existed. Established by querying the live schema, and shipped as an extension to it rather
than as a duplicate
Layer: recall, and the dispatch prompts that never told any agent to look inward
Cost: high, a design was written against a false premise and needed a correction pass
Fix class: before designing any store, query the live schema for the subject's existing home; never
judge your own system by the card written about it
Replay: does the index already have a table for this kind of record, and what columns does it carry?
Expected: yes, named, with its current columns listed from the live schema rather than from a doc.
