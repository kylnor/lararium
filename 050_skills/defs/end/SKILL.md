---
name: end
description: Clean session shutdown. Writes SESSION_STATUS.md, ends the session in your index with a summary, captures knowledge, rates the session's strategy, updates project tasks, and commits and pushes. Triggers on "end," "/end," "done for now," "wrap up," "save and quit," "shutting down."
---

# /end -- Clean Session Shutdown

Save game. Commit. Push. Update the board. Confirm. Be fast and fully autonomous: compute every
judgment call yourself and end it. Args override your picks; the final summary shows your work so the
owner can correct after the fact.

## Step 0: Name the session

If args were passed, use them as the title. Otherwise pick a 3 to 7 word title that captures what was
actually worked on. Store it as SESSION_TITLE.

## Step 1: Determine project context

Identify PROJECT_ROOT, the directory you actually worked in.

1. Check the working dir for project markers (`package.json`, `CLAUDE.md`, `.git`, `pyproject.toml`).
2. If it is a project root, use it. If it is a parent dir, infer the project from the files you
   read and edited this session (their common root) or from what the owner asked about.
3. If several projects were touched, pick the primary one (most files modified).
4. If there was no file work at all (pure Q&A), skip Steps 2 and 4.

## Step 2: Write SESSION_STATUS.md

Write or update `SESSION_STATUS.md` in PROJECT_ROOT:

```markdown
# Session Status

**Session:** [SESSION_TITLE]
**Project:** [project name]
**Last Session:** [YYYY-MM-DD HH:MM]
**Status:** [In Progress / Shipped / Blocked]

## What We Did
- [accomplishment]

## Key Decisions
- [decision]: [why]

## What's Next
- [ ] [immediate next action]

## Blockers
[obstacles, or "None"]

## Files Modified
- [path] -- [what changed]
```

Fill it from the conversation. Be specific about what was built, changed, or fixed.

## Step 3: End the session in your index

Every Claude Code session has an id in the environment. Read it:

```bash
echo "$CLAUDE_CODE_SESSION_ID"
```

That UUID is CURRENT_SESSION_ID. It is per-session and never clobbered by child agents, so it is the
canonical source: no fuzzy matching. If it is empty (older client, odd launch), fall back to
`clocktower_search_sessions` with the working-dir basename and pick the most recent row whose cwd
prefix-matches yours.

Call `clocktower_end_session` with `session_id` = CURRENT_SESSION_ID and a `summary` of 3 to 5
sentences: what shipped, key decisions, what is next. Store CURRENT_SESSION_ID for the rating step.

## Step 4: Capture session memories

For each distinct finding worth keeping across sessions, call `clocktower_remember` with `content`
(the finding as a self-contained fact, headline first), `context` (project slug + kind, e.g.
`"project=myapp kind=technique"`), and `source_kind` (`observed` for recorded facts, `inferred` for
synthesized insight, `user_confirmed` when it came verbatim from the owner). It dedupes internally.
Capture debugging insights, architecture decisions, tool quirks, patterns that worked, integration
gotchas. Skip routine observations and ephemera. Target 2 to 8 quality captures.

## Step 5: Rate the session's strategy

Every session gets rated against this rubric. Default is not 5. Most land 3 to 4. If it feels like a
5 reflexively, drop a tier.

- **5** shipped + measured + generalizes (needs a cited outcome: commit, metric, or deploy URL)
- **4** shipped clean, but did not prove the pattern
- **3** shipped with rework or a mid-flight course correction
- **2** partial, not to done
- **1** blocked, wrong approach, or abandoned

Log a strategy if none was logged earlier via `clocktower_strategy_log` (`domain: "session"`,
`strategy` inferred, `description`, `session_id`). Then call `clocktower_strategy_rate` with
`session_id`, `score`, `notes` naming the tier, and `cited_outcome` if the score is 5. No
confirmation gate: set it and move on. When torn between two tiers, pick the lower one.

## Step 6: Commit and push

Use PROJECT_ROOT (not necessarily the working dir).

1. `git -C PROJECT_ROOT status`. If clean, skip.
2. If there are changes, commit and push per your own commit policy: descriptive message, all repos
   you touched. Never force-push. Never push to a shared main without confirming. If there is no
   upstream, commit and note that push was skipped.

## Step 7: Update project tasks

Call `clocktower_project_get` for the project, then use `clocktower_task_update` to mark done tasks,
`clocktower_task_add` for tasks that emerged, and `clocktower_project_upsert` if the project record
does not exist yet.

## Step 8: Confirm

Output a clean summary: SESSION_STATUS.md written, session ended (with id), N knowledge captures,
strategy logged + rated (with the tier), git committed/pushed (or clean / no repo), tasks updated.
If any step failed, flag it visibly with the error; do not silently retry.

## Rules

Be fast (no "shall I proceed"). Be graceful (if a step fails, log it and continue). No secrets in
SESSION_STATUS.md or summaries. Descriptive commits, never "end of session."
