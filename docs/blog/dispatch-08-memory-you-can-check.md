---
title: "Memory You Can Check"
slug: memory-you-can-check
lane: dispatch
version: v2.16
date: 2026-09-15
description: Save a preference, start a fresh conversation, and check that a correction survives.
status: published
---

# Memory You Can Check

An assistant saying it remembers something is easy. Finding that information in a fresh conversation is the useful part.

This release adds a small file diagnostic and a practical memory test. Run `node hooks/memory-check.mjs .` from your installed folder. It reports whether the standard brain files are readable and nonempty. It does not print their contents or change them.

Then follow `docs/memory-check.md`. Save a temporary preference, open a fresh conversation, and ask for it back. Change the preference and try again. Ask about something you never supplied and check that the assistant admits the gap.

These are separate checks. A readable file does not prove the assistant loaded it. Explicitly asking it to read a file does not prove a startup hook works. A short session heartbeat does not establish a complete conversation archive.

The new guide makes those boundaries visible. Start with a small memory loop you can verify, then add automatic loading and capture when you can test those too.
