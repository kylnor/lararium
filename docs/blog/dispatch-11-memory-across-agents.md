---
title: "Memory Across Agents"
slug: memory-across-agents
lane: dispatch
version: v3.0
date: 2026-10-28
description: Files are the memory, every agent CLI points at the same files, and there is a five-minute way in.
status: draft
---

# Memory Across Agents

Ask anyone who runs more than one coding agent what is still unsolved and you get the same answer.
Memory lives inside one tool. Switch to the next and it starts blank. Worse, memory that depends on
the agent remembering to save is mostly empty.

The answer in v3 is boring on purpose. Files are the memory. There is one map file and a folder of
small cards, one fact per file, and every agent CLI you use is pointed at the same files. Claude Code,
Codex and Gemini CLI each read their own instruction file, so a short block goes into each one that
says where the map is, how to search, and to write a card when corrected. One script installs it. It
adds the block once, leaves anything else in those files alone, and refuses instead of guessing when a
file looks wrong.

It fills without anyone asking: the startup and session-end hooks already carry the last conversation
forward, and the index of cards is loaded at the start of each session. Today those hooks are wired for
Claude Code. The other CLIs share the files and the block, and we say so rather than imply more.

One habit rides along. When a search finds nothing, the agent says "not found in" the places it
looked, not "it does not exist". A miss is a statement about the search.

You also do not need any of it to start. There is now a five-minute path: a map file, three folders
(notes, people, projects), one topic per file. Governance, the forge for briefs, workspaces and the
rest are labelled "when you outgrow the starter" and ship empty or as templates you edit.

If you already run a stack, `UPGRADING.md` has a v2.18 to v3.0 section. Every step only adds.
