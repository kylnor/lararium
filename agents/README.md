# Agents

Start with one assistant in one loop. Add a subagent only when it earns its place.

> **Canonical definitions live with your assistant's config** (one file per agent: system prompt,
> tools). This README is the *relationship* layer: when to dispatch, the validated loops, and the
> dispatch doctrine. The three definitions in `defs/` are the work; this points at them.

## The default: inline, with skills

The main assistant works inline. It sees every skill's short description up front and loads a
skill's full text only when the task calls for it (progressive disclosure). That makes a procedure
cheap to keep: the description costs a line until the day it is needed. So procedures belong in
`skills/`, not in more agents. A new agent is a second place for instructions to drift, and every
handoff to it loses detail in both directions.

## When a subagent earns its place

Four cases, and only these:

1. **Context bloat measurably hurts the one loop.** A long read-heavy job (many files, many pages)
   fills the main conversation with material it only needs the conclusion of. The subagent does the
   reading and returns a summary.
2. **Parallel work that wants throwaway fresh context.** Independent tasks that do not need each
   other's history run side by side, each in its own clean window, each in its own worktree.
3. **One agent keeps picking the wrong tool or holding conflicting instructions.** Splitting the
   job gives each side one clear instruction set. Try fixing the instructions first.
4. **Separate permissions.** A reviewer or verifier should not be able to write. Its tool list is
   Read, Grep and Glob on purpose. Bash is left out because a shell can write, and a prose rule
   against writing is not enforcement. Running tests is the builder's job; the reviewer asks for
   the output.

Review is case 4 because it must not write. Running it on a *different* model or CLI than the
builder is a bonus, not a separate reason: a second model does not share the first one's blind
spots.

Do not copy the org chart. One agent per team, per role title, or per problem type is an
organisational choice, not an architecture. If you cannot say which of the four cases an agent
serves, it should be a skill.

## The three defaults

Plain definitions, no backstory, in `defs/`:

| agent | use it for | tools |
|---|---|---|
| `reviewer` | adversarial review of a finished branch, ending in a `VERDICT` line | Read, Grep, Glob only; the builder supplies test output |
| `researcher` | read-heavy questions that return a compact answer with `file:line` or URL evidence | no edit tools; Bash and web for reading, trusted by instruction and not permission-enforced |
| `verifier` | re-proving a non-code deliverable against ground truth before it is trusted | Read, Grep, Glob only; the caller supplies command output |

Each one says where to look, what done looks like, and a self-check. That is deliberate: a persona
backstory adds tokens and no measured quality, while "where to look, what done looks like, how to
check yourself" is what changes the output.

Themed rosters (a full cast with voices and opinions) are an opt-in example, not installed by default (see "To make it yours" below).

## The validated loops (the part worth copying)
- **Build to a branch, then adversarial review, then merge.** A complex build goes: the builder
  produces a branch (no PR), the reviewer does an adversarial pass, fix the blockers verbatim, then
  merge. This catches scope and auth holes that would otherwise ship. The review report is a
  structured contract, not prose: `BLOCKERS` (each with file:line, failure scenario, specific fix,
  and a confidence), `Watch-outs` (each ticketed or consciously skipped), `Confirmed clean` BY
  DIMENSION with what was actually inspected (a dimension not checked says NOT CHECKED, never
  silence), and `Assumptions` (any claim without file:line or command-output evidence demotes here,
  never into BLOCKERS). Silence is not a verdict; evidence-free findings are not findings.
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
1. Copy the files you want from `defs/` into your assistant's agent config (in Claude Code:
   `~/.claude/agents/`, one file per agent). Start with the three; add a fourth only when a skill
   cannot do the job and you can name the case above it serves.
2. Want a themed team anyway? One complete roster is available as an opt-in example
   (`npx lararium my-stack --with-examples` puts it in `agents/examples/`, or browse it upstream).
   Its `RETHEME.md` is an interview that rebuilds it in a theme of your own. It is flavor: nothing
   in the default install depends on it.
3. If you later re-derive this layer from your own live system to share it, scrub the defs per
   [`SCRUB.md`](https://github.com/kylnor/lararium/blob/main/SCRUB.md) (upstream) first: agent prompts absorb owner specifics the same way skills do.
