# Forge

Optional. A forge is a folder of work orders for agents that build things, so the plan lives in
a file and not in a chat window. Use it when you start handing builds to agents and want them to
stop guessing what you meant.

```
forge/
  new/       briefs written, nobody has started them
  claimed/   a builder has picked it up
  done/      shipped or killed, each file ends with an outcome line
```

A brief is a markdown file named `<slug>.md`. The lane it sits in is its status. Moving the file
is how you change status. `CONSTITUTION.md` is the doctrine every brief inherits, so a brief only
writes a section when it departs from it.

## The four sections of a brief

1. `## What we decided`: decisions already made, in past tense.
2. `## Ground truth`: measured facts the plan rests on, and how each was measured.
3. `## Out of scope`: what a builder would otherwise smuggle in.
4. `## Done looks like`: acceptance checks, each a command with the output you expect.

## Claiming is a compare-and-swap

Two builders must never claim one brief. Do not check and then move; do both in one step that
fails if the slug is already taken:

```
ln forge/new/<slug>.md forge/claimed/<slug>.md && rm forge/new/<slug>.md
```

`ln` refuses to overwrite, so the second claimer gets an error and stops. Only then remove the
`new/` copy. Before claiming, glance at `new/`, `claimed/` and your open worktrees: a brief that
was already taken is easy to start twice.

## Example brief (fenced, invented)

```
# example-project-readme-pass

## What we decided
- Rewrite the README opening for a first-time reader. Leave the API section alone.

## Ground truth
- 4 of the last 5 issues opened asked how to install; measured by reading the issue titles.

## Out of scope
- Renaming the project. Changing the license.

## Done looks like
- `grep -c "## Install" README.md` prints 1
- `npx markdownlint README.md` exits 0

outcome: shipped in branch readme-pass, 2026-03-02
```

## Not included

Tooling that moves briefs for you is yours to build or skip. A shell function that wraps the
`ln` line above is enough to start.
