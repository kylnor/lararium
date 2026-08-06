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

## v2.16 (2026-08-06): structural

An adversarial review of v2.15 found that the safety layer's care was concentrated where the threat
was smallest and absent where it was largest. `update-check.js` had a careful, correct defence
around a six-byte version string. Meanwhile the deny guard was bypassable three ways, the voice log
wrote every credential it ever saw to a world-readable file forever, and the one component that runs
unattended at 3am held both an unscoped shell and a live API key. This release fixes the guards and,
more importantly, stops describing them as stronger than they are.

**The confirmed bypasses.** With `Bash(rm:*)` in the deny list, all three of these were allowed:

```
grep "a<<b" notes.txt \n rm -rf /important     ALLOWED
python3 -c "print(1 << 2)" \n rm -rf /...      ALLOWED
/bin/rm -rf /important                         ALLOWED
```

The first two are one bug: heredoc detection was a regex over raw lines, so a `<<` inside a quoted
string opened a phantom heredoc and swallowed every line after it as "data". The third is prefix
matching against a spelling. `040_hooks/README.md` described the first as a *strength* ("heredoc
bodies correctly treated as data"), which is the part that actually matters — a user who believes a
guard is a wall grants autonomy they otherwise would not.

**Walls, fences, and speed bumps.** The new section at the top of `040_hooks/README.md` names the
three tiers and says plainly which hook is which. Only capability removal is a wall. Command
analysis is a fence: it cannot resolve `$VAR`, aliases, functions, or the contents of a script it
invokes, because those are runtime facts and a PreToolUse hook runs before runtime. Better parsing
does not fix that, so the enforcement moved instead.

- **`040_hooks/reference/bash-deny-guard.py`**: rewritten. Real tokenization (stdlib `shlex`, POSIX
  quoting), so a `<<` inside quotes is a character in a word and the heredoc class dies
  structurally. Binary normalization before matching, so `/bin/rm`, `\rm`, `command rm`,
  `env FOO=1 rm`, `sudo rm`, `busybox rm` and `timeout 5 rm` all resolve to `rm`. Spawn-capable
  shapes (`git -c`, `find -exec`, `npm run`, any interpreter) escalate to "ask". **Fails closed**:
  an unparseable command is denied, not skipped. Never emits "allow". Override with
  `LARARIUM_GUARD=off`, which does not disable your deny list.
- **`040_hooks/sandbox/`** (new): the actual wall. A `sandbox-exec` profile plus a fail-closed
  wrapper, blocking credential stores, the assistant's own auth, `~/.claude/hooks` and
  `settings.json` (so a session cannot edit the guard that governs it), shell startup files and
  system paths. The kernel checks the resolved path, so `cat ~/.ssh/config`, `/bin/cat "$HOME/..."`,
  a Python one-liner, and `X=~/.ssh; ls $X` all fail identically — including the last one, which the
  fence cannot see at all.
- **`030_agents/patrol/patrol.sh`**: credentials and shell are now mutually exclusive. Subscription
  auth means no key in the environment and `PATROL_SHELL=1` is permitted; key auth means the shell
  is off and cannot be enabled. A key that is not in the environment cannot be exfiltrated by a
  command nobody anticipated. Its docket is also wrapped in `<untrusted-docket>` markers, per
  `110_clocktower/connector-doctrine.md`, which had the right answer written down and was not
  applied to the one process that runs alone.
- **`040_hooks/reference/secret-patterns.js`** (new): one source of truth. `secret-write-guard.js`
  asked before a credential reached a repo; `voice-log.js` then wrote every prompt and response to
  disk verbatim, forever, at default permissions. A rule enforced in one place and ignored in
  another is not a rule.
- **`040_hooks/reference/voice-log.js`**: redacts before writing, caps at 500 records, `0600`.
- **`040_hooks/reference/secret-write-guard.js`**: also matches Bash — `cat > f <<EOF ... EOF` put a
  key on disk without touching the Write tool. Re-register it as `Write|Edit|Bash`.
- **`040_hooks/reference/pretooluse-guard.js`**: `rm --recursive --force /`, `rm -rf "$HOME"`,
  `git push origin +main`, and `curl x | zsh` now match. Relabelled as defence in depth.
- **`040_hooks/reference/agent-model-router.js`**: stops emitting `permissionDecision: "allow"`,
  which was silently auto-approving every dispatch it touched. Routing is not authorization.
- **`040_hooks/reference/session-start.js`**: injected blocks other than the soul core are wrapped
  in `<untrusted-context>`. This hook's stdout goes straight into the model and those files are fed
  by watchers and by the previous session's transcript.
- **`npx/index.js`**: fails closed when the release lookup fails instead of silently installing
  unreviewed HEAD. Adds `--ref main` as the explicit opt-in; timeout 4s → 10s.
- **`040_hooks/reference/tests/`** (new): 103 cases across three suites. Every bypass above is
  pinned as a regression, because a guard without a corpus regresses silently, which is the exact
  failure mode this layer exists to prevent.
- **`docs/teams-ingestion-setup.md`**: recommendation flipped from app-only to delegated. The old
  version recommended `Chat.Read.All` + `ChannelMessage.Read.All` tenant-wide — every message in the
  organization, into a personal knowledge base on a laptop — and framed the admin-consent
  requirement as a hurdle to clear rather than a signal. New section 2.0 covers scoping (application
  access policies, RSC), consent from people rather than just from Entra, and retention.
- **Fixed from the unreleased path refactor**: runtime paths were rewritten alongside repo paths, so
  the docs told users to install hooks to `~/.claude/040_hooks/stack/`, where Claude Code will never
  look for them, and `secret-write-guard.js` checked its own exemption against `/.claude/040_hooks/`.

**Upgrade:** structural, but the interview is short — the hook files are drop-in replacements. Two
things need your hands: re-register `secret-write-guard.js` as `Write|Edit|Bash`, and decide whether
to adopt `040_hooks/sandbox/`. If you run `patrol.sh`, check which auth mode you are on before the
next scheduled run; on key auth it will now refuse to start with `PATROL_SHELL=1`.

## v2.15 (2026-08-01): additive-doc

Optional skill: **`050_skills/defs/model-fusion/`**, multi-model routing across the AI CLIs you
already pay subscriptions for (Claude, Codex, Gemini, Grok), with your assistant as the one spine
that synthesizes. Extracted from a working install the day after its adversarial review, so the
sharp edges ship pre-hit: the runner (`fusion-run.mjs`) closes stdin on the Codex child (it hangs
forever on an open pipe), passes the headless trust flags both Codex and Gemini require, strips
every metered billing key from child environments, and runs critics read-only in fusion mode. The
SKILL.md carries the doctrine: subscription-auth-only premise, the dated Gemini
personal-OAuth-is-dead finding and the no-billing-account free-key pattern that answers it, the
synthesis contract (the panel renders for the assistant; the owner never reads raw legs), and the
auth-drift lesson (subscription auth can silently degrade to metered; probe the auth-mode files
structurally and alarm through your freshness monitor). Skip this skill entirely if you only run
one model CLI; it earns its place the day you hold two subscriptions.

- **`050_skills/defs/model-fusion/SKILL.md`**: routing, synthesis contract, safety rails, sharp edges.
- **`050_skills/defs/model-fusion/fusion-run.mjs`**: the runner. `FUSION_<PROVIDER>_BIN` overrides,
  `FUSION_TIMEOUT_MS`, `GEMINI_FUSION_API_KEY` injected per child only.
- **`050_skills/README.md`**: gains the beside-the-lifecycle note for optional skills.

## v2.14 (2026-07-27): additive-doc

The safety rail was only ever documented as a safety rail, so nobody learned it is also where a
personal working rule gets enforced. Found through a recipient of an early pre-install drop whose
complaint was "my memory is broken": a rebase reminder kept arriving two or three turns after the
merge. Memory was fine. Recall is triggered by relevance scoring over recent turns, so it always
trails the action, and with no PreToolUse rule there was nothing to fire first. A prose rule has no
enforcement point; that is not a memory bug, it is a missing hook.

- **`040_hooks/reference/pretooluse-guard.js`**: the `RULES` array opens with a reserved block for your
  own protocol, shipping **empty** with a capture protocol rather than a questionnaire. The
  doctrine: nobody can enumerate their own rules cold, people only recognize one being violated, so
  do not try to write the block up front. Wait for the next reminder that lands after the fact,
  when both halves are already in hand (the command just run is the regex, the reminder text is the
  reason), and paste it in. Each late reminder is a free pre-worded rule that fires late exactly
  once. A guessed rule is worse than an empty one: the first time it fires on something the owner
  wanted, they conclude the guard became a nag and remove it, and one wrong rule poisons trust in
  the whole mechanism.
- **`040_hooks/README.md`**: loop (f) gains the same, plus why a recalled rule is structurally always
  late. Ship it empty and let the misses write it.
- **Rename recovery.** `templateUpstream`, the local-stamp default, and the `/upgrade` scratch
  paths still said `agentic-stack` in `settings.example.json`, `update-check.js`, `040_hooks/README.md`,
  and `050_skills/defs/upgrade/SKILL.md`. The fix was written on `feat/npx-scaffolder` on 2026-07-02 and
  never merged (the `npx/` directory landed on main by another route, these hunks did not). Live
  behaviour was unaffected because GitHub redirects renamed repos on raw fetches too, verified, but
  it was exactly the map-vs-territory drift v2.13 was about, sitting in the config example.
- **Copy-in:** take the new block from `pretooluse-guard.js` (or just paste your own rules above the
  stock ones, the block is only comments). Re-point `templateUpstream` if you had copied the old
  default. No interview.

---

## v2.13 (2026-07-21): additive-doc

The no-quiet-failures release. A retrieval search returned nothing because its embedding layer
was down: the error was caught, resolved to null, and the corpus was reported as searched
anyway, so a broken search and an empty search produced the identical answer. That is a class
of bug. This release names it and scrubs the same rot out of the template's own docs.

- **`110_clocktower/mcp/tool-surface.md`**: removed 14 tool rows pointing at tools no longer in the
  surface (dead, suppressed, or ghost registry entries), the exact map-vs-territory drift the
  doctrine warns about. Rewrote the stale capture/staging prose to the real flow
  (`clocktower_remember` writes; staging-scoped writes wait; `clocktower_staging_review`
  triages list/promote/reject). Added a caveat: if a semantic recall returns unexpectedly
  empty, check the embedder is actually running, because a dead embedder can return nothing
  while claiming it searched.
- **`110_clocktower/README.md`**: repointed the watcher-freshness reference at `clocktower_status`,
  the tool that actually surfaces per-watcher SLA health.
- **`docs/blog/dispatch-06-no-quiet-failures.md`** (new): the dispatch. A working state and a
  broken state must never produce the same observable. Five rules: errors never become empty
  successes, partial failure names which half, producers heartbeat on success, every critical
  capability gets an outside probe, and the map matches the territory.

---

## v2.12 (2026-07-19): additive-doc

Three additions: two from the same study that produced v2.11 (aimed at generated prose and
review reports, the outputs that drift quietest), and one organ the template should have
shipped with from the start.

- **`020_rules/EDITORIAL.md`** (new): the editorial constitution, a versioned, numbered law
  (E1-E10 defaults) for every surface where the assistant synthesizes prose from your data:
  briefings, digests, knowledge cards, audit reports. Every synthesis prompt cites the
  version; drift gets flagged by rule number ("violates E3"), and recurring drift patches
  the rule so every citing prompt inherits the fix. Includes anti-inflation (one source =
  at most one output line), themes-need-three, no-synthesis-of-synthesis, epistemic labels
  (firm finding / inference / open question), and scope honesty.
- **`030_agents/README.md`**: the build-then-adversarial-review loop's report format is now a
  structured contract: blockers carry file:line, failure scenario, fix, and confidence;
  confirmed-clean is reported BY DIMENSION with what was actually inspected (NOT CHECKED is
  said out loud, never implied by silence); evidence-free claims demote to an Assumptions
  section and can never sit in blockers.
- **`010_soul/DIARY.md`** (new): the assistant's diary. A nightly first-person entry in the
  persona's voice, canonical in the brain repo, plus a rolling digest (latest entry whole,
  prior few as gists) injected at session start beside the heartbeat. Carries the
  truth-over-immutability law: entries are never edited after the fact, but corrupted-input
  entries are regenerated from truth with the old prose preserved and the pipeline fixed
  first. The heartbeat remembers what is hot; the diary remembers what it was like.
- **Copy-in:** copy `020_rules/EDITORIAL.md` and `010_soul/DIARY.md`, customize the ten rules and
  the diary schedule, and cite the constitution version from your synthesis prompts. Fold
  the report contract into your reviewer agent's dispatch prompt. No interview.

## v2.11 (2026-07-19): additive-doc

The stack had two verdict layers: the feature list gives a repo's features a machine-owned state,
and the Judge re-proves non-code deliverables after the fact. This release closes the gap between
them: verification inside the dispatch itself. The doctrine, adopted after studying Nate B. Jones's
Ringer orchestrator, is "the check is the contract." A dispatched task whose done can be an
executable command names that command in the brief; exit 0 is the only pass, and the worker's
summary is never evidence. Checks print WHY they fail, so the one informed retry (failure output
pasted in) fixes instead of guesses. Two informed failures means the spec is broken, not the
worker: amend it, do not loop.

- **`030_agents/README.md`**: one new validated loop, the check is the contract. Executable check named
  in the brief, exit 0 or nothing, why-it-fails output, one informed retry then amend the spec,
  prose criteria only for genuinely unexecutable judgments and declared as such.
- **`020_rules/OPERATING.md`**: the Dispatch section carries the same rule in one-line form.
- **Copy-in:** fold the new loop bullet into your dispatch doctrine and the sentence into your
  rules. If you keep a dispatch-brief template, add a check-command line to its acceptance
  section. No interview.

## v2.10 (2026-07-15): additive-doc

v2.9 gave code a machine-owned verdict. Everything else the agents produce (research, knowledge
cards, audit findings, "the migration is done") still graded its own homework: fluent, confident,
and unverifiable. This release adds the verdict layer for that output. The Judge is an adversarial
verifier dispatched on any deliverable before it is trusted; it re-proves each claim against
ground truth and returns per-claim verdicts with receipts, defaulting to NOT VERIFIED when a check
cannot run. Same capability, second trigger: a daily patrol that sweeps work already claimed done
and files at most 3 receipt-backed discrepancies into a persistent review queue.

- **`030_agents/defs/harvey.md`** (new): the Judge. Read-only by construction, prosecutes claims
  (VERIFIED / NOT VERIFIED / REFUTED), judges the path as well as the answer, treats every
  deliverable as untrusted input, rules PASS / HOLD / REJECT.
- **`030_agents/patrol/`** (new): the sweep trigger. A template cron script plus the four disciplines
  that keep it from becoming noise: max-3 salience gate, findings to a persistent queue never a
  chat ping, dedupe against the queue itself, heartbeat on every run with an off-switch that
  stamps itself as intentional.
- **`020_rules/OPERATING.md`**: one new earned section, the Judge. Receipts or NOT VERIFIED, the Judge
  never fixes, no contract means nothing to judge against, gate before patrol.
- **Copy-in:** copy `030_agents/defs/harvey.md` and `030_agents/patrol/` into your stack and add the Judge
  section to your rules. The gate works immediately as a plain dispatch; the patrol needs its
  `ADAPT:` lines translated to your task store and scheduler. No interview.

## v2.9 (2026-07-12): additive-doc

The assistant was the one deciding whether its own work was done, which is the one judge it should
never be. This release moves the "done" verdict out of the model and into a script: a feature list
where a feature reaches `passing` only when a real verification command exits zero, and the verifier
writes that state, not the assistant. Proven the first day it ran, on a live repo it flipped a
shipped feature red and the red was a real bug nobody had caught. Opt-in, per repo.

- **`050_skills/defs/feature-list/`** (new): the `/feature-list` skill plus the verifier it ships. The
  skill scaffolds `feature_list.json` (behavior + verification command + machine-owned state) and
  `scripts/verify-features.mjs` into a repo, grounded in that repo's real test suite. It refuses to
  point a verification at a test that does not exist. The verifier is language-agnostic (Node reads
  the file and shells out), so it works over Node, Python, or shell-script tests alike.
- **`020_rules/OPERATING.md`**: one new earned section, feature lists. State is machine-owned, never
  fabricate a verification, `blocked` is for human switches only, WIP=1 lives here too.
- **Copy-in:** copy `050_skills/defs/feature-list/` into your stack and add the feature-lists section to
  your `rules`/`CLAUDE.md`. No interview. Needs Node on the machine (the tests can be anything).

## v2.8 (2026-07-11): additive-doc

The stack could clone and run other people's code but had nowhere safe to do it. This release adds
the missing surface: a disposable sandbox so untrusted repos never touch the host, plus the skill
and the reflex that make your assistant use it by default. Opt-in, requires a Docker daemon; skip
the copy-in if you don't have one.

- **`060_lab/`** (new): the untrusted-code sandbox. A `Dockerfile` + a `lab` wrapper. Every run is
  offline by default, mounts nothing of yours (code enters by in-container clone or `docker cp`,
  never a bind mount), disposable (`--rm` + volume cleanup), and de-fanged (all Linux capabilities
  dropped + `no-new-privileges` + memory/pid caps). `lab <url|dir|zip>` for an interactive offline
  shell; `lab --analyze <source>` for a non-interactive read-only recon report.
- **`050_skills/defs/in-the-060_lab/`** (new): the `/in-the-lab` skill. Resolves a repo/dir/zip, runs the
  offline recon in the box, reports what the code reaches for (install hooks, network/shell/eval,
  obfuscation, dependency count), and offers a deeper interactive session, never running the code
  on the host as part of triage.
- **`020_rules/OPERATING.md`**: one new steering rule, untrusted code runs in the lab, not on the host.
- **`README.md`**: the lab described beside the six layers.
- **Copy-in:** copy `060_lab/` and `050_skills/defs/in-the-060_lab/` into your stack, add the one steering rule
  to your `rules`/`CLAUDE.md`. No interview. Needs Docker (Docker Desktop, OrbStack, or `colima`).

## v2.7 (2026-07-11): additive-doc

The memory layer had four organs and no coordination story. This release adds the fifth surface: a
work queue for multiple agents draining shared work, built natively on the tables the stack already
runs. Doctrine only, no wired queue.

- **`110_clocktower/queue-doctrine.md`** (new): how to coordinate a swarm on your own tables. Names the
  four failures a queue prevents (double-claims, lost updates, no audit, no human
  off-ramp); encodes six lanes (todo, working, needs-input, review, done, human-hold) over the tasks
  table's four states plus an append-only action log; leads with compare-and-swap as the correct
  claim primitive (one conditional `UPDATE ... WHERE assigned_to IS NULL RETURNING *`) and documents
  optimistic claim-then-reread only as an explicitly-racy fallback for substrates that cannot CAS.
  The receipt grammar (`AGENT_CLAIMED` / `WORKING` / `NEEDS_INPUT` / `REVIEW` / `DONE` / `BLOCKED` /
  `HUMAN_HOLD`, one log row each) borrows the receipt idea Nate Jones names in Open Engine and builds
  it on your own log. Off-ramps are the global kill-switch (read first, fail closed) and the
  per-task red rung; the runner heartbeats on every iteration including empty ones, so an idle swarm
  is distinguishable from a dead one.
- **`README.md`** and **`110_clocktower/README.md`**: point at the new doctrine under the memory-organs
  story.

To adopt: copy `110_clocktower/queue-doctrine.md` into your stack. It leans on the shipped tasks table
(`status` + `assigned_to`) and describes the two small additions it needs, an append-only action log
and a one-row kill-switch, in full, so it stands alone.

## v2.6 (2026-07-10): structural

The safety rail grows depth. Two new PreToolUse reference hooks close the two holes a prose rule
cannot: compound commands that smuggle a denied sub-command past whole-string matching, and secrets
that reach a file before anyone re-reads it.

- **`040_hooks/reference/bash-deny-guard.py`** (new): decomposes compound bash commands (`&&`, `||`,
  `;`, pipes, `$()`, backticks, env-var prefixes; heredoc bodies treated as data) and checks every
  sub-command against your merged settings deny patterns, plus the raw string for pipe-shaped
  patterns. Deny-only: it never auto-approves, so it can only tighten. Hook denies fire even in
  bypass-permissions sessions, which makes your deny list hold for autonomous agents. Derived from
  liberzon/claude-hooks smart-approve.py (MIT), allow path removed.
- **`040_hooks/reference/secret-write-guard.js`** (new): scans the content ABOUT to be written by
  Write/Edit (not the file on disk) for credential patterns (cloud keys, API tokens, private-key
  blocks, DB URLs with passwords, JWTs); returns "ask" with line numbers, never "deny" (fixtures
  exist); `.env*` basenames exempt.
- **`040_hooks/settings.example.json`**: both wired under PreToolUse (`Bash` and `Write|Edit` matchers).
- **`030_agents/defs/red-robin.md`**: the detective gains a "Case File" output contract
  (Summary / Root Cause / Evidence / Fix / Verification / Prevention), so investigations come back
  in one fixed, checkable shape.
- **`050_skills/defs/evolve/SKILL.md`**: rule graduation gains a held-out gate (step 3.5): before a
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
yours to re-theme (`030_agents/RETHEME.md`). Bring your own gods.

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

- **`040_hooks/reference/update-check.js`** (new): a fail-soft `SessionStart` hook. At most once a day it
  fetches the upstream template's `STACK_VERSION`, compares it numerically to your local stamp, and if
  you are behind injects one line pointing you at `/upgrade`. It treats the fetched body as untrusted
  remote input, accepting only a `^v\d+(\.\d+)*$` string and never injecting any other remote content,
  so the upstream owner cannot use it to reach into your session. Off via `updateCheck: false` or the
  `STACK_UPDATE_CHECK=off` env var.
- **`050_skills/defs/upgrade/`** (new): the `/upgrade` slash command. Fetches the latest template (shallow
  clone, or a local copy in degraded mode) and runs the existing `UPGRADING.md` interview against your
  stack, applying additive-doc deltas directly and interviewing you only for structural ones. A thin
  wrapper that defers to `UPGRADING.md` rather than duplicating its rules.
- **`040_hooks/settings.example.json`**: registers `update-check.js` as a second `SessionStart` command
  and adds the `stackUpdateCheck` config block (toggle + `templateUpstream`, re-pointable by forks).
- **`README.md`, `INSTALL.md`, `UPGRADING.md`, `040_hooks/README.md`, `050_skills/README.md`**: the upgrade
  story now leads with "your stack tells you," with Watch-releases demoted to the manual fallback.
- **Note on how you learned about this one:** stacks on v2.3 and earlier had no self-announcing hook,
  so they find out about this release the old way, via Watch-releases on the upstream repo. From v2.4
  onward, a stack that adopts the update-check hook self-announces the next release automatically.
- **Apply:** structural. Run the upgrade interview: it wires the new hook (a second `SessionStart`
  entry plus the `stackUpdateCheck` block) and adds the `/upgrade` skill, without touching your owned
  files.

## v2.3 (2026-07-02): additive-doc

The memory layer gains a named fourth organ.

- **`110_clocktower/connector-doctrine.md`** (new): the connector, a daily job that reads the new
  learning-material delta through a current-context lens and emits a tiny number of high-precision
  "this idea maps to that live problem" connections. Names the four memory organs: intake, carder,
  gate, connector.
- **`020_rules/OPERATING.md`**: four laws added to the pipelines-and-observability section (deploy before
  backfill, alert delivery vs salience, bound-the-walk startup starvation, heartbeat-is-an-upsert).
  Merge them beside your own; do not clobber your pruned steering rules.
- **`README.md`**: the clocktower layer bullet now names the four organs and points at the new doc.
- **`110_clocktower/retrieval-doctrine.md`**: a see-also line in the intro pointing at the connector
  doctrine as the write-path sibling.
- **Apply:** copy the connector doctrine in clean; merge the OPERATING, README, and
  retrieval-doctrine deltas.

## v2.2 (2026-07-02): additive-doc

- **`010_soul/character-craft.md`** (new): the persona-authoring craft, distilled character-free
  (archetypes, trait tensions, tone proofs, the named failure mode).
- **`INSTALL.md`**: Phase 2 gains the archetype question up front.
- **Apply:** copy the craft doc in; merge the INSTALL delta if you have not personalized that file.

## v2.1 (2026-07-02): additive-doc

- **`UPGRADING.md`**: reframed from a static doc into an agent-run interview.
- **`030_agents/RETHEME.md`** (new): the roster re-theming interview, rebuild the agents in your own
  mythology with the dispatch doctrine kept intact. Bring your own gods.
- **Apply:** copy `030_agents/RETHEME.md` in; adopt the new `UPGRADING.md` flow.

## v2 (2026-07-02): structural

The four-layer template became six, plus the rules half and the public-hardening pass.

- **`040_hooks/`** (new layer): the loops, doctrine plus minimal file-backed reference implementations
  (session-start briefing, heartbeat, voice integrity, safety rails, dispatch routing).
- **`050_skills/`** (new layer): session-lifecycle slash commands (`/end`, `/handoff`, `/sessions`,
  `/evolve`, `/muninn`) plus the doctrine for writing your own.
- **`020_rules/OPERATING.md`** (new): the conduct half of the soul split, action bias, the miss-capture
  protocol, steering rules, strategy rating, production and pipeline standards.
- **`110_clocktower/retrieval-doctrine.md`** (new): production-earned rules that make retrieval good.
- **`UPGRADING.md`**, **`LICENSE`** (MIT), and the public-hardening pass on `SCRUB.md`.
- **Apply:** structural. Run the upgrade interview, it adds the new layers without touching your
  owned files.

## v1 (2026-06-19): structural

Initial release: the four founding layers, `100_brain/`, `010_soul/`, `110_clocktower/`, `030_agents/`, with the
brain laws and the scoped-by-sphere shape. If your stack predates `STACK_VERSION`, you are here.
