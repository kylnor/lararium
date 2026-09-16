---
title: "The Next Session"
slug: the-next-session
lane: dispatch
version: v2.17
date: 2026-09-15
description: One shared memory location, short-session capture, and a tested path into the next conversation.
status: published
---

# The Next Session

The useful memory test starts after the conversation ends. Tell your assistant something, leave,
then start a new session and ask about it without pointing at a file.

The reference memory hooks now share one setting: `LARARIUM_ROOT`, the absolute path to your installed
stack. The session-end writer saves a short heartbeat there. The startup reader loads that same file.
The install interview explains how to wire both, and the diagnostic flags a mismatching location.

Short conversations count. One completed exchange can hold the detail you need tomorrow. The writer
also recognizes newer transcript shapes and ignores API-error replies, so a failed request does not
replace a useful memory. Atomic file replacement keeps a partial write out of the next briefing.

This remains a modest mechanism. It keeps recent user and assistant excerpts separately labeled.
It does not turn an assistant's claim into a fact, keep a full archive, or capture a turn after a
process is forcibly killed. Sessions sharing a root write the same latest heartbeat.

Use `docs/memory-check.md` to test the loop in your own installation. A passing file check is one
step. A fresh session recalling a corrected choice is the proof you are looking for.
