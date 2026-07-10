---
name: evolve
description: The self-improvement cycle. Reviews the day's work, rates sessions, refreshes the playbook, concludes experiments, and proposes rule promotions. Run before turning in for the night. Also serves the read-only playbook view. Triggers on "/evolve", "evolve", "/playbook", "what's working?", "show me the playbook".
---

# /evolve -- Evolution Cycle

Run this at the end of the day so the assistant learns from the day's sessions. Two modes:

- **Full cycle (default)**: `/evolve` runs the phases below: harvest, learn, distill, graduate
  misses, mutate, GC, publish.
- **Playbook view**: `/evolve --status`, `/playbook`, "what's working?", or "show me the playbook"
  runs ONLY the read-only view. No writes, no mutations.

## Playbook view (read-only)

Fast check on what is working. Run these sequentially (the index serializes per session, so do not
fire them in parallel):

1. `clocktower_playbook_query` for each active domain (e.g. "session", "content"), limit 5.
2. `clocktower_strategy_query` for each active domain, min_uses 3, limit 10.

Output the top insights per domain (with confidence and use count) and the strategy rankings (avg
score, uses, win rate). If a domain has no data, say so. Be concise; highlight surprises: a strategy
scoring well above or below average, or two strategies close enough to warrant an experiment.

## Phase 1: Harvest

1. Call `clocktower_search_sessions` for today's date to find today's sessions.
2. For each, `clocktower_strategy_query` to check whether a strategy was logged and rated.
3. Present unrated sessions in a compact list and accept batch ratings ("1:4 2:3 3:5", "all 4s", or
   "skip"). Rate against the rubric below; default is not 5.
4. Call `clocktower_strategy_rate` for each rated session.

**Rubric:** 5 shipped + measured + generalizes (needs a cited outcome); 4 shipped clean, no proven
pattern; 3 shipped with rework; 2 partial; 1 blocked/abandoned. If it feels like a 5 reflexively,
drop a tier.

## Phase 1.5: Surface weekly misses

Pull this week's captured misses and review them.

1. `clocktower_recall` with `query: "MISS Domain Lesson"`, `since: "7d"`, limit 50. Cast wide.
2. Parse each result for the miss convention block (a `MISS:` headline, `Domain:`, `Lesson:`, etc.).
   Discard rows that do not match the shape.
3. Group by domain and present compactly. Ask which to dig into, dismiss, or escalate.

## Phase 2: Distill

Skip if there are fewer than 50 total knowledge entries.

**Anti-corpus guardrail: reject before promoting.** Do not persist:
- Transient self-resolved errors. If a retry worked, the lesson is the retry pattern, not the failure.
- Environment-specific one-offs (missing binaries, unconfigured creds, path mismatches). Those go in
  a setup reference, not a rule.
- Task-narrative noise (a single session's output is not a class-of-work insight).
- Negative claims about tools ("X is broken"). They harden into self-citing refusals. Capture the
  positive fix or nothing.

The correct shape is always a corrected positive lesson.

**Consolidation:** hundreds of narrow atomic entries is a failure, not a feature. For each active
project, `clocktower_knowledge_query` and look for clusters of 5+ overlapping entries. Synthesize each
cluster into one high-confidence entry via `clocktower_remember` (`source_kind: "inferred"`); leave
the originals as evidence. Keep this to 2 to 3 tool calls.

## Phase 2.5: Graduate recurring misses

Promote misses that recur enough to earn a permanent steering rule (the layer auto-injected every
session).

1. `clocktower_recall` with `query: "MISS Domain Lesson"`, `since: "30d"`, limit 200. Parse all.
2. Normalize each lesson (lowercase, strip punctuation and stopwords), group, count hits.
3. Graduation candidates = groups with 3+ hits in 30 days not already in your steering-rules file
   (grep it for any keyword from the lesson; if present, flag as reinforcement instead, the existing
   rule is not sticking).
3.5. Held-out gate: frequency proves the miss recurs, not that the proposed rule fixes it. Hold
   back the most recent hit in the group and replay it: re-read that incident's context and check
   whether an agent following the proposed rule text would have avoided that specific miss. If not,
   rewrite the rule until it would, or drop the candidate. Include the held-out case in the proposal
   as evidence. A rule that cannot win its own held-out replay is a vibe, not a rule.
4. For each candidate, present the proposed rule and ask to promote (y/n/edit). If approved, append
   it as a new bullet to the matching subsection of your steering-rules file with a surgical edit,
   never a bulk replace. Record the promotion via `clocktower_remember` for audit history.
5. Cap at 3 promotions per run.

## Phase 3: Mutate

1. Look for strategy gaps: domains with fewer than 3 logged strategies, strategies with high variance
   (some 5s, some 1s), untested combinations.
2. Propose 1 to 3 experiments via `clocktower_experiment_propose`.
3. If the data strongly and repeatedly favors a persona change, draft it and ask before applying.
   Never auto-apply an identity/soul mutation.

## Phase 3.5: Lifecycle GC

Skip if there are fewer than 100 total knowledge entries. Surface entries unreferenced for 90+ days
via `clocktower_knowledge_query` (`sort: "recent"` or `sort: "hot"`). Present them and ask to archive
(y/all/skip/pick). Archive by setting status to archived: a lifecycle state, never a hard delete.
Archived entries reactivate on recall. You can run `clocktower_knowledge_lifecycle` to do the decay
sweep in one pass. Pin load-bearing rules so they are exempt.

## Phase 4: Publish

Summarize: sessions reviewed and newly rated, misses by domain, graduations promoted vs
reinforcement-needed, distillation counts, stale entries flagged/archived, experiments
concluded/running/proposed, top insights per domain, and tomorrow's focus. Capture the report via
`clocktower_remember` (`source_kind: "inferred"`).

## Key rules

- Never auto-apply an identity mutation. Always ask.
- Be concise; this runs at end of day.
- Skip empty phases. No unrated sessions, skip Phase 1. Under the entry thresholds, skip distill/GC.
- Non-interactive mode (`--auto` or cron): skip the rating prompts and approvals; run the read-only
  and publish phases only.
