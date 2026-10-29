---
title: "Memory For The Apps"
slug: memory-for-the-apps
lane: dispatch
version: v3.1
date: 2026-10-29
description: The memory folder becomes a small local server, so the desktop and chat apps can read and write the same cards your agent CLIs do.
status: draft
---

# Memory For The Apps

v3.0 got every agent CLI pointed at the same memory files. The first question back was the right one.
What about the apps? The desktop app, the chat app on your phone. They can't read a folder on your
machine.

Now they can ask for it. `npx lararium serve` turns the memory folder into a small MCP server. It has
four tools: search, read, remember and list. The files stay the memory. The server is a doorway into
them, nothing more.

It starts local. A desktop app runs it directly on your machine, no network involved. If you want a
cloud app in on it, the server also speaks HTTP, and that needs a public HTTPS address, through a
tunnel you control. That part is optional, and it changes as the apps change, so it lives in a dated
box in the guide.

Every HTTP call needs a token. There are two. The read token can search and read. Only the write token
can remember. Rotate them with the built-in command and the old ones stop working right away, no restart.

A remembered card is never lost. If two apps write at the same instant, the worst case is a card that
is missing from the map for a moment, and the next write puts it back. The memory check shows it in
between. A card you moved out of the map on purpose stays out.

Search is plain text by default. If you want it to find things by meaning, the server can use a small
embedding model running on your own machine. It's off until you turn it on, it never sends your cards
anywhere, and if the model is missing or swapped it falls back to plain text instead of mixing answers.

You don't have to wire any of this by hand. INSTALL.md Phase 5 is a guided setup. Tell your AI "run
Phase 5" and it walks you through it, one step at a time, and ends by proving a card written in one
app shows up in another.

It needs Node 20 or newer. If you already run v3.0, nothing changes until you run Phase 5.
