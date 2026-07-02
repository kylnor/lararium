---
name: sessions
description: Browse and resume recent conversations using index session data. Shows real session titles, summaries, and timestamps, not the raw Claude Code picker. Triggers on "/sessions", "pick up where I left off", "show my sessions".
---

# /sessions -- Session Picker

Find and resume a recent conversation with full context.

## When to trigger

- The owner says `/sessions`, `pick up where I left off`, `show my sessions`, or asks "what were we
  working on?" and wants to jump back in.
- Do NOT trigger on `/resume` or `/continue`: those are built-in Claude Code commands you cannot
  override.

## Step 1: Get the session list

Call `clocktower_list_sessions` with `limit: 15`. It returns structured rows: session id, label (the
index title or first user message), summary, relative time, message count, and a resume command.

## Step 2: Scan local transcripts for resumability

Claude Code stores each session as a JSONL on disk. Find which session ids exist on this machine:

```bash
find ~/.claude/projects -name '*.jsonl' -type f -print0 | xargs -0 -n1 basename | sed 's/\.jsonl$//' | sort -u
```

Build a set of locally-resumable ids from that output. Any id in the set can be resumed here. Any id
only in the index (not in the set) ran on another machine and its transcript is not local.

## Step 3: Display the picker

By default show only sessions in the local set. If the owner says "show all" or "include remote
ones," show the full index list with remote rows marked. Format as a clean numbered list:

```
Recent sessions:

>  1. [  5m ago]  Firewall popup fix  (50 msgs)
        Diagnosed the macOS firewall prompts...
   2. [ 12m ago]  Data pipeline build  (97 msgs)
   3. [  1h ago]  Report v3 build  (83 msgs)

   -- remote (not resumable here) --
   4. [  2d ago]  Some remote session  (12 msgs)  [transcript not on this machine]
```

Mark the most recent with `>`. Show the summary line indented when the index has one. Up to 15 rows.

## Step 4: Resume

Ask which to resume (suggest the two most recent; let the owner type a number). Confirm the picked
id is in the local set, then print (and copy) the resume command:

```bash
echo "claude --resume SESSION_ID_HERE" | pbcopy
```

Tell them: "Copied. Paste it after this session ends, or run it in another terminal." If they picked
a remote session, warn that `--resume` will likely error because the transcript is not on this
machine; they should resume from where it ran.

## Rules

- Be fast. Call the tool, format, display.
- Index titles win: sessions ended with `/end` show the chosen name.
- One index call plus one local find. The index is authoritative for what sessions exist; the find is
  authoritative for what is resumable here. Both are required.
- Already sorted newest first.
