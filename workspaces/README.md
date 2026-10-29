# Workspaces

Optional. This folder stays empty until a project earns a place in it.

## The shape: Layer 0 is a map, nothing else

The instruction file at the root of your stack (`CLAUDE.md` or the equivalent) is a **map**. It
says what the folders are and how to find things. It does not hold rules, procedures, project
detail or history. Every line in it is loaded at the start of every session, so every line costs
attention on every task. When a line is not about finding something, move it down a layer.

## A workspace is earned, not scaffolded

Do not create a folder per project up front. A project gets a folder here only after it has
come up repeatedly and a flat note stopped being enough. Until then it lives as one file in
`../brain/` or `../notes/`. Empty folders with a template inside are inventory, not progress.

When one does earn a place:

```
workspaces/<name>/
  CONTEXT.md     what this is, who it is for, current state, in under a page
  ...            only the files you actually have
```

Add subfolders when you have the files, not before.

## The docket

`docket.md` is the one list of work that has been named and not started. One line each, newest
on top. When something starts, move it to a brief (`../forge/new/`) or a workspace and delete
the docket line. If a line has sat for months, either do it or delete it.

## Search misses

A map is only useful if the agent reports honestly when it cannot find something. A search miss
is not proof the fact is absent: the index may be stale, the fact may live under another name.
The agent should say "not found in <where I looked>", never "it does not exist". If the stack has
a search index, it may hold raw evidence the files do not.
