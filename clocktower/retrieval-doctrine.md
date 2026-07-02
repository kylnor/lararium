# Retrieval doctrine

Lessons from running the index in production, written substrate-agnostic on purpose: they apply
whether your index is Postgres + pgvector, SQLite + a vector file, or something else entirely. The
schema in this template gives you storage; this document is what makes retrieval *good*. Each rule
was earned by a real degradation.

## 1. Sanitize queries before they hit full-text search

Raw user text contains characters your FTS parser treats as syntax (quotes, colons, parentheses,
boolean operators). Unsanitized, these either throw or silently change the query's meaning. Strip
or escape them at the boundary, once, in one shared function every search path calls.

## 2. Cosine similarity alone ranks badly; rerank with a lexical scorer

Embedding similarity retrieves the right *neighborhood* but orders it poorly: near-duplicates and
vaguely-related chunks crowd out the exact match. Retrieve a generous candidate set by vector, then
rerank the top N with BM25 (or any lexical scorer) against the original query. Hybrid beats either
alone, consistently, and costs milliseconds.

## 3. Recency-decay your "hot" rankings

A frequency-ranked "most used" list calcifies: whatever was hot in month one stays on top forever.
Decay the access signal (half-life on the order of weeks) so the ranking reflects what is hot now,
not what was hot cumulatively.

## 4. Guard embedder identity

Every vector in one table must come from the same model at the same dimensionality. A second model
writing into the same space does not error; similarity search just silently degrades. Store the
model name alongside the vectors, check it at write time, and refuse mismatched writes. Pick one
embedding standard, write it down (see `.env.example`), and treat changing it as a migration, not a
config edit.

## 5. Harden the recall path against partial failure

The assistant's recall call fans out across sources (knowledge, sessions, files, whatever you
index). One failing source must not fail the whole recall: catch per-source, return what you have,
and surface the failure as a flag rather than an exception. A memory system that errors when one
corpus hiccups trains its user to stop calling it.

## 6. Lock concurrent jobs

Watchers and embedding workers run on schedules; schedules overlap. Two instances of the same
watcher racing each other produce duplicate rows and torn watermarks. Every scheduled job takes a
process lock (a lockfile, an advisory lock, anything) and exits immediately if it is already
running.

## 7. Your operational scripts are production code

The one-off scripts around the index (backfills, migrations, embed jobs) touch the same data the
server does. Typecheck them in CI with the same strictness as the server. The untyped backfill
script is where the corrupting bug ships from.

## Keeping the doctrine honest

None of this ships as code in the template because the substrate varies. When you implement the
index, walk this list and check each rule off against your build. When production teaches you a new
one, add it here: the doctrine file is append-mostly, and every rule should cite a degradation you
actually observed.
