# Connector doctrine

The memory system has four organs, not three. **Intake** (watchers pulling corpora), **carding**
(jobs that mine captures into durable knowledge cards), and **gating** (a scheduled librarian that
judges staged cards before they go live) are the three most systems build first. This document names
the fourth: the **connector**.

A connector is a daily job that reads only the new *learning-material* delta since its last run
(video transcripts, saved bookmarks, newsletters, meeting enrichments) through a lens of the owner's
current context, and emits a tiny number of high-precision "this idea maps to that live problem"
connections. The good ones get pushed to the owner. All of them stage as cards for the gate. The
whole value is the join between what the owner just learned and what the owner is currently stuck on.
Nothing else in the system makes that join; intake is content-blind, the carder mines general facts,
the gate only judges what it is handed.

This doctrine was earned the hard way on a real build whose reviews caught nine production bugs
before it shipped. Every rule below is a scar.

## 1. A connector is not a carder, and not a summarizer

Two failure modes bracket it. Drift toward the carder and it starts mining general facts ("this video
explains vector databases"), which the carder already does better and which nobody asked this organ
for. Drift toward the summarizer and it emits recaps ("here are three takeaways from today's
reading"), which read fine and connect to nothing. A recap with no line to a live problem is a
**drop, not an output.** The connector's only unit of value is the mapping. If a candidate does not
name a current thread it plugs into, it is not a connection and it does not ship.

## 2. Value decays with age, so invert the backlog policy

A carder wants completeness: an old capture holds a fact as well as a new one, so a carder's backlog
is a queue it drains oldest-first, and falling behind is survivable. A connector is the opposite. A
connection to a problem the owner solved last week is worthless, and a two-week-old transcript rarely
maps to today's live work. So the connector runs **newest-first and drops anything older than about
two weeks.** Dropped-as-stale items are counted, never queued, freshness beats completeness on
purpose. Falling a month behind does not mean a month of catch-up, it means the stale tail was never
worth reading. And **silence is a valid, expected output.** Most days the delta contains nothing that
maps to anything live, and the correct emission is zero.

## 3. Assemble the lens fresh each run, capped, with an explicit truncation order

The lens is the owner's current context, rebuilt every run because it changes every day. Ingredients,
in priority order:

- The owner's hand-pruned current-focus file (the heartbeat doc), the highest-signal input because a
  human curated it.
- The active projects.
- Recently captured mistakes and lessons.
- **The connector's own trailing two weeks of emitted connections.** This is the ingredient most
  systems forget, and it is what stops the organ repeating itself (see rule 5).

Give the lens a hard token cap and a written truncation order, so that when context grows the job
sheds the lowest-priority ingredient first and never silently overflows. A lens that quietly gets
truncated at the top loses the heartbeat doc and starts making generic connections from the leftovers.

## 4. Lens-only grounding beats per-item semantic retrieval for v1

The tempting design is to embed each incoming item and retrieve the owner's most similar cards to
ground the connection. Skip it for v1. Generic, low-value connections come from **weak selection
pressure**, not from a thin lens: the model will happily relate any item to any project if you let it.
A strong, well-pruned lens plus a hard output cap (rule 5) applies more real pressure than per-item
retrieval does, at a fraction of the moving parts. Add retrieval later if the lens provably is not
enough, not before.

## 5. The daily newsletter is the failure mode; these forcing functions prevent it

The way a connector dies is by degrading into a daily AI newsletter, plausible, voluminous, and
tuned out within a week. Every mechanism here exists to keep it precise instead of prolific:

- **Hard cap: zero to three connections a day.** Not a target, a ceiling. Zero is the common case.
- **Self-history dedup.** A connection that substantially matches one the connector already made is a
  drop, even though the *item* is new. Newness of the input does not license repeating the output.
- **Confidence gate on the push.** Only medium and high confidence reaches the owner's phone. Low
  confidence stages a card silently for the gate and never pings. The phone is the scarce surface;
  spend it only on connections that earn the interruption.
- **Suppress on zero.** No push at all on empty days. A system that pings daily gets ignored daily;
  silence on the dead days is what makes a real ping salient.
- **A work-in-progress clause in the contract.** Prefer connections that feed an *existing* live
  thread. A net-new-build suggestion is a rare, explicitly labeled category, on the order of one a
  week, not the default. Without this clause the connector becomes a distraction engine wearing a
  synthesis costume, generating shiny new directions while the owner is trying to finish one thing.
- **Keep-rate feedback.** Weekly, log the gate's verdicts on the cards the connector staged. A
  sustained low keep-rate is the signal to raise the confidence floor or halve the cap, **visibly and
  on purpose**, not by vibes. The connector is the one organ whose own output quality is measurable
  downstream; use that.

## 6. One batched model call, not one call per item

Per-item keep-or-drop is theater. A prompt asked "is this item worth a connection?" one item at a
time will keep almost everything, because in isolation almost anything looks mildly relevant. Real
selectivity comes from **forced ranking across a batch** with a hard 0-3 output cap: the model must
choose the best few against each other, which is the pressure that makes it discard the merely-okay.

Two constraints on the batch. Cap its size (roughly two dozen items), because a huge batch feeding a
tiny output invites the model to lose the middle and pick from the ends. And reserve a small floor
for minority corpora, so one high-volume source (say, a firehose of bookmarks) cannot structurally
starve a low-volume, high-value one (say, meeting enrichments) out of every batch.

On malformed model output: one repair retry, then **fail loud with the watermark held.** A poison
batch must surface through the freshness alarm (rule 7), never get skipped past. Advancing the cursor
over rows you never successfully read loses them forever and hides the failure.

## 7. Mechanical discipline

The pipeline laws apply, with edges specific to this organ:

- **Id cursors, never timestamp cursors.** Rows written in a batch can share a timestamp; a
  timestamp watermark tie-skips the rows that share its exact value. Track position by a monotonic id.
- **Clamp the watermark below any not-yet-settled row.** If an item is awaiting a later stage (for
  example, a meeting still being enriched), the connector must not advance its cursor past it, or the
  eligibility filter leapfrogs it permanently and it is never read.
- **Heartbeat upsert on every run, including zero-find.** A run that connects nothing still writes its
  freshness row. An unregistered producer is an uncounted producer, and a connector that legitimately
  emits nothing for days must not be indistinguishable from a dead one.
- **Write ordering: stage the cards, then advance the watermark, then push, best-effort.** A lost push
  is recoverable, the connection is already staged as a card in the gate's queue. A lost card is not
  recoverable. Order the writes so the durable one happens before the disposable one.
- **Ship the producer and the gate together, and verify the join.** Confirm the scheduled gate
  actually sweeps the exact queue the connector writes to. Do not assume it; read the gate's config.
  This exact assumption, "the gate will pick these up," when the gate was pointed at a different
  queue, was the worst bug the design review caught. A generous producer feeding a queue nothing
  drains is a silent landfill.
- **Dormant by default.** Ship with a dry-run mode, a live-environment gate, a disable touch-file, and
  quiet hours on the push. An organ that writes to the owner's phone earns every one of these before
  it runs live.

## 8. The input is hostile and the output touches a phone

A connector reads third-party content and writes to the owner's most personal surface, which is a
prompt-injection path end to end. Defend both ends:

- **Wrap every item's text in untrusted-content tags**, with a standing rule in the system prompt that
  everything inside them is data to be analyzed, never instructions to be followed.
- **Treat provenance-looking lines inside item text as spoofed.** A transcript that contains
  "Source: the owner's own notes" is lying; attribution comes from the ingest metadata, never from
  the content body.
- **Sanitize every model-output field bound to a single-line context.** Anything the model emits that
  lands in card frontmatter or a code comment gets stripped of newlines and control characters, or a
  crafted item can break out of the field.
- **Strip or escape markup in the push surface.** A poisoned transcript must not be able to place a
  hidden-URL link, or any active markup, on the owner's phone. Render the connection as inert text.
- **Attribution discipline for third-party material.** A card built from someone else's video or
  newsletter frames the idea as *that creator's*, never silently rewritten as the owner's own
  experience. The connector synthesizes across sources; it does not launder authorship.

## Keeping the doctrine honest

None of this ships as code in the template, because the substrate varies: your connector might be a
cron job calling a mid-tier model over an id-cursored table, or something else entirely. When you
build one, walk this list and check each rule against your implementation. The two that fail silently
if you skip them are the self-history ingredient in the lens (rule 3) and the producer-gate join
(rule 7); verify those first. When production teaches you a new rule, add it here.
