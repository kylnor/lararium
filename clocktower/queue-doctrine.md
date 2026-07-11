# Queue doctrine

The memory organs teach the system how to *know* things: intake pulls corpora, the carder mines them
into cards, the gate judges what goes live, the connector joins new learning to current problems.
None of that teaches the system how to *coordinate*. The moment you have more than one agent draining
the same pile of work, you have a new class of failure that no memory organ addresses. This document
names the coordination organ: a **work queue** built on the tables the stack already runs, with no
second SaaS underneath it.

The design loots one good idea from prior art and refuses one bad one. The good idea is the
**receipt**: a human-readable, one-line record of what an agent just did, so a person scanning the
feed understands the swarm without reading its logs (Nate Jones' "Open Engine" builds this on Linear).
The bad idea is the dependency. A queue does not need Linear, or any external tracker, when your index
already has a tasks table and you are willing to add one append-only log. This doctrine does it native.

## What the substrate gives you, and what you add

Be honest about the footprint, because the acceptance test for this doc is that a cloner can implement
it from the template's own tables.

- **The tasks table ships.** It has, at minimum, a `status` in (`todo`, `in_progress`, `blocked`,
  `done`) and an `assigned_to` that is null until an agent takes the row. That pair is the entire
  claim-and-lock primitive. Everything correct about this queue rides on those two columns.
- **The ledger is one table you add.** An append-only action log (who, action type, target task,
  one-line summary, autonomy rung, result, timestamp) is the one audit primitive a multi-agent stack
  needs and the memory schema does not ship. It is a single table. Coordination is the reason to add
  it; add it here.
- **The kill-switch is one row you add.** A single global flag the runner reads before it does
  anything. One boolean, one table, or a single well-known row in a settings table you already have.

No queue table. No claim service. No runtime. The queue is a *reading* of these three, and the six
lanes below are encodings, not new columns.

## 1. The four failures a queue exists to prevent

Point two agents at the same shared work and four things break, in order of how fast they bite:

- **Double-claims.** Both agents read the same `todo` row and both start it. Now two runs edit the
  same files, open two branches, spend twice.
- **Lost updates.** Agent A writes its progress, Agent B overwrites it a second later having never
  seen A's write. Work vanishes with no error.
- **No audit.** Something shipped, or something broke, and there is no record of which agent touched
  which task when. The swarm is a black box.
- **No human off-ramp.** An agent hits a decision only a person should make and has nowhere to *put*
  that state, so it either guesses or hangs.

A queue fixes all four with one discipline: **claiming is a lock, every act is a receipt, and there
is always a lane that means "stop, a human owns this now."** The rest of this document is those three
sentences made precise.

## 2. The status lane: six lanes over four states

The tasks table has four states. Coordination needs six lanes. You get the extra two by pairing state
with the ledger and with the `assigned_to` lock, not by adding columns.

| Lane        | Encoding                                                                    |
|-------------|-----------------------------------------------------------------------------|
| Standing    | A standing project or list plus the action log, read together, are the feed |
| Todo        | `status = todo`, `assigned_to = null` (claimable)                           |
| Working     | `status = in_progress`, `assigned_to = <agent>` (the claim is the lock)     |
| Needs input | `status = blocked` plus a receipt `AGENT_NEEDS_INPUT`                        |
| Review      | A review task that depends on the build task, so review is itself queued work |
| Done        | `status = done` plus a receipt `AGENT_DONE`                                  |
| Human-hold  | The kill-switch is set, or the task's rung is red and it sits at `blocked`   |

Two lanes share the `blocked` state and are told apart by their receipt: "Needs input" is an agent
asking a question, "Human-hold" is a human (or a red-rung policy) freezing the row. The distinction
lives in the ledger, not in a new status value, which is the point of keeping receipts.

Review is a lane, not a flag. When work needs a second set of eyes, the builder does not mark itself
"reviewed"; it **creates a review task that depends on the build task.** Review is then just more
queued work another agent (or a human) drains, and the dependency stops the build task from reading as
done while review is outstanding.

## 3. Receipt grammar: the jewel

The receipts are the part that survives depersonalization, because they are structure, not identity. A
receipt is one row in the action log. Seven verbs cover the lifecycle:

- `AGENT_CLAIMED`: I took this task off todo.
- `AGENT_WORKING`: heartbeat while I run (also the "queue dry, still alive" beat, see rule 6).
- `AGENT_NEEDS_INPUT`: I hit something only a human should decide; I moved the task to blocked.
- `AGENT_REVIEW`: I finished a build and spawned its review task.
- `AGENT_DONE`: the task is complete.
- `AGENT_BLOCKED`: I am stuck on an external dependency, not a human decision.
- `AGENT_HUMAN_HOLD`: I observed the kill-switch (or a red rung) and stood down.

Each row carries the same fields regardless of verb: the **agent**, the **action type** (the verb),
the **target task**, a **one-line human-readable summary**, the **autonomy rung** (green = acted on
its own, yellow = acted and notified, red = held for a human), and the **result**. Reading the log in
time order *is* the ledger. There is no separate status table to keep in sync with reality, because
the log is the reality. A person scanning receipts sees "claimed, worked, needs input on the pricing
decision, held" without opening a single agent transcript.

Keep the summary one line and inert. It is written by an agent that may have read hostile third-party
content, and it lands on a human's screen; strip newlines and active markup before it goes in the row.

## 4. Claiming is a lock: use compare-and-swap

This is the one place a queue is easy to get subtly, silently wrong, so lead with the primitive that
is correct by construction. **Claim with a conditional update in a single statement:**

```sql
UPDATE tasks
SET    assigned_to = :me, status = 'in_progress'
WHERE  id = :task AND assigned_to IS NULL AND status = 'todo'
RETURNING *;
```

A row back means you own it: the database guaranteed no one else held it at the instant you wrote, and
the `WHERE` made the read and the write one atomic act. **Nothing** back means someone beat you to it,
which is not an error; you loop and pick the next todo. That is the entire concurrency story, and it is
right for any number of agents on any substrate whose update is atomic on a single row, which is every
real database.

Document the alternative only to warn against it. If a substrate genuinely cannot do a conditional
update, the fallback is **optimistic claim-then-reread**: write your name to the row, read it back, and
proceed only if you still see your name. Label it exactly what it is, **racy**: two agents can each
write their own name, each read back their own write, and both proceed, which is the lost update this
whole document exists to prevent. Optimistic is a last resort for a crippled substrate, never the
default. When you can compare-and-swap, compare-and-swap.

## 5. The runner loop

Every agent draining the queue runs the same loop. Generic, substrate-agnostic, six steps:

1. **Read the kill-switch first.** If global hold is set, write an `AGENT_HUMAN_HOLD` heartbeat and
   sleep. Nothing else happens while the switch is down. A kill-switch read that fails should fail
   *closed* (treat as held), and it should be cached briefly so the switch is not a per-iteration
   hot dependency that can wedge the loop.
2. **Pick the top claimable task**: highest-priority row with `status = todo` and `assigned_to = null`.
   Skip any task whose rung is red; that is a human's to release.
3. **Claim it atomically** (rule 4). No row back, loop to step 2.
4. **Receipt `AGENT_CLAIMED`,** then do the work.
5. **Resolve into exactly one terminal lane:**
   - Needs a human decision, set `status = blocked`, receipt `AGENT_NEEDS_INPUT`.
   - Needs review, create the review task depending on this one, receipt `AGENT_REVIEW`.
   - Complete, set `status = done`, receipt `AGENT_DONE`.
   - Externally blocked, set `status = blocked`, receipt `AGENT_BLOCKED`.
6. **Heartbeat and loop.** Write a freshness receipt every iteration, including the iterations where
   the queue was empty (rule 6), then return to step 1.

The loop never mutates a task it did not claim, which is what keeps two runners from stepping on each
other past the claim. The claim is the only contended write; everything after it operates on a row the
agent provably owns.

## 6. Off-ramps and the heartbeat

A swarm without a stop button is a liability, so the queue ships two off-ramps and one liveness signal.

- **Global off-ramp: the kill-switch.** One flag halts every runner at the top of the loop. This is the
  same switch the operations docs already describe for autonomy; the queue simply agrees to read it
  first, every iteration, and to fail closed if the read errors.
- **Per-task off-ramp: the red rung.** A single task can be frozen without stopping the swarm by
  setting its rung to red and its status to blocked. Runners skip red-rung rows; only a human moves it
  back to todo. This is how you quarantine one risky task (a spend, a destructive migration, an
  outward-facing send) while the rest of the queue keeps draining.
- **Heartbeat on every run, not only on progress.** Each loop iteration writes a heartbeat receipt
  even when the queue was dry and nothing was claimed. "Ran, found nothing" must be distinguishable
  from "died." A liveness signal that only fires when the watermark moves cannot tell you the
  difference, and a monitor watching for it will false-alarm on a legitimately idle swarm or, worse,
  stay quiet on a dead one. The empty-queue iteration is a successful run; record it as one.

## Keeping the doctrine honest

None of this ships as running code in the template, because the substrate varies: your queue might be
a handful of agents polling a Postgres tasks table, a single worker draining SQLite, or something else
entirely. What ships is the shape. When you build it, walk this list and check each rule against your
implementation. The two that fail silently if you skip them are the compare-and-swap claim (rule 4),
where the optimistic fallback will pass every test and then lose an update in production, and the
every-run heartbeat (rule 6), where an idle swarm and a dead one look identical until the day it
matters. Verify those first. When production teaches you a new rule, add it here.
