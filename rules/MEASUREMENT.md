# Measurement doctrine

The no-quiet-failures release said a working state and a broken state must never produce the same
observable. This is the same law pointed at the other half of the problem: not "did it break" but
**"was it any good."** A system can pass every health check it has and still be useless, because
health checks measure whether jobs *ran* and nobody wrote the check that measures whether they
*produced anything worth having*.

Every rule below was earned by a real system reporting itself healthy while being wrong. They are
substrate-agnostic on purpose: they apply to a cron job, a watcher, a proactive digest, an agent
dispatch, and to the assistant itself.

The layer that implements the transcript-derived half of this is `../measure/`. The rest is yours to
build against your own store, which is why this document exists before the code does.

## 1. A green heartbeat proves a job ran, never that it produced

The freshness SLA in `OPERATING.md` catches a dead job. It cannot catch a live job that does
nothing, because "ran, found nothing" and "ran, and its detection is structurally broken" write the
identical heartbeat.

So grade output on its own axis. A recorder that supports three meeting platforms and silently
misses a fourth stays green forever: the trigger it needs never fires, so it never fails, so nothing
ages past an SLA it is meeting perfectly. **A liveness check cannot see a trigger that structurally
never fires.** The second axis is a claim about the output: rows written per run against what the
source plausibly holds, coverage of the population you believe you are watching, an outside probe
that asserts a known item comes back. Whatever the axis is, it has to be about the product, not the
process.

## 2. A run where every unit of work failed must exit nonzero and write no heartbeat

A batch that processed 40 items and failed all 40 did not succeed. Exit zero on that and you have
built the exact quiet failure: the job is on schedule, the heartbeat is fresh, the monitor is green,
and the output is empty.

The rule is mechanical. Count attempted and count succeeded. Zero succeeded with more than zero
attempted is a failed run: nonzero exit, no heartbeat, loud. Partial failure gets its own state and
names which half. And the inverse holds too: a producer whose very first run finds zero items must
still register its freshness row, because an unregistered producer cannot age past an SLA it never
declared, so a dead one hides as "never seen."

## 3. Every producer declares a consumer

Before you build a producer, name the thing that reads it. Not "it will be useful later." A file, a
query, a surface, a person, by name. If you cannot name one, do not build it.

This applies with full force to measurement itself, which is where it usually gets waived.
**Outcome rows nobody reads are the same disease as a digest nobody reads.** A table of scores that
no view renders and no decision consults is a producer with no consumer wearing a lab coat. The
embarrassing version, and it is common: paying to embed a corpus that no query path can return,
because the write path was built and the read path never was. Which is rule 6.

## 4. Every proactive surface gets outcome accounting, and rot counts against the producer

Anything the assistant surfaces unasked (a proposal, a digest item, a flagged risk, a suggestion)
gets a terminal state: accepted, dismissed, held, or **rotted**, meaning nobody ever touched it.

Rot is the one that matters and the one everyone omits, because it looks like the human's fault. It
is not. **Rot counts against the producer.** An item nobody read is an item that was not worth
reading, or was surfaced somewhere nobody looks, or arrived looking like the eighty items around it.
All three are the producer's problem. A generator that runs daily and rots 90% of what it files is
not "under-adopted," it is wrong, and the accounting is what makes that undeniable instead of
arguable.

Dismissal, by contrast, is a healthy state. Killing an idea on purpose is a first-class outcome; the
failure mode is items dying by neglect.

## 5. Evidence before self-report

Anything tool calls can prove is computed, never asked of a model. A model asked whether its work is
done says yes. It is not lying; it has no independent view of its own output. "I've got this now"
for the fifth time proves nothing. A command that exited zero proves something.

This is the same law the feature list runs on (state is machine-owned; a green exit code, not a
model's opinion) and the same one the Judge runs on (receipts or NOT VERIFIED). Here it applies to
grading sessions: health, finished, open loops, and satisfaction are all derivable from tool calls
and the human's own replies, so deriving them costs nothing and cannot be flattered. Pay a model
only for what evidence genuinely cannot reach, and when you do, let the derived verdict win.

## 6. Check both ends of a data flow before claiming it works

Reading the producer and asserting the consumer is the most expensive cheap mistake in this
document. The write path is easy to inspect and the read path is where the bug lives.

Trace it end to end, every time: something writes, something transforms, something queries,
something renders. Run the actual query. A pipeline can be flawlessly filling a store that no reader
can return a row from, and every check on the writing half comes back perfect.

## 7. Measure a population with the consumer's own predicate

A number can be freshly queried, correct against the database, and still describe the wrong
population.

If a surface defines its queue as "description line 1 starts with this marker," then that is the
definition. A convenient `LIKE '%marker%'` over the whole field is a different question with a
similar answer, and it will quietly include rows that merely mention the marker. Lift the predicate
from the consumer's code; never paraphrase it. When you report a count, report the predicate that
produced it.

## 8. Headless runs file proposals, never questions

A scheduled or dispatched run with no human attached must never ask anything. A question asked into
a log is a stall that looks like a completion: the job "finished," the answer never came, nobody was
in the room.

The shape that works is a queue. When an autonomous run hits a genuine judgment call, it writes a
proposal to a persistent surface a human actually reviews, with enough context to decide from, and
exits cleanly. Persistent surfaces hold state; ephemeral ones (a chat scroll, a notification) do
not, and anything routed there is gone the moment it scrolls. Route interrupts to the ephemeral
surface and everything stateful to the queue.

## 9. Satisfaction is mined, never surveyed

Do not build a thumbs-up. Do not ask "was that helpful?" Both change the thing they measure, both
get answered out of politeness, and both go unanswered exactly when the answer matters.

The signal already exists: **the human's next message.** A correction, a "perfect," a question asked
for the second time, and a conversation abandoned mid-answer are all sitting in the transcript, and
all of them are more honest than a survey because none of them was performed for the assistant's
benefit. `../measure/satisfaction.mjs` is the reference implementation.

Two disciplines make it trustworthy rather than a vanity metric. **Every verdict names the rule that
produced it**, so a wrong verdict is traceable rather than arguable. And the classifier is built to
be wrong in the *cheap* direction: bare assent, gratitude, and status reports are excluded because
counting them scores the assistant for the human's own work, and a measure that flatters is worse
than no measure.

---

## Reading the numbers without lying to yourself

Corrections are not failures. A week with more of them may be a week with more work in it. Report
counts and direction, not grades. The comparison that means something is this week against last
week, on the same predicate, with the population defined the same way. A metric you re-derive with a
new definition every time you look at it is a story, not a measurement.

And when a measurement disagrees with your sense of how things are going, the measurement is the
hypothesis to check first, not the feeling. Rule 7 exists because that check usually finds the
predicate.
