---
name: infrastructure-context
description: The infrastructure sphere. The system itself: the assistant, the index, the machines, the tooling. Where the brain reasons about its own plumbing.
type: reference
status: living
updated: 2026-01-01
---

# Infrastructure

The system itself. The assistant's identity, the index underneath it, the machines, the tooling.
This is where the brain keeps cards about its own plumbing so the durable decisions survive past any
one session.

## What is in here
- `projects/`: cards on the moving parts (the index, the assistant's identity, tooling builds).
- `machines/`: a card per machine or host you run things on.
- `reference/`: standing engineering doctrine: build conventions, cost discipline, data ownership.
- `agents/`: the relationship + when-to-use layer for your agent roster (the canonical agent
  definitions live with the assistant config, not here; this card points at them).

## The rule of thumb
Operational state that changes weekly (current bugs, model versions, live config) does not belong in
durable cards; it belongs in the workspace's own status files. The brain keeps the *decisions* and
the *architecture*, the things you would be annoyed to re-derive.
