# The forge constitution

Every brief inherits this. A brief does not restate these rules, it assumes them, and it writes a
section only when it is **departing** from one. Edit this to match how you actually work; every
rule below earns its place by preventing a failure you will otherwise meet.

## 1. The shape of a brief

Four sections, in this order: `## What we decided`, `## Ground truth`, `## Out of scope`,
`## Done looks like`. `Done looks like` is the one most often skipped, and a brief without it
cannot be closed honestly. A number in `What we decided` needs its measurement in `Ground
truth`, or it does not belong.

## 2. Decisions are closed, not reopened

A line under `What we decided` is closed. A builder who disagrees writes a numbered ruling in a
rulings file, with a recommendation first and one decision per line, and does not quietly build
the other thing. That file is the only channel for reopening. When a ruling lands, amend the
brief in place and say which ruling changed it.

## 3. Scope is a floor, not a ceiling

The scope is the deliverable. A builder may not narrow it because the data was bad, the API was
blocked or verification was hard. If part cannot be delivered, deliver everything else in full and
say plainly what was left out and why. Do not widen either: an addition nobody asked for is
labelled as the builder's own.

## 4. Every residual carries a disposition

Every leftover is labelled exactly one of: **CLOSED HERE** (dealt with, with evidence),
**DEFERRED TO <slug>** (a named brief that exists), or **RULING <n>** (waiting on a decision).
"Worth noting" and "we should probably" are not dispositions.

## 5. Done means proved, not built

- An acceptance check is a command with an expected output. "The route works" is not a check;
  "`curl -s localhost:3000/health` returns a `sha` equal to `git rev-parse HEAD`" is.
- Verify the transition, not the destination: a thing that was already true before the change
  proves nothing.
- A fix with no trigger armed is not a fix. If the brief adds a timer or a hook, the check proves
  it fires.
- Never verify against a value the build itself printed.

## 6. The outcome line

Every file in `done/` ends with one `outcome:` line saying what shipped and where to find it
(commit, branch, path or URL, and the date). A killed brief gets one too, saying killed and why.

## 7. The seam between new and claimed is manual on purpose

The step from writing a brief to starting a build is a human act. An automatic handoff turns
planning into an intake form. A slug lives in exactly one lane, and claiming is a compare-and-swap
(see `README.md`).

## 8. House style

- Numbers in prose carry their source and date.
- A status claim in a brief is a belief with a date. Check the repo before quoting it as current.
- Say what was measured. "Often null" spans thirty percent and one hundred percent.
- Optional: ban em-dashes in anything you publish. If you do, enforce it with a gate
  (`governance/gates.md`), not a sentence.

## 9. What a brief may not assume

- That a document written beside a build matches the build. Write the doc from the diff.
- That a merged branch is an applied migration, or a green build is a rendered page.
- That a count someone inherited was ever measured. Recount from source.

## Departing from this

A brief that must break a rule says so, names the rule by number and gives the reason. Silent
departure is the failure this file exists to prevent.
