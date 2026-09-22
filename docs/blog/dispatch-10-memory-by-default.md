---
title: "Memory by Default"
slug: memory-by-default
lane: dispatch
version: v2.18
date: 2026-09-22
description: The memory hooks ship switched on, find their own folder, and survive a move.
status: published
---

# Memory by Default

We ran the install the way a stranger would: a fresh download, a person who keeps books for a
living, no patience for anything labeled optional. The interview built her a good brain. Then she
asked whether it would just remember on its own, and the honest answer was no. Memory sat in a
later phase, next to a database she was told she could skip for good. She skipped both.

Turning it on was worse. It meant approving a settings file full of hook commands, each one an
absolute path to the folder she happened to be in. Move that folder from the desktop to documents
and memory stops without a word.

So the two memory hooks now ship switched on. The template carries its own project settings, and
the commands point at the hooks relative to the project, not to your disk. The hooks work out where
the stack lives from where they sit, so the folder can move and they follow it. Say yes when Claude
Code asks whether you trust the folder, and the next conversation opens knowing the last one.

It is still a modest memory, and the interview now says so out loud: the last conversation plus
`now.md`, nothing older. What you want kept goes on a card.

One more thing from the same test. The interview tried to rename folders with a multi-line shell
command, and a new user cannot judge what they are being asked to approve. The interview now uses
file tools, or one short command at a time with a plain sentence first.
