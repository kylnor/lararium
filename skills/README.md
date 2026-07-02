# Skills

A skill is a reusable prompt that becomes a slash command. In Claude Code, a skill is a `SKILL.md`
file living at `~/.claude/skills/<name>/SKILL.md`. The frontmatter carries a `name` and a
`description`; the body is the instruction set the assistant follows when the skill fires. Invoking
`/end` or `/handoff` runs the matching `SKILL.md` as a prompt.

The `description` does double duty. It names the command AND it is the auto-trigger heuristic: when
the assistant sees a request that matches the phrasing in the description (the "Triggers on" list),
it can fire the skill without an explicit slash command. Write descriptions that name the real
trigger phrases, not a summary.

> **Canonical definitions live with your assistant's config**, one directory per skill under
> `~/.claude/skills/`. The files in `defs/` here are *starting points*: genericized versions of a
> working set. Copy the ones you want into your config, adapt them, delete the rest.

## The lifecycle loop this set implements

These five skills wrap the working memory of a session so nothing is lost between one conversation
and the next:

- **`/end`**: session shutdown. Writes a `SESSION_STATUS.md` state file, ends the session in your
  index with a summary, captures durable knowledge, rates the session's strategy against a rubric,
  updates project tasks, and commits and pushes the repos you touched.
- **`/handoff`**: mid-session checkpoint. Writes the durable part of the current thread to a file the
  next session auto-reads, so you can clear a heavy context and resume clean. Two keystrokes, not a
  transcript.
- **`/sessions`**: browse and resume. Lists recent sessions from the index with real titles and
  summaries (not the raw picker), cross-checks which are locally resumable, and hands back a resume
  command.
- **`/evolve`**: the nightly self-improvement pass. Rates the day's strategies, refreshes the
  playbook view, concludes finished experiments, and proposes rule promotions from recurring misses.
- **`/muninn`**: the memory-curation gate. Triages staged knowledge candidates into the live brain,
  promote / reject / queue, then tidies the knowledge layer (consolidate, lifecycle sweep).

`/end` and `/handoff` write; `/sessions` reads; `/evolve` and `/muninn` are the two maintenance
loops that keep the strategy and knowledge layers from rotting.

## The law: scrub before you share

A skill is a prompt, and prompts absorb specifics. The moment a skill touches your real life it
starts accreting client names, absolute paths, hostnames, dollar amounts, and the name of your
assistant. That is fine while it stays private. It is a leak the instant you hand the skill to
someone else. Before sharing any skill, run the same three-pass scrub the rest of this template went
through (see `../SCRUB.md`): secrets, data, identity. The cheapest leak to catch is the one you grep
for.

## Do not rewrite what already exists

There are public skill collections worth installing rather than reimplementing. The **superpowers**
collection is the notable one for engineering discipline: brainstorming, test-driven development,
systematic debugging, git worktrees, and more. Point at it, install it, use it. Do not copy its
skills into your own tree and call them yours: those collections have their own licenses and
upstreams, and republishing them strands you off the update path. Install from source; keep your own
tree for the skills that are actually yours.

## How to write your own

1. **Start from a task you repeat.** If you have typed the same multi-step instruction three times,
   it is a skill.
2. **Write the steps as instructions to the assistant**, not as documentation. Second person,
   imperative. "Find the session id, then end it with a summary" beats "the session is ended."
3. **Add trigger phrases to the description.** List the exact words you would say to invoke it. That
   list is what the auto-trigger matches against.
4. **Keep it short and load-bearing.** A skill is injected as a prompt every time it fires; padding
   is context you pay for on every run. Cut anything that is not a step.
5. **Iterate when it misfires.** If it triggers when you did not mean it to, tighten the description.
   If it does the wrong thing, fix the step that was ambiguous. Skills are prompts: they improve the
   same way prompts do.

## Tool references

These skills call `clocktower_*` MCP tools from the index layer. The full tool inventory is in
`../clocktower/mcp/tool-surface.md`. If you run the brain and soul layers without the index, the
tool calls will not resolve: read each step functionally ("end the session in your index," "capture
this finding") and wire it to whatever store you use. The skills degrade to plain checklists without
the index; they do not break.
