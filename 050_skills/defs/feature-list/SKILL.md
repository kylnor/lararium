---
name: feature-list
description: Scaffold a machine-gated feature list into a repo so "done" becomes a verification command that passes, not an assertion. Writes feature_list.json + scripts/verify-features.mjs grounded in the repo's real test suite. Triggers on "add a feature list", "scaffold verification", "make done machine-checkable", "wire up the feature list", "/feature-list".
---

# /feature-list -- Make "done" machine-checkable

A feature list is the harness primitive that ends the argument about whether something is finished.
Each feature carries a behavior, a verification command, and a state; the state advances to
`passing` only when the command exits zero, and a script writes that transition, not the assistant.
This skill scaffolds it into any repo, grounded in that repo's real tests. Nothing here is invented:
every verification command must point at a file that exists.

## Step 1: Learn the repo's real test setup

Find the actual test files (`__tests__/`, `tests/`, `test/`, `*.test.*`, `*.spec.*`) and read
`package.json` (or `pyproject.toml` / `Makefile`) for the real test runner and command. The verifier
is Node and shells out, so each verification must be a real command that runs in THIS repo: `npx
vitest run <file>`, `pnpm test <file>`, `pytest <file>`, `python3 test_x.py`, whatever the repo
actually uses. Confirm every path with `ls`/`find` before you write it.

## Step 2: Write scripts/verify-features.mjs

Copy `verify-features.mjs` from this skill directory into the repo's `scripts/` verbatim. It is fully
repo-relative and language-agnostic (it only reads/writes `feature_list.json` and shells out), so it
needs no edits. It just needs Node available on the machine.

## Step 3: Write feature_list.json

At the repo root. Shape:

```json
{
  "project": "<slug>",
  "note": "L8 harness primitive. State is machine-owned: only scripts/verify-features.mjs flips a feature to 'passing' (verification exited 0) or 'failing' (non-zero). Do NOT hand-edit state. 'blocked' items are human switches, skipped by the verifier. WIP=1: at most one 'active' at a time.",
  "features": [
    {
      "id": "F01",
      "behavior": "one clear sentence: the user-facing outcome",
      "verification": "a real command pointing ONLY at test files that exist",
      "state": "not_started",
      "evidence": null
    },
    {
      "id": "S01",
      "behavior": "SWITCH (human): live keys / prod creds / DNS / the demo",
      "verification": null,
      "state": "blocked",
      "blocked_on": "<who: what they must do>",
      "evidence": null
    }
  ]
}
```

Rules while authoring:
- **One shipped feature per `F0N`, mapped to the tests that actually prove it.** Group related test
  files under one behavior; do not make a feature per test file.
- **Granularity: completable in one session.** "User can add items to cart", not "implement the
  cart" (too broad) and not "add the name field to the Cart model" (too narrow).
- **No test, no fake command.** A shipped-but-untested feature is `not_started` with `verification:
  null`. Let the coverage gap show. Never point a command at a file that does not exist.
- **Human-only steps are `S0N`, state `blocked`, `verification: null`.** The verifier skips them.

## Step 4: Run it, and let it own the state

```
node scripts/verify-features.mjs            # verify all runnable features
node scripts/verify-features.mjs F03        # one feature
node scripts/verify-features.mjs --report   # print the board, run nothing
```

The script runs each command and rewrites state to `passing` (exit 0) or `failing` (non-zero). If a
command is wrong, fix the command and rerun. A feature that ends `failing` because its tests really
fail is an honest finding, often a real bug the board just caught: report it, do not paper over it.

## Step 5: Wire it in (optional, recommended)

- Session open: `node scripts/verify-features.mjs --report` so a fresh session sees what is proven.
- Finish a branch: run it before merge; do not merge with anything `failing`.

## House rules

- Touch only the two files. This skill does not write source or tests.
- Commit both files with a clear message. On a shared repo where PR is the flow, commit to a branch.
- No em-dashes in any prose you write into the files. Commas, colons, periods.
