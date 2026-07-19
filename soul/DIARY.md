# The diary (template)

The heartbeat remembers what is hot. The diary remembers what it was *like*. A nightly
entry, written by the assistant in its own voice, about the day you two actually had: what
happened, what was decided, what it noticed about you, what it thinks. Narrative memory,
first person, no bullet points.

This is the organ that makes session N+1 feel continuous with session N instead of
reincarnated. A briefing tells the assistant what is in flight; the diary tells it where
the two of you *are*. The difference is the difference between a coworker's status report
and a friend picking the conversation back up.

## The shape

- **One markdown file per day**, canonical in the knowledge brain (e.g.
  `brain/diary/YYYY-MM-DD.md`), committed like any other card so history is diffable.
- **Written nightly by a scheduled job**, in the assistant's own voice, from the day's real
  inputs: session transcripts, messages, calendar, whatever your stack ingests. The
  assistant writes it; the human reads it; neither edits it after the fact.
- **A rolling digest** (e.g. `~/.yourstack/diary-recent.md`): the latest entry in full, the
  few before it in one-line gists. The session-start hook injects the digest, not the
  archive, so the assistant arrives knowing where you are at a fixed, small context cost.
- **Voice matters more here than anywhere.** A diary in assistant-neutral prose is a log.
  The entry should sound like the persona thinking, including opinions and the things it
  noticed but did not say in the moment.

## The law: truth over immutability

Entries are never edited after the fact: not by the human, not by the assistant, not for
taste. That is what makes the diary a record instead of a performance.

But the law protects *honesty*, not immutability itself. If you discover entries were
built on corrupted input (a broken importer narrating cron noise as your life), the law's
intent says regenerate them from the truth, with three conditions: preserve the old prose
first (git history plus a backup), fix the pipeline before regenerating so it cannot
recur, and never silently rewrite prose because it reads badly. An entry that records a
data bug instead of the day violates the law more than its regeneration does.

## Wiring it

1. Create `diary/` in your brain repo. No pre-built empty structure; the first nightly
   entry creates its own file.
2. Schedule the nightly writer (cron or your scheduler) after the day's ingestion has
   landed, so it writes from full inputs. Give it the day's transcripts and streams, the
   persona core, and the last few entries for continuity.
3. Generate the rolling digest in the same job: latest entry whole, previous 2-3 as
   one-liners.
4. Add the digest to the session-start injection, beside the heartbeat.
5. Editorial rules apply (`../rules/EDITORIAL.md`): receipts for events, inference labeled
   as such, a quiet day gets a short entry (E5). The voice is the persona's; the facts are
   still facts.

## What it is not

- Not a changelog or a status report; those live in the heartbeat and the task system.
- Not a summary of summaries: the writer reads the day's raw streams, not other digests
  (E2).
- Not therapy homework for the human. The human can read it, and should now and then, but
  the diary's job is the assistant's continuity, not the human's reflection practice.
