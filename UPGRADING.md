# Upgrading, from any version (the interview)

Like the install, this is not a script. It is a prompt. An agentic stack is upgraded by an agent.

**How to run it:** open *your* stack (the repo you made from the template and have been living in)
in your assistant, give it access to a fresh copy of the newer template beside it, and say: *"Run
the upgrade interview in UPGRADING.md against my stack."* The assistant reads both trees, works out
which versions you are missing, interviews you about what you diverged on, and applies the changes.
You answer questions; it does the typing.

No upgrade breaks a lower version: the founding layers are untouched in structure, every release
only adds or extends. What a given run does depends on how far behind you are, which is exactly what
step 0 below establishes from your `STACK_VERSION` and `CHANGELOG.md`.

## The rules the assistant follows during the upgrade

- **Divergence is not drift.** The owner was *supposed* to change things: renamed spheres, their
  own soul, real cards, a pruned or re-themed agent roster. Never "fix" a divergence back toward
  the template.
- **Never overwrite an owned file.** `soul/core.md`, `now.md`, every card, every `CONTEXT.md`, and
  any agent def the owner edited are theirs. The upgrade only ADDS files and, where a shared doc
  changed (README, SCRUB), offers the delta for the owner to accept or skip.
- **Ask one question at a time.** Same as the install: a conversation, not a form.
- **Translate, don't transplant.** If the owner renamed things (spheres, agents, the index), apply
  the same renames to everything you copy in. A v2 skill that references a sphere or agent by the
  template's name should arrive speaking the owner's names.
- **Skip what they skipped.** If they never stood up the index, don't wire skills or hooks that
  depend on it; use the file-backed degraded modes instead (every v2 piece has one).

## The interview, in order

0. **Establish the version gap.** Most owners arrive here two ways: the session-start update-check
   hook noticed a newer upstream version and nudged them, and they ran the `/upgrade` skill, which
   fetched this template and invoked this interview. Either way the job is the same. Before anything
   else, read the owner's `STACK_VERSION` file
   (absent means they are on v1, predating the stamp). Read the new template's `CHANGELOG.md`. List
   every entry newer than the owner's version, in order, and tell them what you found: "you are on
   vX, these releases apply." Then split the applicable entries by class. **additive-doc** entries
   you apply directly, copy the listed files in, translating names per their renames, no interview
   needed for those. **structural** entries you walk with them using the steps below. If every
   applicable entry is additive-doc, this is a copy-and-translate pass, not an interview: do it and
   skip to the closing.
1. **Map the divergence.** Read their tree, not the template: sphere names, whether a soul exists,
   whether the index is live, what the agent roster looks like now. State what you found in three
   or four lines and let them correct you.
2. **`rules/OPERATING.md`** (the highest-leverage piece, zero infrastructure). Copy it in, then
   walk it with them section by section and delete every example steering rule that is not theirs.
   Sell the miss-capture protocol hard: it compounds from day one and needs only a markdown file.
3. **`hooks/`.** Ask which loops they want first (honest default: session-start briefing +
   heartbeat; skip voice-drift until a soul exists). Copy the chosen reference hooks, adapt the
   paths to their layout, wire them per `hooks/settings.example.json`, and run each standalone
   with a fake payload to prove it exits clean before wiring the next.
4. **`skills/`.** Copy `skills/defs/` into their skills directory. Adapt every path and tool name
   to what actually exists in their install; cut steps that reference infrastructure they skipped
   rather than leaving them to error.
5. **`clocktower/retrieval-doctrine.md`.** If their index is live, walk it as a checklist against
   their implementation and note the gaps. If not, just copy the file in for the day it is.
6. **Root docs.** Offer the v2 README, SCRUB, and INSTALL changes as diffs. If they plan to share
   or publish their own derivative, point them at [`SCRUB.md`](https://github.com/kylnor/lararium/blob/main/SCRUB.md)'s new "Going public" section and its
   warning that commit author metadata leaks identity even when files grep clean.

## From v2.18 to v3.0 (memory across agents)

Run these in order. Every step only adds, so skip any the owner declines.

1. **Copy the files in.** `memory/` (README, MEMORY, DEMOTED, pointer-block), `starter/`,
   `hooks/memory-pointers.mjs` and its test, and the changed `hooks/memory-check.mjs` and
   `hooks/reference/session-start.js`. If the owner edited either changed hook, show the diff
   and merge by hand. Optional folders: `governance/`, `forge/`, `workspaces/`,
   `docs/ops-guards.md`, offered in step 5.
2. **Cards.** If the owner already keeps notes about how they work, offer to turn up to five into
   cards (one fact per file, format in `memory/README.md`) and prepend a pointer line each to
   `memory/MEMORY.md`. Never invent a card. If they have none, leave `MEMORY.md` empty.
3. **Pointers.** Run `node hooks/memory-pointers.mjs . --check` and show the result. Then follow
   the "Point every agent at the same memory" steps in `INSTALL.md`: project scope first, global
   only on a clear yes, since global edits files outside the stack. Run the one-line test in each
   CLI they use.
4. **Check.** Run `node hooks/memory-check.mjs .`. It now reports dangling pointers, orphaned
   cards and malformed frontmatter. Fix what it names; it never edits the index for you.
5. **Optional operating shape.** Offer `governance/`, `forge/`, `workspaces/` and the ops guards
   one at a time and only where the owner feels the pain. Never scaffold a workspace in advance.
6. **Agents and the rename.** The default roster is now three plain defs in `agents/defs/`
   (`reviewer.md`, `researcher.md`, `verifier.md`), and the themed roster moved to
   `agents/examples/`. Do not touch agent defs the owner already runs; offer the three new
   ones beside them. The memory-curation skill was renamed: **`/muninn` is now `/curate`**,
   and its body changed too, so a rename alone is not an upgrade (the v2 body still has the old
   command triggers, themed-agent references and a mandatory curator dispatch). Merge instead:
   copy the new `skills/defs/curate/SKILL.md` in as `skills/defs/curate/SKILL.md`, then carry over
   anything the owner customized in their old skill (their own thresholds, source lists, schedule
   notes) by reading the old file beside the new one and asking before each carry-over. Update
   every caller of the old name (cron wrappers, watcher names, the owner's notes), then retire
   the old skill's folder with the owner's say-so, by moving it to an archive folder
   rather than deleting it. If the owner keeps a roster with their own names, keep their names.
7. **Stamp** `STACK_VERSION` as v3.0 in the closing step, as always.

## Closing

As your **last act**, update the version stamp: overwrite the owner's `STACK_VERSION` with the
version they just upgraded to (the newest applicable `CHANGELOG.md` entry). The stamp lives at the
owner's stack repo root, and the update-check hook reads that same file on its own; only if the
owner copied the hooks elsewhere and set `stackUpdateCheck.localVersionFile`, restamp the file
that key names. This is
what the next upgrade reads to know where they now stand; skip it and the next run re-offers
everything you just applied. If step 0 found no entries newer than the owner's stamp, report that they are already up
to date and stop; never lower the stamp. Then end with the same shape as the install: a short checklist of what was added, what was
skipped and why, and what the owner still owns (hooks to test in a real session, rules to keep
pruning). Then get out of the way.

---

## The v1-to-v2 delta at a glance (for the human skimming)

This table is the v1-to-v2 jump specifically, kept for anyone making that leap. The full
release-by-release ledger, including v2.1 and later, lives in `CHANGELOG.md`.

| Addition | What it is | Fastest payoff |
|---|---|---|
| `rules/OPERATING.md` | The operating-rules template: action bias, the miss-capture protocol, steering rules, strategy rating, production standards, pipeline laws. v1's soul layer said "rules live in a separate document" and never shipped one. This is it. | The miss-capture protocol, day one, no infrastructure. |
| `hooks/` | The loops: doctrine + minimal reference implementations for session-start briefing, heartbeat, voice integrity, context injection, compaction continuity, safety rails, dispatch routing. All run on plain files. | Briefing + heartbeat: the assistant remembers yesterday. |
| `skills/` | Slash-command skills: `/end`, `/handoff`, `/sessions`, `/evolve`, `/curate`, plus the doctrine for writing your own. | `/end` and `/handoff`: sessions stop evaporating. |
| `agents/examples/` | An opt-in themed roster and its re-theming interview (`RETHEME.md`). Not installed by default. | A worked example, only if you want a themed team. |
| `soul/character-craft.md` | The persona-authoring craft: archetypes, eight dimensions, tone proofs, the named failure mode. | Write a `core.md` that still works at 2am in month three. |
| `clocktower/retrieval-doctrine.md` | Seven production-earned retrieval rules. | A checklist when (or before) you build the index. |
| `LICENSE` | MIT. The template is public. | Nothing to do. |
