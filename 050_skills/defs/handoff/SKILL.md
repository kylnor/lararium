---
name: handoff
description: Write a durable session handoff to a file the next session auto-reads, then clear and resume fresh. Captures decisions, what's done, what's next, key paths, and git state. Triggers on "/handoff", "handoff", "save and reset", "checkpoint and clear", "hand this off to a fresh session".
---

# /handoff -- Save the thread, drop the weight

The problem this solves: a long session is heavy (every turn re-reads the whole transcript), but
clearing loses everything. Handoff writes the *durable* part to disk, you clear, and the next session
auto-loads the doc. Two keystrokes, feels like one command.

## Step 1: Write the handoff doc

Write the handoff file (overwrite if it exists). The path is a convention: pick your own, but your
session-start hook must read whatever you pick. This template assumes `~/.assistant/handoff.md`.

Pull from the ACTUAL session (decisions made, files touched, commands run), not a generic template.
Keep it tight: a resume brief, not a transcript.

```markdown
# Handoff -- <one-line what we're in the middle of>
_saved <YYYY-MM-DD HH:MM>, cwd <path>, branch <branch>_

## Locked decisions
- <the calls already made, so the next session doesn't relitigate them>

## Done this session
- <what shipped + where it landed (file:line, commit, deploy)>

## Next / open threads
- <the very next action, concrete enough to start cold>
- <anything waiting on the owner, or a question still open>

## State to know
- <uncommitted changes, half-finished edits, paths that matter>
- <gotchas: "X is racing the live config", "Y needs a restart to take effect">
```

Rules:
- Capture the **why** behind decisions, not just the what. The next session has zero memory of the
  conversation, only this doc.
- If there is uncommitted work, say so explicitly and where.
- Do not pad it. A good handoff is short and load-bearing.

## Step 2: Confirm

Tell the owner in one line what you captured, then point at the file:

> Doc's at `~/.assistant/handoff.md`. Clear the session; the next one auto-loads it.

You CANNOT clear the session yourself (it is a client built-in, not model-invokable). The owner does
it. The session-start hook injects the doc once on the next session, then renames it (e.g. to
`.consumed`) so it never re-surfaces. Ignore stale handoffs automatically (say, older than 6 hours).

## Notes

- This is for "keep the thread, drop the weight." If you just want to keep rolling lighter in the
  SAME session, that is a compaction, not this.
- The consumed files pile up harmlessly; ignore them or sweep them on a schedule.
