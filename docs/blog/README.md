# The blog source

Canonical markdown for the Lararium blog. The site (`elorati-landing/lararium/blog/build.mjs`)
reads these files and renders styled HTML; this repo is the source of truth, the site only renders.

## Two lanes

Every post declares a `lane` in its frontmatter:

- **`series`** (default if omitted): the fixed curriculum, "every layer, one at a time." Ordered by
  `order`, shown as "Part N of M." This set is stable; you rarely add to it.
- **`dispatch`**: a release note. One per shipped version, newest first, sorted by `date`. This is
  the build-in-public stream.

## The release ritual (make it a thing)

**Every version bump gets a dispatch post, written the day it ships.** It is part of the release, not
a someday. The loop:

1. Ship the change, bump `STACK_VERSION`, add the `CHANGELOG.md` entry.
2. Write a `dispatch-NN-<slug>.md` here: what changed, why it exists, what it is for. Plain language,
   not a changelog line. The lab post (`dispatch-01-the-lab.md`) is the template for tone and length.
3. Rebuild the site (`node build.mjs` in the site's `lararium/blog/`), which also regenerates
   `llms-full.txt` (the whole methodology as one agent-ingestible file).
4. Commit both repos, push the site, done.

## Frontmatter

```
---
title: "Title Case, in quotes"
slug: url-safe-slug
lane: series | dispatch        # omit for series
order: 3                       # series: position in the curriculum
version: v2.8                  # dispatch: the release it documents
date: 2026-07-11               # dispatch: sort + display, newest first
description: One sentence, the deck under the title.
status: draft | published
---
```

No em-dashes anywhere in the prose (house rule). Commas, colons, periods.
