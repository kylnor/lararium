# Agents

A roster of specialized subagents the assistant dispatches to parallelize and de-risk work. They are
a team, not worker threads: each has a defined function, a model, a tool set, and a personality. The
assistant has opinions about when to use which.

> **Canonical definitions live with your assistant's config** (one file per agent: system prompt,
> model, tools). This README is the *relationship* layer: who to dispatch for what, the validated
> loops, and the dispatch doctrine. The definitions are the work; this points at them.

## The roster by function (rename to taste)
The original system used a themed naming set. Names do not matter; the *functional coverage* does.
Make sure you have one agent for each of these jobs:

- **Build**: a fast prototyper (ship working code now), a complex/autonomous builder (owns a whole
  feature), an architect (think-before-build on the hard problems).
- **Review / quality**: an adversarial code reviewer + deploy guardian, a QA agent that hunts edge
  cases and will not sign off easily, a fast silent pattern scanner, a long-horizon strategic
  reviewer, an A/B decision analyst, and a universal Judge that re-proves any non-code deliverable
  against ground truth before it is trusted (`defs/harvey.md`; its scheduled sweep lives in
  `patrol/`).
- **Research / detective**: a deep researcher (web, returns knowledge not code), a debugger (traces
  data flows), a data-acquisition agent (scraping, APIs), a risk/threat modeler.
- **Infra / monitoring**: an infrastructure/hardware agent, a monitoring/anomaly/drift agent.
- **Adversarial / chaos**: chaos engineering, load/stress, red-team prototyping, exploratory
  edge-case testing.
- **Orchestration / memory**: the team lead (the assistant itself), a signal gatherer that writes to
  a staging area, a memory keeper that curates staging into the live brain, a curator that enforces
  the brain's laws over the files.

## The validated loops (the part worth copying)
- **Subagent-first dispatch.** Default to dispatching; work inline only by exception. It preserves
  the main context, parallelizes, and moves faster. When in doubt, dispatch.
- **Build to a branch, then adversarial review, then merge.** A complex build goes: builder produces
  a branch (no PR), reviewer does an adversarial pass (blockers / watch-outs / confirmed-clean), fix
  the blockers verbatim, then merge. This catches scope and auth holes that would otherwise ship.
- **Worktree isolation** when two or more agents touch the same repo at once. Never run parallel
  agents against one working tree.
- **Agent claims are signal, not truth.** When a review agent reports a "bug," trace the path or
  write the failing test before fixing. Verify reported success against ground truth.
- **The check is the contract.** Wherever a dispatched task's "done" CAN be an executable command,
  the brief names that command up front: exit 0 is the only pass, and the worker's summary is never
  evidence. Write checks that print WHY they fail, because the failure output is what makes the
  retry smart instead of a guess. One informed retry, then stop: a failed check gets exactly one
  fix attempt with the failure output pasted in, and if it cannot pass in two informed attempts,
  treat the spec as the broken part and amend it rather than looping. Prose acceptance criteria
  are the fallback for genuinely unexecutable judgments, and the brief says so explicitly.

## To make it yours
1. Copy the definition files from `defs/` into your assistant's agent config (in Claude Code:
   `~/.claude/agents/`, one file per agent).
2. Want your own mythology instead of this one? Run the re-theming interview in `RETHEME.md`. It
   regenerates the personas in your theme (heist crew, pantheon, plain functional names) while
   keeping the doctrine intact. Do not find-and-replace names; that keeps the old personality
   under a new name tag.
3. Keep this README as the dispatch doctrine and prune the agents you do not use.
4. If you later re-derive this layer from your own live system to share it, scrub the defs per
   `../SCRUB.md` first: agent prompts absorb owner specifics the same way skills do.
