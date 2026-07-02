# The Index ("clocktower")

The database half of the system. It does the things a pile of markdown cannot: semantic search at
scale, relational queries (tasks, goals), the big cold corpora, and the watchers that ingest your
life so the assistant comes online already knowing who you are.

**The relationship to the brain:** files are canonical, the index is the index on top of them. The
index never replaces the brain; it makes the brain searchable and adds the firehose the brain points
at. Do not copy corpora into markdown. The card points at the corpus; it does not eat it.

## Architecture (the shape to reproduce)
- **MCP server**: an HTTP (or stdio) MCP the assistant calls (`search`, `recall`, `remember`,
  session briefing, soul get/set, tasks, goals). This is how the assistant reads and writes the
  index.
- **Database**: Postgres with a vector extension (pgvector). Holds the relational state plus the
  embeddings.
- **Embeddings standard**: pick one model and one dimensionality and write it down. Everything
  embedded into the same space must use the same model, or similarity search silently degrades. Keep
  this standard in a reference card.
- **Watchers**: the ingest jobs that watch your sources (email, messages, calendar, files, the
  brain repo itself) and feed new signal into the database. A brain-watcher pulls the brain repo from
  git before each pass, so pushed edits land in the index on its normal cadence.

## What ships in this template
- The schema (tables, the vector columns).
- The MCP server config and the tool surface, **with credentials removed**.
- The watcher pattern, documented.
- The embeddings standard.

## What does NOT ship
- The database itself. You stand up an empty one.
- Any corpus, any row of real data.
- Every token, connection string, and host. See `../SCRUB.md`.

## Gotchas worth inheriting
- **Sessions may serialize.** Depending on the MCP transport, calls on a single session can queue;
  firing many index calls in parallel on one session can time the later ones out. Call sequentially,
  or use separate sessions, until you have confirmed your setup parallelizes safely.
- **Keep the serving index change-aware.** A no-op sync should write nothing, or you will churn
  history and embeddings for free.

## Watcher pattern

Watchers are the ingest layer. They run on a schedule (cron, launchd, systemd timer) and push
new signal from external sources into the database. Each watcher writes a row to `sync_state`
after every run with the watermark it processed up to and the count of items ingested.

The pattern in a single loop iteration:

1. Read `sync_state` to find last watermark (timestamp, page token, sequence number).
2. Fetch new items from source (email, messages, file tree, git log, transcript export) since
   watermark.
3. Deduplicate against rows already in the target table.
4. Insert new rows. For items that need embedding, either embed inline (small batches) or write
   to a queue and let the embedding worker pick them up.
5. Update `sync_state` watermark.
6. If nothing new: write nothing. A no-op pass must not bump the watermark or churn embedding
   history for existing rows.

The brain-watcher is a special case: it does a `git pull` on the brain repo before the ingest
pass. This means edits pushed from any session land in the index within the watcher's normal
cadence without requiring a manual sync trigger.

The Huginn/Muninn pattern overlays staging on top of a standard watcher. Huginn writes to a
staging workspace partition using the staging token (which is scoped so it cannot touch the live
knowledge base). Muninn runs a separate pass to review staged items, optionally applying
confidence scoring, deduplication, or human-in-the-loop review, before promoting to live.
Use this pattern when the source signal is high-volume and low-signal-density (e.g., email
threads, web captures) and you want a quality gate before items are searchable by the assistant.

Every watcher must declare a freshness SLA (expected max age between successful runs). The
`clocktower_watcher_status` tool surfaces these. Any watcher whose last-sync exceeds its SLA
should alert. "The watcher is running" is not the same as "the watcher is producing." Track
both.

## Extraction note (Mac / live-system pass)
This README is the architecture only. The real schema, MCP config, and watcher code live in the
original system's code repo, not in this template's source brain. Pull them from there, strip
credentials per `../SCRUB.md`, and drop them in here.
