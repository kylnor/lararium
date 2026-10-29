# Gates

A gate is a rule moved into code: a hook, a lint rule, a permission entry, a CI check. Once a
gate is proven, the prose version of the rule is deleted. This file is the registry that keeps
that honest.

## The proof rule

A gate counts only when both hold:

1. **You watched it reject a known-bad input.** Present is not the same as enforcing. Run the
   thing it should block and see it blocked.
2. **It is registered here** with its rule id, where it is enforced, and the exact command that
   re-proves it live.

Common ways a gate is present and inert: a git hook that `core.hooksPath` never points at; a
package-manager setting that an older version reads and ignores; a hook script that is not
marked executable; a CI job that only runs on a path filter the change never touches.

Re-run every re-proof command after any tool update, and on a schedule if you can.

## Registry

Empty on purpose. One row per gate, added only after the proof.

| rule id | gate | enforced at | re-proof command | last proven |
|---|---|---|---|---|

## Example row (fenced, not a real gate)

```
| no-secrets | secret scanner | git pre-commit | in a scratch repo, stage a file holding a made-up credential and try to commit it; expect: commit rejected | 2026-03-02 |
```

Run the proof in a throwaway repo, never in one you care about, and delete it after.
