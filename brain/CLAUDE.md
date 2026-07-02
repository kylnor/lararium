# The Brain

A file-based knowledge store: human-navigable markdown, scoped by life sphere, indexed (not
replaced) by a database. Files are canonical. The database is the index on top of them.

This document is **Layer 0**: the map and the law. It is also the rulebook for the curator. The
rules a human follows editing the brain by hand are exactly the rules an agent enforces on a
schedule. They live here once.

---

## What goes in the brain (and what never does)

**In:** the distilled, durable, navigable layer. The people who matter, the orgs, the project
cards, the decisions, the constraints worth internalizing. Things you would actually want to open
and read.

**Never:** the cold corpora. Your emails, messages, calendar, transcripts, the raw indexed files
stay in the index (see `../clocktower/`). The brain does not copy them. A card *points at* them. The
brain is the synthesis layer; the index is the firehose underneath.

> The test for any file: would you want to read this? If it is raw data, it belongs in the corpus,
> not the brain. If it is something you *learned* from the data, it is a card.

---

## The three patterns (do not fuse them)

- **Brain** (this repo) = knowledge store. Working memory + durable knowledge, scoped by sphere.
- **Pipelines** = sequential, human-reviewed deliverable engines. Live in their own workspaces.
- **Index** = the database over these files, the relational state (tasks, goals), the cold corpora,
  and the watchers that ingest your life. Separate concern. Not retired by the brain, complemented.

---

## Spheres are the scope boundary

The brain is partitioned by life sphere. This is the unit of *scoped loading*: load only the world
the task lives in, not all of your life.

- **ventures/**: your bets, side projects, the entrepreneurial work.
- **work/**: the day job.
- **personal/**: family, health, finances.
- **infrastructure/**: the system itself, the assistant, the tooling.

Rename these to fit your life. The point is the partition, not these four exact names.

`now.md` at the root is the one file read every session regardless of sphere: the cross-cutting
heartbeat, what is hot this week anywhere.

---

## The recursive shape

Wherever a thing has a real world inside it, it gets the same shape:

```
CONTEXT.md     # what this is, who/what is in it, current focus
people/        # cards on people in this scope
orgs/          # companies / clients / entities
projects/      # knowledge cards about projects (NOT the code; code stays in git)
reference/     # constraints + knowledge to internalize, scoped here
```

A sphere uses it. A big venture inside a sphere uses it. That is the recursion. Apply the shape
**only where it is populated.** A `health/` scope does not need an `orgs/`. Never force an empty
folder.

---

## The laws (the curator enforces these; so do you)

1. **Card until it earns a folder.** A thing starts as a single card (`myproject.md`). When it grows
   its own cast and its own concerns, *promote* it to a folder with the full shape. Promotion takes
   thirty seconds. Do it when earned, not one folder sooner.
2. **Never pre-build empty folders.** A card costs nothing. Empty folders are how trees die.
3. **Shared vs local.** Someone or something that spans a sphere lives once at the sphere level with
   a `_` prefix (`ventures/_people/`, sorts to top). Scoped to one venture: lives inside it.
   **Never copy a card into two places.** Link instead.
4. **Depth cap: three folder levels, then files.** `sphere / venture / {people…} / card.md`. Want a
   fourth folder? That fourth thing is a card, not a folder.
5. **Frontmatter on every file** (`name` / `description` / `type` / `status` / `updated`) so the
   index can ingest and embed it with no new schema.
6. **Wikilinks** (`[[some-person]]`) between cards. Cheap graph, no tooling. A link to a card that
   does not exist yet is fine; it marks something worth writing.
7. **Reference vs working material.** `reference/` is constraints to internalize (voice,
   conventions, canon). Working material is input to process. Keep them structurally separate;
   mixing them in one blob degrades output.
8. **The card points at the work; it does not eat it.** A project card holds status, decisions, the
   cast, and a pointer to where the actual work lives. Brain = what you know about it. Workspace =
   the thing itself.

### Rot the curator hunts for
- Empty folders, and folders with a lone `CONTEXT.md` that never grew (demote back to a card).
- Duplicate cards for the same person/org/project across scopes (merge, keep one, link).
- Stale frontmatter (`updated` far in the past on a card about something active).
- A card that contradicts a newer card or a newer decision (flag, do not silently overwrite).
- Broken wikilinks that have gone cold for a long time (either write the target or drop the link).
- `now.md` claiming something is hot that has not moved.

> **Optional house style.** The original owner banned em-dashes as an AI tell. Keep that rule, swap
> it for your own, or drop it. It is preference, not law. Decide once and let the curator enforce
> whatever you pick.

---

## How the brain stays fed (the two jobs)

- **Gardener** (extract + distill): pulls new signal out of the cold corpora and turns it into
  cards. Generous on intake; a second pass decides what is kept.
- **Curator** (enforce + prevent rot): polices structure against the laws above. Does not generate
  knowledge; keeps it clean.

The initial bulk seed is a one-shot fan-out job, not the curator. The curator is the ongoing pass
that runs after.

---

## Where it lives + safety

- Its own git repo (diffable history of how the brain changed). Not mixed in with code.
- Backed up to at least two places.
- The index points a watcher at it, embeds it, becomes the index over the files. Files canonical,
  database as index. Nothing retired.
