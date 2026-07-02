# Upgrading from v1

If you cloned this template before v2, here is what changed and how to adopt it without disturbing
what you already built. Nothing in v2 breaks a v1 install: the four original layers are untouched in
structure; v2 adds two new layers and three doctrine documents.

## What's new

| Addition | What it is | Adopt by |
|---|---|---|
| `rules/OPERATING.md` | The operating-rules template: action bias, the miss-capture protocol, steering rules, strategy rating, production standards, pipeline laws. v1's soul layer said "rules live in a separate document" and never shipped one. This is it. | Copy into your global `CLAUDE.md` (or equivalent), edit until every line is true of your system. |
| `hooks/` | The loops layer: doctrine + minimal reference implementations for session-start briefing, heartbeat, voice integrity, context injection, compaction continuity, safety rails, dispatch routing. v1 described these loops in `soul/README.md`; v2 ships runnable starting points. | Copy `hooks/reference/` into your assistant config, wire per `hooks/settings.example.json`, replace the file-backed stubs with your index queries as you stand them up. |
| `skills/` | Slash-command skills: the session lifecycle (`/end`, `/handoff`, `/sessions`), the self-improvement pass (`/evolve`), and the memory-curation gate (`/muninn`), plus the doctrine for writing your own. | Copy `skills/defs/*` into `~/.claude/skills/`, adapt paths and tool names to your install. |
| `clocktower/retrieval-doctrine.md` | Seven production-earned retrieval rules (query sanitization, hybrid rerank, decay ranking, embedder-identity guard, partial-failure hardening, job locks, scripts-as-production-code). | Walk the checklist against your index implementation. |
| `LICENSE` | MIT. The template is public now. | Nothing. |

## The upgrade order that pays fastest

1. **`rules/OPERATING.md`**, specifically the miss-capture protocol. It is the highest-leverage
   loop in the whole stack and it needs zero infrastructure: a markdown file of captured misses
   works on day one.
2. **`hooks/reference/session-start.js` + `session-end-heartbeat.js`.** Together they close the
   "remember yesterday" loop, and the reference versions run on plain files, no database required.
3. **`skills/defs/end` and `skills/defs/handoff`.** Session hygiene: every session ends with state
   written down instead of evaporating.
4. Everything else as your system grows into it.

## If you diverged

You were supposed to. The template is a starting shape, not an upstream you track. Cherry-pick the
documents above into your fork; do not merge blindly over your own cards, soul, or renamed spheres.
