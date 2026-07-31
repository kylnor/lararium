# Bitemporal doctrine

A memory that stores facts without time is a memory that cannot be corrected. It can only be
overwritten, and an overwritten memory has no way to answer the two questions that matter most once
a system has been running for a year: *what is true now*, and *what did I believe when I made that
call*.

This is the convention for storing anything time-dependent in your index: facts about people and
things, statuses, preferences, prices, relationships, decisions. It is written substrate-agnostic on
purpose. It applies whether your store is Postgres, SQLite, or a document database, and it is a
convention over columns rather than a library, because the moment it becomes a library you cannot
apply it to the table you already have.

No store ships in this template for it. Apply it to whatever the index layer already uses. Migration
`001_core_schema.sql` gives you storage; this document is what keeps the storage honest about time.

## 1. Four timestamps, two axes, never fewer

Two independent clocks, and collapsing them is the mistake this whole doctrine exists to prevent.

**World time** is when the fact was true out in the world.

- `valid_at`: when it started being true.
- `invalid_at`: when it stopped being true. Null means still true.

**Belief time** is when your system knew it.

- `created_at`: when the row was written.
- `superseded_at`: when the row stopped being your current belief. Null means it still is.

A person changed jobs in March and told you in July. World time says March; belief time says July.
Store one clock and you can answer either "when did this happen" or "when did I learn it," never
both, and the gap between them is exactly where wrong decisions live. If you already have a table
with a `valid_from` or an `expires_at`, extend it rather than building a second one beside it.

## 2. Supersession is an insert, never an update

When a fact changes, do not update the row. Stamp `superseded_at` on the old row, optionally point
it at its replacement, and **insert** the new one.

Update destroys belief time. It leaves you with a store that is correct today and unable to explain
a single decision from last quarter, because the evidence those decisions were made on no longer
exists. It also makes every audit unanswerable and every "why did it say that" a guess.

The cost is real and it is small: the table grows, and every read has to filter. That filter is rule
6, and it is one predicate.

## 3. Derive world time from the source record, never from a model

`valid_at` comes from the artifact the fact was extracted from: the message's sent timestamp, the
calendar event's start, the invoice date, the commit time. It never comes from a model's reading of
the prose, and it never quietly defaults to `now()`.

A model asked when something happened will produce a plausible date, confidently, from a sentence
that did not contain one. That is a fabricated timestamp entering a store whose whole purpose is
answering time questions, and it is unrecoverable later because it is shaped exactly like a real
one. Defaulting to `now()` is the same failure with better manners: every backfilled fact then
claims to have become true on the day you happened to run the import.

## 4. Precision is a field, not a rounding decision

Most real facts do not have an instant. "Sometime last spring," "before the acquisition," "as of the
Q3 report" are all the honest answer, and a timestamp column cannot hold them, so it will hold a
false instant instead.

Store the precision alongside the value:

- `valid_at_precision`: `instant | day | month | quarter | year | unknown`
- `valid_at_source`: where the timestamp came from (`message-sent`, `document-date`, `stated-in-text`,
  `inferred`, `import-default`)

Then a consumer can decide. A query that needs day precision can exclude the `year` rows instead of
being silently wrong about them, and `valid_at_source` lets you find and re-derive every fact that
entered on a weak provenance the day you improve the extractor. Without these fields, a guess and a
receipt are the same column value forever.

## 5. Supersede on semantic change, not on textual change

Two rows saying the same thing in different words are not a correction, and writing a new row for
each is how a fact store fills with a hundred restatements of one fact and no history worth reading.

Compare on the claim, not the string. Normalize, then check whether the new row contradicts,
narrows, or merely repeats the old one. A repeat updates nothing (at most a last-seen counter). A
contradiction supersedes. A narrowing (more precise time, better provenance) supersedes and records
why. Get this wrong in the other direction and it is worse: a stale executor that does not recognize
a corrected value will happily write the old one back over it on its next tick.

## 6. The two queries, and both must be one predicate

Everything above is worth nothing if reading it is hard. Two canonical queries, and they should be
the only two shapes in your codebase:

**What do I believe right now?**

```sql
SELECT * FROM facts
WHERE subject = $1
  AND superseded_at IS NULL          -- current belief
  AND (invalid_at IS NULL OR invalid_at > now());   -- still true in the world
```

**What did I believe on date D?**

```sql
SELECT * FROM facts
WHERE subject = $1
  AND created_at <= $D                                  -- I knew it by then
  AND (superseded_at IS NULL OR superseded_at > $D)     -- I had not yet corrected it
  AND (valid_at IS NULL OR valid_at <= $D)              -- it had started being true
  AND (invalid_at IS NULL OR invalid_at > $D);          -- it had not stopped
```

Put both behind one function each and never hand-write the predicate at a call site. The second
query is the one that pays for the entire doctrine: it is how you reconstruct why a decision looked
right, and it is impossible in any store that updates in place.

## 7. Never leave a type migration half-finished

The most likely way this doctrine hurts you is not a design error, it is a partial rollout.

Adding proper timestamp columns beside older text ones is a two-step change: write the columns,
then move every reader. Stop after the first step and you have a table where some rows carry a real
timestamp and some carry a string that looks like one, with readers scattered across your codebase
comparing them. Text comparison against a timestamp does not throw; it coerces, or it sorts
lexically, or it silently excludes every row of the other type. So the query runs, returns fewer
rows than it should, and reports success. That is the quiet-failure shape again, wearing a schema.

Do it in one pass: add the columns, backfill with an explicit cast and an explicit source, move every
reader, then delete the old column. Grep for the old column name before you call it done. A partially
migrated fact store is more dangerous than an unmigrated one, because it looks finished.
