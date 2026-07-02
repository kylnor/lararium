# Upgrading from v1 (the interview)

Like the install, this is not a script. It is a prompt. An agentic stack is upgraded by an agent.

**How to run it:** open *your* stack (the repo you made from the v1 template and have been living
in) in your assistant, give it access to a fresh copy of this v2 template beside it, and say:
*"Run the upgrade interview in UPGRADING.md against my stack."* The assistant reads both trees,
interviews you about what you diverged on, and applies the additions. You answer questions; it
does the typing.

Nothing in v2 breaks a v1 install: the four original layers are untouched in structure. v2 adds
two new layers (`hooks/`, `skills/`), three doctrine documents, and a license.

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
   or publish their own derivative, point them at SCRUB.md's new "Going public" section and its
   warning that commit author metadata leaks identity even when files grep clean.

## Closing

End with the same shape as the install: a short checklist of what was added, what was skipped and
why, and what the owner still owns (hooks to test in a real session, rules to keep pruning). Then
get out of the way.

---

## The delta at a glance (for the human skimming)

| Addition | What it is | Fastest payoff |
|---|---|---|
| `rules/OPERATING.md` | The operating-rules template: action bias, the miss-capture protocol, steering rules, strategy rating, production standards, pipeline laws. v1's soul layer said "rules live in a separate document" and never shipped one. This is it. | The miss-capture protocol, day one, no infrastructure. |
| `hooks/` | The loops: doctrine + minimal reference implementations for session-start briefing, heartbeat, voice integrity, context injection, compaction continuity, safety rails, dispatch routing. All run on plain files. | Briefing + heartbeat: the assistant remembers yesterday. |
| `skills/` | Slash-command skills: `/end`, `/handoff`, `/sessions`, `/evolve`, `/muninn`, plus the doctrine for writing your own. | `/end` and `/handoff`: sessions stop evaporating. |
| `agents/RETHEME.md` | The re-theming interview: rebuild the roster in your own mythology, doctrine kept, personas rewritten. | Not everyone wants to be Batman. |
| `clocktower/retrieval-doctrine.md` | Seven production-earned retrieval rules. | A checklist when (or before) you build the index. |
| `LICENSE` | MIT. The template is public. | Nothing to do. |
