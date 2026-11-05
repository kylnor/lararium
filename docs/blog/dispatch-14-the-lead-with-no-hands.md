---
title: "The Lead With No Hands"
slug: the-lead-with-no-hands
lane: dispatch
version: v3.2
date: 2026-11-05
description: A dispatcher stays answerable when doing the work is beyond its reach.
status: draft
---

# The Lead With No Hands

You ask an assistant to fix something. It opens a shell and settles into the build. Then you
remember another job. Your next message waits behind the work you already gave it.

A sentence in the prompt can ask it to stay available. The shell is still there. So are the edit
tools, and the small repair that looks quicker to do than to explain to someone else.

A missing tool is a rule. A sentence in a prompt is a suggestion.

The lead in v3.2 has no shell, no edit tools and no MCP tools. It can dispatch workers, send them
messages, stop them and read the proof they return. It cannot disappear into a build because it
cannot begin one. Every job goes to a background worker, even the small ones.

Its whole job is to stay answerable. Answer the owner first. Send the work out. When a worker
returns, check the evidence and bring it back. Leave room for the next question while the first
job is still moving.

That room costs tokens. Every job becomes a subagent, and the handoff has a cost of its own.
Start with one assistant in one loop. The lead pays off when you have more than one piece of
work to keep moving at once.

This is an optional Claude Code definition. Run the install interview in a normal `claude`
session first, then copy `agents/defs/lead.md` into your agent config and run `claude --agent lead`.
The lead stays within reach because the work is elsewhere.
