---
name: curate
description: Run the memory curation pass. Triages the staging queue through the gate, dedup, conflict-check, confidence, promoting / rejecting / queueing each, then tidies the knowledge layer (consolidate, lifecycle). Triggers on "/curate", "curate memory", "process the staging queue", "tidy the brain".
---

# /curate -- the memory curation pass

Read what was gathered into staging, decide what is kept, and keep the brain tidy. Gathering is
generous and goes to staging; curation is the gate that decides what reaches the live brain. This
skill runs the pass on demand. By default the main assistant does it inline; a dedicated memory
curator agent is optional (see The pass).

## When to trigger

- The owner says `/curate`, `curate memory`, `process the staging queue`, `tidy the brain`.
- After a known gather run, or whenever the staging queue has accumulated.

## Pre-flight (main loop, cheap, do this first)

1. `clocktower_staging_review` action=list. If the queue is **empty** and the owner did not ask for a
   tidy, stop and say so: "Staging's empty. Nothing to keep. Want me to run the tidy anyway?" Do not
   dispatch an agent to do nothing.
2. If there are items (or a tidy is wanted regardless), run the pass below.

## The pass

Run it inline by default. If you keep a memory curator agent (worth it only when the queue is large
enough to bloat the main conversation), hand it this job instead, as a prompt that hands over the
job, not the answers. Either way the curator owns the judgment:

> Run your curation pass.
> 1. `clocktower_staging_review` action=list, limit 50. The gatherer decomposes generously, so the
>    queue is often larger than one page: drain it fully. After processing a page, list again, and
>    repeat until a list returns count 0. Never report "cleared" while entries remain.
> 2. For each candidate, run the gate in order: anti-corpus reject, then dedup against the live brain
>    via `clocktower_knowledge_query`, then conflict-check, then confidence gate. Produce exactly one
>    outcome per item: PROMOTE, REJECT, or QUEUE-FOR-REVIEW, each with a one-line reason.
> 3. Execute: `clocktower_staging_review` action=promote for the promotes (batch the ids),
>    action=reject for the rejects (batch the ids). Leave QUEUE items in staging untouched; they are
>    the owner's call.
> 4. Tidy: `clocktower_knowledge_consolidate` in propose mode; if there are clean near-duplicate
>    clusters, apply the safe ones and pin the survivors. Then `clocktower_knowledge_lifecycle` with
>    dry_run=true and report what would transition; only run it for real if the dry run looks right
>    and nothing canonical would be reaped.
> 5. Return a tight report: counts (promoted / rejected / queued), every QUEUE item with its conflict
>    or reason spelled out, and what the tidy touched.
>
> Hard rules: never auto-promote a candidate that conflicts with a held fact, queue it. Never promote
> low-confidence, queue it. Prefer the positive corrected lesson over the failure event. Quiet and
> exact; no sign-off.

## After the pass

1. **Surface the QUEUE items directly.** These are decisions only the owner can make: show each one,
   what it claims, what it conflicts with, why the curator would not decide it alone. This is the whole
   point of the gate; do not bury it.
2. **Update the curator's freshness cursor** so the freshness contract holds: stamp the watcher's
   `last_sync_at` to now and bump its processed count, however your index tracks watcher freshness.
3. Relay the report: counts, the queue, what was tidied. Do not pad it.

## Notes

- The curator writes to the live brain with a trusted (write/admin) token. The gatherer writes to
  staging with a staging-scoped token that cannot promote. Do not cross them.
- If the owner only wants tidying (no triage), skip the staging steps and run just steps 4 and 5.
- When a cron wrapper exists it calls this same dispatch and sets the curation watcher's freshness
  SLA (e.g. `expected_max_age_seconds=86400`). Until then the SLA stays unset.
