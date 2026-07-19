---
title: "The Constitution, the Contract, and the Diary"
slug: the-diary
lane: dispatch
version: v2.12
date: 2026-07-19
description: Three additions in one release, two for the outputs that drift quietest, and one organ the template should have shipped with from the start.
status: draft
---

# The Constitution, the Contract, and the Diary

Second release today. The morning's study of Ringer produced v2.11 and the check-is-the-contract
doctrine. The rest of the day went to the same author's larger body of work, and three more
pieces earned their way in. Two are about the outputs that drift quietest. One is a confession.

## The editorial constitution

A personal AI stack grows synthesis surfaces the way a house grows drawers: briefings, digests,
knowledge cards, audit reports, weekly reviews. Each one has a prompt, each prompt drifts in its
own direction, and the same failures reappear everywhere: a single reminder inflated into a
"theme," a quiet week padded into paragraphs, a digest quietly summarizing last week's digest.

You cannot tune your way out prompt by prompt. The fix that compounds is a constitution: one
versioned document of numbered rules that every synthesis prompt cites at its head. Drift stops
being a vibe and becomes "this output violates E3." Recurring drift patches the rule, bumps the
version, and every citing prompt inherits the fix. It is the miss-capture protocol pointed at
generated prose.

`rules/EDITORIAL.md` ships ten default rules: receipts or silence, no synthesis of synthesis,
one source gets at most one line, a theme needs three independent sources, empty sections are
correct, contradictions get surfaced rather than resolved, conclusions carry epistemic labels,
voice floors, scope honesty, and fix-the-law-not-the-symptom. Credit where due: the numbered-rule
audit pattern comes from Nate B. Jones's OB1 editorial policy, which is the best idea in that
repo. Customize the rules; keep the numbering and the citation discipline.

## The structured review contract

The build-then-adversarial-review loop has been the template's flagship pattern since the
beginning. Its weak joint was the report: prose sections a tired reviewer can satisfy without
actually looking. The upgrade makes the report a contract. Blockers carry file:line, the failure
scenario, the fix, and a confidence. Confirmed-clean is reported by dimension, with what was
actually inspected, and a dimension that was not checked says NOT CHECKED out loud. And any claim
without file:line or command-output evidence demotes to an Assumptions section, where it cannot
block a merge or pretend to be a finding.

Silence is not a verdict. Evidence-free findings are not findings. Those two sentences are the
whole upgrade; the format just makes them enforceable.

## The diary

Here is the confession: the private system this template was extracted from has kept a diary for
months, and it never made it into the template. Someone asked "did we ever roll the diary in?"
today and the answer was an embarrassed no.

The heartbeat, which the soul layer already ships, remembers what is hot: what shipped, what is
in flight, what broke. The diary remembers what it was like. A nightly entry, written by the
assistant in its own voice, about the day you two actually had. What happened, what was decided,
what it noticed about you and did not say in the moment. At session start, the assistant reads a
small rolling digest: the latest entry whole, the days before as one-line gists. It arrives
knowing where you are, not cold.

This sounds sentimental and is actually structural. Continuity is the thing that separates a
partner from a very good tool that reintroduces itself every morning, and narrative memory is
cheap: one scheduled job, one markdown file a day, one small injection at session start.

One law travels with it, learned the hard way: entries are never edited after the fact, but the
law protects honesty, not immutability. When a broken importer spent months narrating cron noise
as the human's life, the right call was to regenerate those entries from the truth, old prose
preserved in git, pipeline fixed first so it could never recur. A diary entry that records a data
bug instead of the day violates the law more than its regeneration does.

`soul/DIARY.md` has the shape, the wiring, and the law. Give your assistant a diary. It is the
cheapest personality infrastructure in the whole stack, and the one your future self will
actually read.
