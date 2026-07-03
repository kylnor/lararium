---
name: upgrade
description: Fetch the latest template and run the upgrade interview against this stack. Reads your STACK_VERSION and the upstream CHANGELOG, applies additive-doc deltas directly, and interviews you only for structural ones. Triggers on "/upgrade", "upgrade my stack", "pull the latest template", "apply the new template version", "run the upgrade".
---

# /upgrade -- pull the latest template and apply what is new

The update-check hook told the owner a newer template exists. This skill is the other half: it goes
and gets it, then hands the actual work to the upgrade interview. It is a thin wrapper, a fetch plus a
cleanup around `UPGRADING.md`. It does **not** re-implement the upgrade rules; `UPGRADING.md` owns
them (divergence is not drift, never overwrite an owned file, translate don't transplant, skip what
they skipped). Read that file and follow it. This skill only gets the new template onto disk and gets
out of the way.

## When to trigger

- The owner says `/upgrade`, `upgrade my stack`, `pull the latest template`, `apply the new template
  version`, `run the upgrade`.
- Typically right after the session-start update nudge, but it stands alone.

## Step 1: Get the new template onto disk

Shallow-clone the upstream template to a scratch directory (a shallow clone is all you need; the
upgrade reads files, not history):

```
git clone --depth 1 https://github.com/<upstream>.git /tmp/lararium-upstream
```

`<upstream>` is already the full `owner/repo` (do not append the repo name again). It is the same
repo the update-check hook watches: the default is `kylnor/lararium`,
re-pointable by a fork in `settings.json` under `stackUpdateCheck.templateUpstream` (or the constant
at the top of `hooks/reference/update-check.js`). Read that config and use whatever it names; do not
assume the default if the owner has re-pointed it.

**If `git` is unavailable:** do not fabricate a fetch. Tell the owner to download the template zip
from the repo's front page (the green "Code" button, then "Download ZIP", or a release asset), unzip
it, and tell you the path. Then treat that unzipped folder as the fetched template and continue.

## Step 2: Run the upgrade interview

Hand off to `UPGRADING.md` with the two trees in hand: the owner's stack (the repo you are in) and the
freshly fetched template (the scratch clone). Do exactly what its interview says, in order:

1. **Establish the version gap** (`UPGRADING.md` step 0). Read the owner's `STACK_VERSION` (absent =
   v1). Read the fetched `CHANGELOG.md`. List every entry newer than the owner's version, and split
   them by class.
2. **Apply additive-doc entries directly.** Copy the listed files in, translating template names to
   the owner's renames (spheres, agents, the index) as you go. No interview for these; the changelog
   entry names the files and how to apply them.
3. **Interview only for structural entries.** For those, walk the relevant `UPGRADING.md` steps one
   question at a time. Never overwrite an owned file; only add and offer deltas.
4. **Restamp.** As the last act, overwrite the owner's `STACK_VERSION` with the newest applicable
   version. Never lower an existing stamp; if step 0 found nothing newer, report "already current" and
   stop.

The judgment calls live in `UPGRADING.md`. If this skill and that file ever seem to disagree, that
file wins. This skill is just the errand-runner.

## Step 3: Clean up

Remove the scratch clone (`rm -rf /tmp/lararium-upstream`, or the unzip path). Then close with
the same shape the interview specifies: a short checklist of what was added, what was skipped and why,
and what the owner still owns (hooks to test in a live session, rules to keep pruning).

## Degraded mode (no network)

Every piece in this stack has one. If the clone fails (no network, DNS dead, the host is down): say so
plainly and stop. Do not partially apply a half-fetched tree. The owner has two clean fallbacks:

- Point this skill at a **local copy** of the newer template they already have on disk ("upgrade from
  `~/Downloads/lararium-main`"). Skip step 1, treat that folder as the fetched template.
- Wait and re-run when the network is back. Nothing is lost: the stamp is unchanged, so the next run
  re-offers exactly the same deltas.

## Notes

- The fetch is read-only reconnaissance; nothing is written to the owner's stack until step 2, and
  even then only adds plus owner-approved deltas.
- This skill needs no index (clocktower) to work: it operates on files. If the owner skipped the
  index, `UPGRADING.md` already says to skip the pieces that depend on it and use the file-backed
  degraded modes.
