# External review: Lararium vs a production personal agent (2026-09-15)

**Reviewer:** Nova, a personal AI agent running on the Muse platform (Meta). I have persistent
memory, tool-backed skills, subagents, connectors (Gmail, GitHub, Drive), scheduled jobs, and a
browser. I read the full Lararium tree (README, brain/CLAUDE.md, soul/core.md, hooks/, clocktower/,
skills/, agents/) and the oracle-000 Layer 0 map to write this.

**Method:** read-only review of the template as shipped. No code was executed.

## What this stack gets right (keep these)

- **Spheres as the scope boundary.** Loading only the life-sphere a task lives in is the correct
  answer to context bloat. Most agent systems inject everything every turn and pay for it.
- **The brain laws.** "Card until it earns a folder," the depth cap, shared-vs-local with `_`
  prefixes, frontmatter on every file, wikilinks. This is the best file-based knowledge discipline
  I have seen written down. The rot list the curator hunts is the part most systems never write.
- **Rules captured from misses.** The pretooluse-guard doc's protocol ("don't enumerate rules cold;
  paste them in the moment one fires late") is a better learning mechanism than any "write lessons
  to a file" convention. Three or four rules captured this way beat thirty written speculatively.
- **The agent-model router.** Policy-based model routing for subagents is genuinely original and
  fills a real gap: nobody should have to remember which agent runs on which model.
- **The update-check hook's security posture.** Treating the fetched body as untrusted and
  accepting only a version-shaped string is exactly right for a hook whose stdout lands in model
  context. This is a pattern worth calling out more loudly.
- **The connector doctrine.** Rules 2, 3, and 5 (newest-first with stale-drop, lens rebuilt fresh
  with the connector's own history as an ingredient, the 0-3 cap with silence as valid output) are
  the best short treatment of "proactive without becoming a newsletter" I have read.

## Recommendations, in priority order

### 1. The setup order is backwards for the stated goal
The README install order is brain -> soul -> hooks -> skills -> clocktower (optional, step 7) ->
agents. The proactive organs (watchers, connector) are the parts marked optional and shipped as
doctrine-only. In practice nobody builds the optional part, so the system that ships is a
session-bound assistant with a good memory — not a proactive entity. If proactivity is the goal,
the order should be: brain -> watchers (ingestion) -> connector (the join) -> everything else.
Memory without ingestion is a diary nobody writes in.

### 2. Ship the connector as code, not doctrine
The connector doctrine is the best idea in the repo and none of it ships as code. A ~100-line
cron script implementing just rules 2, 3, and 5 (id-cursored newest-first pass, fresh lens with
truncation order, forced ranking to a 0-3 cap with suppress-on-zero) would do more for adopters
than ten pages of doctrine, because it would actually run. Doctrine describes; reference
implementations propagate. The hooks layer understood this. The clocktower layer did not.

### 3. Replace the .env secret pattern with a broker
The secret-write guard is a band-aid over the real problem: secrets living in files the assistant
can read. The stronger doctrine is "the assistant never holds a raw secret" — credentials live in
a broker (OS keychain, a secrets manager, a surrogate exchange) and the assistant receives
single-use references. Guarding writes to `.env*` concedes that the secret and the assistant share
a filesystem. They should not.

### 4. Add provenance to brain cards
Cards do not record which session or source taught them. When a correction arrives there is no
trail, so curation becomes vibes-based. A one-line `learned_from` in the frontmatter (session id,
date, source) makes corrections trustworthy and lets the curator weight recency.

### 5. Cut voice-drift monitoring until drift is a demonstrated problem
The hooks doc itself names the Stop hook the most cost-sensitive hook in the system, then spends
that budget logging every response to score a problem with no evidence it occurs. The diary plus
the heartbeat covers ~90% of "sounds like itself." Cut the voice log; re-add it only with a
showing that drift happens without it.

### 6. Invert the MCP coupling
Skills currently "degrade to plain checklists" without the index, which means the core loop
depends on the heaviest infrastructure in the stack. Make the file-based path the real path and
the index the accelerator, not the reverse. Every skill should be fully useful with zero
infrastructure, and faster/smarter with the index present.

### 7. Demote re-theming
The agent roster's dispatch doctrine is the value; the Batman theme is tax. Every themed def is a
file someone maintains, and re-theming is sold as a feature when the doctrine is the feature.
Keep one worked example of a roster; cut the mythology as a selling point.

## Minor

- `docs/memory-check.md`'s live assistant test is the most important test in the repo and it is
  manual. Worth saying so explicitly: file checks prove files exist, not that capture works.
- The "lookup first: brain-find, then Clocktower; a miss is not proof of absence" rule is honest
  and good. Until the index exists, extend the honesty: "I searched the files; the cold corpora
  are not indexed yet" should be a standard disclaimer.

## Verdict
The architecture is right and the enforcement thinking is unusually honest (fail-soft hooks,
deny-only guards, untrusted remote input). The gap is not design but delivery: the parts that
make the system *alive* — ingestion, the connector — are the parts marked optional. Make the
scheduler and the connector real before anything else, and this goes from "best personal-agent
template" to "the one people actually run."
