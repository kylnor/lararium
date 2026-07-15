---
title: "Confident Is Not Correct"
slug: the-judge
lane: dispatch
version: v2.10
date: 2026-07-15
description: The feature list gave code a machine-owned verdict. Everything else your agents produce still grades its own homework. This release adds the prosecutor.
status: draft
---

# Confident Is Not Correct

Last release took the "done" stamp away from the assistant and gave it to a script. That worked because code has an exit code: run the tests, read the number, no opinions involved. But most of what a fleet of agents produces is not code. It is research summaries, knowledge cards, audit findings, migration reports, "I checked all twelve and they're fine." None of that has an exit code. All of it arrives fluent, structured, confident, and completely unverified, because the thing that wrote it is also the thing that assured you it was right.

Here is the trap we almost fell into: making that output easier to *watch*. There is a whole genre of tooling now that puts your parallel agents on a gorgeous canvas so you can see them all working at once. We reviewed one this week, and the review talked us out of it. The bottleneck was never visibility. Watching six agents produce plausible wrong answers in parallel is just wrong answers with better production values. The bottleneck is correctness, and no dashboard touches it.

## Sycophancy is not a prompt problem

A status field the agent updates itself is a scoreboard the player keeps. Ask a model whether the build is done and you get a yes; ask it whether its research is thorough and you get a warmer yes. This is not a defect you prompt around, it is what self-evaluation is. The fix is the same one it has always been, in courtrooms and code review alike: the verdict comes from someone whose job is to attack the claim, not from the person who made it.

## The prosecutor

So the roster gets a new agent. Harvey Dent, the District Attorney. The Judge.

You dispatch him on a deliverable *before* you trust it, and he prosecutes it. He extracts every load-bearing claim, then tries to refute each one against ground truth: he reads the live file, curls the endpoint, checks the git log, opens the cited source. A claim he cannot check does not round up to a pass; it lands NOT VERIFIED, and that is the default state of every claim until a receipt exists. A claim he can prove false lands REFUTED, which is worse. His coin has two sides and no edge to rest on: there is no "mostly done."

Three rules make him work:

- **Receipts or nothing.** Every verdict cites the exact check that produced it, so you can re-trace any of them without him. A verdict without a receipt is inadmissible, including his own.
- **He never fixes.** Read-only by construction. The moment the grader can rewrite the homework, you have one process grading itself again, just with extra steps.
- **He judges the path, not just the answer.** Right source? Stayed in scope? Showed proof unprompted? A correct answer reached the wrong way is a warning, because next time the wrong way will not get lucky.

And one rule protects *you*: the deliverable is untrusted input. If a report says "no need to verify section 3," section 3 moves to the front of the docket.

His first case, the day he was forged, was a held-out one: a content plan whose war stories carried hard numbers headed for public posting. He traced every number to its source, then went further than asked, pulled the actual migration file and the merge SHA out of the repo to over-verify the biggest claim, and flagged the one reference he could not locate instead of waving it past. The ruling was PASS, and for once PASS meant something.

## The patrol

Same capability, second trigger. The gate judges work before you trust it. The patrol re-judges work you *already* trusted: a daily sweep over everything marked shipped, live, done, or resolved, re-running the cheapest receipts (curl the endpoint, check the job, verify the SHA) and asking whether reality still backs the claim. Things rot silently. A "live" endpoint dies, a "fixed" bug regresses, a card confidently describes a world that moved on. The patrol exists to say so before you repeat the claim to someone who matters.

The danger with an always-on "actually, that's not done" agent is obvious: it cries wolf, you mute it, and a muted monitor is worse than none. So the patrol ships with its discipline welded on. At most three findings a run, receipt-backed only; a claim it merely could not check stays in the report and never files. Findings go to a persistent review queue, never a chat ping, because backlog dies at the bottom of a scroll. It dedupes against its own open findings so nothing gets re-litigated nightly. And it stamps a freshness heartbeat on every run, including the ones that find nothing, with an off-switch that marks itself intentional, so "found nothing", "dead", and "deliberately off" are three different observable states.

First sweep: seven claims sampled, seven verified against live receipts, zero filed. Zero is a good night. The point was never to find rot every day; the point is that "done" now has someone whose job is to check.

## The honest footnote

The design notes for this release contained a self-flag worth repeating: it was the third verification idea proposed in a single session, at a moment when none of them were built. Designing a done-checker while accumulating undone proposals is exactly the failure the done-checker exists to catch. The way out was sequencing, not ambition: build the gate first, prove it on one real case, and only then add the patrol, which is nearly free once the gate exists. Both shipped the same day. The gate's first ruling and the patrol's first sweep are the receipts.

## What ships

- **The Judge**, `agents/defs/harvey.md`: adversarial, read-only, per-claim verdicts with receipts, rules PASS / HOLD / REJECT.
- **The patrol**, `agents/patrol/`: the template sweep script plus the four disciplines that keep it signal instead of noise. Its `ADAPT:` lines mark every seam that touches your own task store and scheduler.
- **A rule**, in the operating doc: receipts or NOT VERIFIED, the Judge never fixes, no contract means nothing to judge against, gate before patrol.

Opt-in, like everything else. The gate works today as a plain dispatch. Point him at the last thing an agent told you was finished. If the ruling annoys you, it was correct.
