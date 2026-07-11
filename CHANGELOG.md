# Changelog

A clone is a detached copy: once you make your stack from this template, nothing tells you an
upgrade exists or what it changed. This file is that signal. **Watch releases** on the upstream
template repo (GitHub: the repo's "Watch" button, "Custom" then "Releases"), and each release maps
to one entry below. When a release lands, open this file and read every entry newer than your own
`STACK_VERSION`.

Each entry is classified. **additive-doc** upgrades add or extend documents and need no interview:
copy the listed files into your stack, translating template names to your own renames as you go
(same rule as the install, a doc that references a sphere or agent by the template's name should
arrive speaking yours). **structural** upgrades add layers or change how pieces wire together: open
your stack beside a fresh copy of the new template and run the upgrade interview in `UPGRADING.md`,
which reads your `STACK_VERSION`, works out which entries below apply, and walks you through them.

---

## v2.7 (2026-07-11): additive-doc

The memory layer had four organs and no coordination story. This release adds the fifth surface: a
work queue for multiple agents draining shared work, built on the tables the stack already runs, with
no second SaaS underneath it. Doctrine only, no wired queue.

- **`clocktower/queue-doctrine.md`** (new): how to coordinate a swarm without Linear or any external
  tracker. Names the four failures a queue prevents (double-claims, lost updates, no audit, no human
  off-ramp); encodes six lanes (todo, working, needs-input, review, done, human-hold) over the tasks
  table's four states plus an append-only action log; leads with compare-and-swap as the correct
  claim primitive (one conditional `UPDATE ... WHERE assigned_to IS NULL RETURNING *`) and documents
  optimistic claim-then-reread only as an explicitly-racy fallback for substrates that cannot CAS.
  The receipt grammar (`AGENT_CLAIMED` / `WORKING` / `NEEDS_INPUT` / `REVIEW` / `DONE` / `BLOCKED` /
  `HUMAN_HOLD`, one log row each) is the loot from Nate Jones' Open Engine, kept while its Linear
  dependency is dropped. Off-ramps are the global kill-switch (read first, fail closed) and the
  per-task red rung; the runner heartbeats on every iteration including empty ones, so an idle swarm
  is distinguishable from a dead one.
- **`README.md`** and **`clocktower/README.md`**: point at the new doctrine under the memory-organs
  story.

To adopt: copy `clocktower/queue-doctrine.md` into your stack. It leans on the shipped tasks table
(`status` + `assigned_to`) and describes the two small additions it needs, an append-only action log
and a one-row kill-switch, in full, so it stands alone.

## v2.6 (2026-07-10): structural

The safety rail grows depth. Two new PreToolUse reference hooks close the two holes a prose rule
cannot: compound commands that smuggle a denied sub-command past whole-string matching, and secrets
that reach a file before anyone re-reads it.

- **`hooks/reference/bash-deny-guard.py`** (new): decomposes compound bash commands (`&&`, `||`,
  `;`, pipes, `$()`, backticks, env-var prefixes; heredoc bodies treated as data) and checks every
  sub-command against your merged settings deny patterns, plus the raw string for pipe-shaped
  patterns. Deny-only: it never auto-approves, so it can only tighten. Hook denies fire even in
  bypass-permissions sessions, which makes your deny list hold for autonomous agents. Derived from
  liberzon/claude-hooks smart-approve.py (MIT), allow path removed.
- **`hooks/reference/secret-write-guard.js`** (new): scans the content ABOUT to be written by
  Write/Edit (not the file on disk) for credential patterns (cloud keys, API tokens, private-key
  blocks, DB URLs with passwords, JWTs); returns "ask" with line numbers, never "deny" (fixtures
  exist); `.env*` basenames exempt.
- **`hooks/settings.example.json`**: both wired under PreToolUse (`Bash` and `Write|Edit` matchers).
- **`agents/defs/red-robin.md`**: the detective gains a "Case File" output contract
  (Summary / Root Cause / Evidence / Fix / Verification / Prevention), so investigations come back
  in one fixed, checkable shape.
- **`skills/defs/evolve/SKILL.md`**: rule graduation gains a held-out gate (step 3.5): before a
  recurring miss is proposed as a permanent steering rule, the most recent hit is held back and
  replayed against the proposed rule text; a rule that would not have prevented its own held-out
  case gets rewritten or dropped. Frequency proves recurrence, the gate proves the fix.
- **Apply:** copy the two new hooks to your hooks directory, merge the two `PreToolUse` blocks from
  `settings.example.json` into your settings, and take the red-robin + evolve edits (translating
  agent names if you re-themed). Test standalone first, both hooks carry their exact test command
  in the README's testing section.

## v2.5 (2026-07-02): additive-doc

The template gets a name. It was "The Agentic Stack," a description wearing a title. It is now
**Lararium**: the shrine in a Roman house where the household gods lived, kept and spoken to daily.
The name is the thesis, the soul is a household deity you talk to every day, and the agent roster is
yours to re-theme (`agents/RETHEME.md`). Bring your own gods.

- **`README.md`**: rewritten around the Lararium name, with an opening myth line, a "why this instead
  of a prompt pack" pitch, and a closing tagline. The six-layer catalog, install steps, and upgrade
  pointer are unchanged in substance. "an agentic stack" survives as the category noun (Lararium is
  one), not the title.
- **Apply:** cosmetic for an existing stack. Your README has likely diverged into your own; take the
  Lararium framing only if you are publishing a derivative and want the brand. No layer, hook, skill,
  or law changed. Nothing to wire.

## v2.4 (2026-07-02): structural

The template learns to announce its own updates. A stack on this version stops depending on you to
watch the upstream repo: it checks for a newer version itself and tells you how to apply it.

- **`hooks/reference/update-check.js`** (new): a fail-soft `SessionStart` hook. At most once a day it
  fetches the upstream template's `STACK_VERSION`, compares it numerically to your local stamp, and if
  you are behind injects one line pointing you at `/upgrade`. It treats the fetched body as untrusted
  remote input, accepting only a `^v\d+(\.\d+)*$` string and never injecting any other remote content,
  so the upstream owner cannot use it to reach into your session. Off via `updateCheck: false` or the
  `STACK_UPDATE_CHECK=off` env var.
- **`skills/defs/upgrade/`** (new): the `/upgrade` slash command. Fetches the latest template (shallow
  clone, or a local copy in degraded mode) and runs the existing `UPGRADING.md` interview against your
  stack, applying additive-doc deltas directly and interviewing you only for structural ones. A thin
  wrapper that defers to `UPGRADING.md` rather than duplicating its rules.
- **`hooks/settings.example.json`**: registers `update-check.js` as a second `SessionStart` command
  and adds the `stackUpdateCheck` config block (toggle + `templateUpstream`, re-pointable by forks).
- **`README.md`, `INSTALL.md`, `UPGRADING.md`, `hooks/README.md`, `skills/README.md`**: the upgrade
  story now leads with "your stack tells you," with Watch-releases demoted to the manual fallback.
- **Note on how you learned about this one:** stacks on v2.3 and earlier had no self-announcing hook,
  so they find out about this release the old way, via Watch-releases on the upstream repo. From v2.4
  onward, a stack that adopts the update-check hook self-announces the next release automatically.
- **Apply:** structural. Run the upgrade interview: it wires the new hook (a second `SessionStart`
  entry plus the `stackUpdateCheck` block) and adds the `/upgrade` skill, without touching your owned
  files.

## v2.3 (2026-07-02): additive-doc

The memory layer gains a named fourth organ.

- **`clocktower/connector-doctrine.md`** (new): the connector, a daily job that reads the new
  learning-material delta through a current-context lens and emits a tiny number of high-precision
  "this idea maps to that live problem" connections. Names the four memory organs: intake, carder,
  gate, connector.
- **`rules/OPERATING.md`**: four laws added to the pipelines-and-observability section (deploy before
  backfill, alert delivery vs salience, bound-the-walk startup starvation, heartbeat-is-an-upsert).
  Merge them beside your own; do not clobber your pruned steering rules.
- **`README.md`**: the clocktower layer bullet now names the four organs and points at the new doc.
- **`clocktower/retrieval-doctrine.md`**: a see-also line in the intro pointing at the connector
  doctrine as the write-path sibling.
- **Apply:** copy the connector doctrine in clean; merge the OPERATING, README, and
  retrieval-doctrine deltas.

## v2.2 (2026-07-02): additive-doc

- **`soul/character-craft.md`** (new): the persona-authoring craft, distilled character-free
  (archetypes, trait tensions, tone proofs, the named failure mode).
- **`INSTALL.md`**: Phase 2 gains the archetype question up front.
- **Apply:** copy the craft doc in; merge the INSTALL delta if you have not personalized that file.

## v2.1 (2026-07-02): additive-doc

- **`UPGRADING.md`**: reframed from a static doc into an agent-run interview.
- **`agents/RETHEME.md`** (new): the roster re-theming interview, rebuild the agents in your own
  mythology with the dispatch doctrine kept intact. Bring your own gods.
- **Apply:** copy `agents/RETHEME.md` in; adopt the new `UPGRADING.md` flow.

## v2 (2026-07-02): structural

The four-layer template became six, plus the rules half and the public-hardening pass.

- **`hooks/`** (new layer): the loops, doctrine plus minimal file-backed reference implementations
  (session-start briefing, heartbeat, voice integrity, safety rails, dispatch routing).
- **`skills/`** (new layer): session-lifecycle slash commands (`/end`, `/handoff`, `/sessions`,
  `/evolve`, `/muninn`) plus the doctrine for writing your own.
- **`rules/OPERATING.md`** (new): the conduct half of the soul split, action bias, the miss-capture
  protocol, steering rules, strategy rating, production and pipeline standards.
- **`clocktower/retrieval-doctrine.md`** (new): production-earned rules that make retrieval good.
- **`UPGRADING.md`**, **`LICENSE`** (MIT), and the public-hardening pass on `SCRUB.md`.
- **Apply:** structural. Run the upgrade interview, it adds the new layers without touching your
  owned files.

## v1 (2026-06-19): structural

Initial release: the four founding layers, `brain/`, `soul/`, `clocktower/`, `agents/`, with the
brain laws and the scoped-by-sphere shape. If your stack predates `STACK_VERSION`, you are here.
