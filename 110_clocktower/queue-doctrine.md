# Queue doctrine

The memory organs teach the system how to *know* things: intake pulls corpora, the carder mines them
into cards, the gate judges what goes live, the connector joins new learning to current problems.
None of that teaches the system how to *coordinate*. The moment you have more than one agent draining
the same pile of work, you have a new class of failure that no memory organ addresses. This document
names the coordination organ: a **work queue** built on the tables the stack already runs.

The design borrows one good idea from prior art: the **receipt**, a human-readable one-line record of
what an agent just did, so a person scanning the feed understands the swarm without reading its logs
(the pattern Nate Jones names in his "Open Engine" work). That idea is worth building right on the
tables you already have. Your index has a task table (`os_project_tasks`); add a receipt log beside it and the whole
queue is native to the stack, with nothing extra to stand up or keep in sync.

## What the substrate gives you, and what you add

Be honest about the footprint, because the acceptance test for this doc is that a cloner can implement
it from the template's own tables.

- **The task table ships, as `os_project_tasks`.** It has exactly the pair this queue needs:
  `status TEXT CHECK (status IN ('done','todo','in_progress','blocked'))` and a nullable
  `assigned_to TEXT`, already indexed for the null case. That pair is the entire claim-and-lock
  primitive, and everything correct about this queue rides on those two columns.

  > Read the table name carefully. This doctrine was extracted from a system where it was called
  > `tasks`, and the depersonalized schema prefixes it `os_`. Every `tasks` in the SQL below means
  > `os_project_tasks`. A cloner who pasted the old name got `relation "tasks" does not exist`.

- **There is a second task table, and it is not this one.** `os_agent_tasks` also ships, with
  `agent_id`, `parent_task_id`, `handoff_to` and a `task_type` in (`execute`, `research`, `review`,
  `handoff`, `qa`). It looks like the right home for this queue and is not: its `status` vocabulary
  is `pending / running / completed / failed / cancelled`, which does not carry `blocked`, and
  `blocked` is the state two of the six lanes below depend on. Use `os_project_tasks` for the queue
  and treat `os_agent_tasks` as the dispatch record it is, or reconcile the two vocabularies
  deliberately before you build. What you must not do is discover the overlap halfway through and
  end up with two half-queues.
- **The ledger is one table you extend or add.** `activity_log` ships, but only as
  (`action`, `details_json`, `created_at`) — enough to append to, missing every column that makes a
  receipt readable: agent, target task, autonomy rung, result. Either widen it or add a purpose-built
  log beside it. Do not stuff the receipt into `details_json`; the whole value of a receipt is that a
  human can scan the column, not parse the blob. `tool_audit` is a different concern (per-call
  telemetry) and is not the ledger.
- **The kill-switch is one row you add.** A single global flag the runner reads before it does
  anything. One boolean, one table, or a single well-known row in a settings table you already have.

No queue table. No claim service. No runtime. The queue is a *reading* of these, and the six lanes
below are encodings, not new columns.

## 0. Autonomy rungs

The receipt schema and the per-task off-ramp both key off an **autonomy rung**, so define it before
either. Three rungs, and they describe what the agent is permitted to do without a human in the loop:

| Rung | Meaning | Typical work |
|---|---|---|
| **green** | Act alone, report afterwards | Reads, analysis, local edits on a branch, anything trivially reversible |
| **yellow** | Act, then actively notify | Commits, non-destructive writes to shared state, anything a human should see the same day |
| **red** | Do not act; hold for a human | Spend, destructive migrations, outward-facing sends, credential use, anything hard to reverse |

The rung is a property of the *task*, assigned when the task is created, not something an agent
decides about itself mid-run. Store it as a column on the task table (`rung TEXT CHECK (rung IN
('green','yellow','red'))`) and stamp it on every receipt so the log shows what authority each act
was taken under.

Red is the per-task off-ramp in rule 6: runners skip red rows, and only a human moves one back to
`todo`. That is how you quarantine one dangerous task without stopping the swarm.

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

`os_project_tasks` has four states. Coordination needs six lanes. You get the extra two by pairing state
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

> **This is the one lane that needs a column.** The claim above that the six lanes are "encodings, not
> new columns" holds for five of them. Review does not: `os_project_tasks` has no dependency field
> (`os_agent_tasks` has `parent_task_id`; the queue table does not). Add
> `depends_on TEXT REFERENCES os_project_tasks(task_id)` and have step 2 skip any row whose
> dependency is not `done`. Without it, "the dependency stops the build task from reading as done" is
> a sentence with nothing behind it, and the review lane degrades into a convention that the first
> busy afternoon breaks.

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
UPDATE os_project_tasks
SET    assigned_to = :me, status = 'in_progress', updated_at = NOW()::TEXT
WHERE  task_id = :task AND assigned_to IS NULL AND status = 'todo'
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

- **Global off-ramp: the kill-switch.** One flag halts every runner at the top of the loop. The queue
  reads it first, every iteration, and fails closed if the read errors. Nothing else in this template
  defines that switch, so it is yours to create along with the queue; `030_agents/patrol/patrol.sh`
  ships the same idea at single-agent scale (`touch $STATE_DIR/DISABLED`) if you want the shape
  before you have a database to put it in.
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
