# Memory

Memory here is files. Every agent CLI on your machine (Claude Code, Codex, Gemini CLI, whatever
comes next) is pointed at the same files, so what one agent learns the next one already knows. No
agent owns the memory and none keeps a private copy. Switch tools and nothing is lost.

This folder holds one kind of memory: **cards**, short notes about how you work, what you have
corrected, and what is true about your projects. The brain (`../brain/`) holds your durable
knowledge about people, orgs and ventures. Cards are the lessons layer: small, pushed into context
by an index, and cheap to add.

## How it fills

Memory that depends on the agent remembering to save is memory that is mostly empty. Three
sources fill it, in this order of reliability:

1. **Hooks.** The shipped session-end hook saves the last exchanges to `soul/heartbeat.md` and the
   startup hook hands them to the next Claude Code session without anyone asking. That is the
   floor.
2. **Streams.** If you stand up the index (`../clocktower/`), watchers ingest your mail, calls and
   transcripts into it and a curator proposes cards from what they find. Optional, and heavy.
3. **The agent, as a backstop.** The pointer block (below) tells every agent to write a card the
   moment it is corrected or learns a durable fact. Useful, but it is the weakest of the three:
   it fires only when the agent notices.

Hooks and streams are not wired for every CLI. Claude Code runs the shipped hooks. Other CLIs
share the files and the pointer block, and capture for them is whatever lifecycle integration you
verify yourself. Do not assume a CLI saves anything until you have watched a file change.

## The pointer block

`pointer-block.md` is a short block that says where the map is, where memory lives and how to
search it. Install copies it into the instruction files your agent CLIs read, with this stack's
real path filled in:

```
node hooks/memory-pointers.mjs . --project   # AGENTS.md and GEMINI.md inside this folder only
node hooks/memory-pointers.mjs .             # global: every folder, every session of each CLI you have
```

The project form touches nothing outside the folder. The global form writes to `~/.claude/CLAUDE.md`,
`~/.codex/AGENTS.md` and `~/.gemini/GEMINI.md` for the CLIs you have. Either way the block sits
between its own marker comments, after anything else in the file, and re-running it never
duplicates it: it finds its markers and replaces what is between them. Details are in
`INSTALL.md`.

## A card

One fact per file. The filename is the card's `name` plus `.md`.

```
---
name: prefers-short-replies
description: Jane Doe wants replies under five lines unless she asks for detail.
type: feedback
---

Jane corrected a long reply on 2026-03-02: "Just the answer, please."

**Why:** she reads on her phone between meetings.

**How to apply:** lead with the answer, offer detail in one line, do not append a summary.
```

Rules:

- `name`: kebab-case, a short sentence that states the claim. A name you can read in an index
  and know whether it applies.
- `description`: one line, specific enough to decide relevance without opening the card.
- `type`: one of `user` (who you are, how you work), `feedback` (a correction or confirmed way of
  working), `project` (something true about a piece of work, dated), `reference` (where a thing
  lives).
- Body: the fact, then `**Why:**` and `**How to apply:**` for `feedback` and `project`. A card
  that dates a claim ("as of 2026-03-02") can be checked later; a card that does not is a belief
  with no expiry.
- One fact. If a card needs "and also", it is two cards.
- Capture the corrected positive lesson, never the failure event or a negative tool claim.
  `rules/OPERATING.md` has the full anti-corpus rule.

## The index

`MEMORY.md` is the index: one line per card, newest first, in the form

```
- prefers-short-replies.md - Jane wants replies under five lines unless she asks for detail.
```

Prepend new lines. The startup hook injects the first 200 lines (about 24 KB) and drops the rest,
so an oldest-first index loses the newest card first, silently, on the day it is written.

A card with no line in the index is **pull-tier**: found by search, never pushed into context.
That is a legitimate state, but only when it is on purpose, which is what `DEMOTED.md` records.

## Eviction: DEMOTED.md

The index has a budget, so something leaves when something arrives. Leaving is relocation, not
deletion. To demote a card, remove its line from `MEMORY.md`, keep the file, and add a line to
`DEMOTED.md`:

```
- prefers-short-replies.md : one-time preference, now in the soul core
```

The reason matters because absence of a pointer used to mean two things at once: curated away, or
destroyed by a bad edit. Now a card is in exactly one of three states:

- **pointered**: has a line in `MEMORY.md`, pushed into context.
- **demoted**: no pointer, listed in `DEMOTED.md`, pull-tier on purpose.
- **orphaned**: neither. Something went wrong. Find out what before adding anything else.

If the memory server (`npx lararium serve`) is in use, it also keeps `.lararium-remembered` in this
folder: one self-checking record per card it wrote (the card carries a matching `lararium-id` line in
its frontmatter and the record holds a hash of the card's exact bytes), so it can restore an index
line that a concurrent writer dropped. Leave the `lararium-id` line in place. A card you wrote or
edited by hand is yours: once its bytes differ from what the server wrote, the server never touches it. It is not a card and not an index; leave it alone (it may be committed or
ignored, as you prefer).

`node hooks/memory-check.mjs .` reports all three, plus dangling pointers (a line for a file that
does not exist) and cards with broken frontmatter. It is read-only: it never adds a pointer,
because re-adding one would silently undo a considered demotion.

## What does not go here

Secrets and credentials. Raw transcripts and mail (those belong in an index, not in cards).
Anything you would not paste into every agent you use, because every agent can read all of it.
