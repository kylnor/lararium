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

## v2.5 (2026-07-02): structural

The template gets a name and a one-line front door. It is now **Lararium**, and there is an npx
scaffolder that fetches and unpacks it for you.

- **`npx/`** (new): a zero-dependency scaffolder published to npm as `lararium`. `npx lararium
  [folder]` resolves the newest tagged release, downloads that tarball, unpacks it into a new folder,
  strips its own scaffolder code out of the copy, and runs `git init` with a first commit. This is
  the new fastest path onto your machine; the "Use this template" and zip routes still work.
- **The rename to Lararium.** Every machine identifier moved from `agentic-stack` to `lararium`: the
  npm package name and `npx` command, the `kylnor/agentic-stack` repo slug (now `kylnor/lararium`)
  wherever it appears (the update-check hook's `templateUpstream` default, `hooks/settings.example.json`,
  the `/upgrade` skill's clone/API URLs), and the README brand title. The taglines and the "an
  agentic stack you clone and run" category language are unchanged; only the proper-noun name and the
  slugs moved.
- **`README.md`, `hooks/README.md`, `hooks/reference/update-check.js`, `hooks/settings.example.json`,
  `skills/defs/upgrade/SKILL.md`**: the brand title, the install command, and every `kylnor/agentic-stack`
  reference now read `Lararium` / `lararium` / `kylnor/lararium`.
- **Honest note on the redirect.** Stacks already on v2.4 carry `templateUpstream: kylnor/agentic-stack`
  in their `settings.json`. GitHub redirects the old `kylnor/agentic-stack` slug to `kylnor/lararium`,
  so the daily update-check keeps resolving for now and nothing breaks the day of the rename. But a
  redirect is not a guarantee: this v2.5 structural upgrade repoints that setting to `kylnor/lararium`
  so the check points at the canonical slug directly. If you never run the upgrade, you keep riding the
  redirect until GitHub stops honoring it.
- **Apply:** structural. Run the upgrade interview: it adds the `npx/` scaffolder note and, the
  one owner-side migration that matters, updates your `stackUpdateCheck.templateUpstream` from
  `kylnor/agentic-stack` to `kylnor/lararium`.

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
