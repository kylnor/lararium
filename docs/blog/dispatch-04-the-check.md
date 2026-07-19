---
title: "The Check Is the Contract"
slug: the-check
lane: dispatch
version: v2.11
date: 2026-07-19
description: A parallel worker reports done with total confidence whether or not the thing works. So the stack stops reading the report and starts running the check.
status: draft
---

# The Check Is the Contract

Here is the most reliable behavior in all of agentic AI, more reliable than any benchmark: ask a
worker agent whether it finished, and it says yes. Fluently. With a summary. Whether or not the
thing works.

This stack already had two answers to that. The feature list gives a repo's features a
machine-owned state: a feature is `passing` only when its verification command exits zero, and the
verifier writes that transition, never the model. The Judge re-proves non-code deliverables after
the fact, claim by claim, receipts or NOT VERIFIED. Repo level, and after the fact. There was a
gap in the middle: the dispatch itself. You hand a builder agent a task, it hands you back a
confident paragraph, and the paragraph is the only artifact of "done" you have until review.

## Credit where it is due

This week I read Nate B. Jones's guide to Ringer, his swarm orchestrator. I did not install it;
its architecture is the one this stack already runs, and its economics solve a bill I do not pay.
But one sentence in it is better than anything I had written on the subject: the check is the
contract. Ringer never reads the worker's summary. It runs your check command against the
artifact, and exit code zero is the only thing it believes.

That is the correct amount of trust to place in a worker agent's self-report: none, when a shell
command can answer instead.

## What changed in v2.11

The dispatch doctrine grows one validated loop, and it has three teeth.

**First: the brief names the check.** Wherever a task's done can be an executable command, the
brief carries that command next to the task, up front, written before the build. Not "the export
should work" but the exact invocation, and exit 0 is the only pass. Writing it before the build
is the point: it forces you to define done while you still remember what you actually wanted.

**Second: checks print why they fail.** A check that just exits 1 tells you that something broke.
A check that prints what it expected and what it got hands the retry a diagnosis. That is the
difference between an informed second attempt and a coin flip with your tokens.

**Third: one informed retry, then stop.** A failed check gets exactly one fix attempt, with the
failure output pasted in so the worker sees what broke instead of guessing. If it cannot pass in
two informed attempts, the doctrine says the spec is the broken part. Amend it. Do not loop. An
agent looping on a bad spec is a slot machine that charges by the pull.

Prose acceptance criteria survive, but demoted: they are the fallback for judgments that genuinely
cannot execute, a visual call, a tone call, and the brief has to say so explicitly. Silence is no
longer an excuse for an unexecutable check.

## The shape of the whole thing now

Three verdict layers, one principle. The feature list owns done at the repo level. The check owns
done at the task level, inside the dispatch. The Judge owns done for everything that has no exit
code at all. In every layer the worker's confidence counts for nothing and an executed
verification counts for everything.

None of this required installing anything. It is a paragraph in the dispatch doctrine and a
sentence in the rules, which is the quiet lesson of the release: when someone else's tool
duplicates your architecture, the right move is usually to take its best sentence and leave the
binary. Ringer is free and open, the guide is worth your time, and if your stack does not have a
swarm layer yet it is a fine place to start. Mine has one. It just believes exit codes now.
