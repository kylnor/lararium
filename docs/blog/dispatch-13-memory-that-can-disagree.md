---
title: "Memory That Can Disagree"
slug: memory-that-can-disagree
lane: dispatch
version: v3.1.1
date: 2026-11-05
description: A correction needs a relationship to the claim it changes, and an agent needs somewhere to wait for the owner.
status: draft
---

# Memory That Can Disagree

Imagine a card that says you prefer tea. An agent later saves a card that says you prefer coffee.
Yesterday both cards looked equally true. The next agent could find either one and confidently
repeat it.

A correction needs a relationship. In v3.1.1, a new card can supersede an older one or contest it.
A superseded card stays on disk, with a pointer to its replacement. Contested cards stay visible
together. If a new fact looks close to something already saved, the server returns the candidates
and asks the caller to decide what relationship belongs there. The server calls no model to settle it.

There is another boundary. If the tea card came from you, an agent's coffee claim waits in
`_held/`. Your card stays byte for byte as it was. You can choose a winner with `resolve`, and the
losing card records the reason. The disagreement leaves a trace you can read.

Pins keep the few cards that always matter at the top. Read timestamps live beside the cards,
so asking what has gone stale never changes the evidence itself. Nothing disappears on a timer.
You decide what leaves the index.

The old cards work as they are. The new fields give a claim somewhere to stand when another claim
arrives beside it.
