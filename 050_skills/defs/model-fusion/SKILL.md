---
name: model-fusion
description: Route terminal work across multiple AI CLIs (Claude, Codex, Gemini, Grok) using subscription-authenticated logins, with your assistant as the one spine that synthesizes. Triggers on "ask codex", "ask gemini", "ask grok", "second opinion on this", "model fusion", "full fusion", "run fusion on this". Also fires automatically for substantial repository implementation, unusually large document or media analysis, and consequential decisions that benefit from an independent model critic.
---

# /model-fusion -- one spine, summoned second opinions

Your assistant stays the spine: it owns the conversation, judgment, permissions, synthesis, and
durable memory. Other model CLIs are execution engines it summons when a second opinion earns its
tokens, never separate sovereign assistants. Four peers means four contexts, four memories, and no
accountability; one brain dispatching critics is the architecture.

The runner is `fusion-run.mjs` beside this file. Resolve it relative to this SKILL.md, not the
caller's repository:

```bash
node fusion-run.mjs codex  --cwd "$PWD" -- "<task>"
node fusion-run.mjs gemini --cwd "$PWD" -- "<task>"
node fusion-run.mjs grok   --cwd "$PWD" -- "<task>"
node fusion-run.mjs auto   --cwd "$PWD" -- "<task>"
node fusion-run.mjs fusion --cwd "$PWD" -- "<task>"

node fusion-run.mjs codex --write --cwd "$PWD" -- "<task>"   # opt in to writes
```

## What this points at, and why that matters

Read this before pointing fusion at a directory. The runner passes `--skip-trust` to Gemini and
`--skip-git-repo-check` to Codex. Both flags exist to defeat the workspace-trust prompt those CLIs
show before operating somewhere they do not recognize, and both are required to run headless. That
is a real cost, not a formality: **fusion runs third-party agents against `--cwd` with their own
guardrails switched off.** The same stack ships `060_lab/` specifically so untrusted code is never
handled that way, and for a while it shipped both without mentioning the tension.

So:

- **Reads are the default.** Codex runs `--sandbox read-only` unless you pass `--write`. Asking for
  a second opinion should not be able to edit the tree it is reading. Fusion mode is always
  read-only: there the other models are critics, not builders.
- **The target is announced** on stderr every run. If that line ever names a directory you did not
  mean, that is the warning you would otherwise not get.
- **Constrain it if you want a hard boundary.** `FUSION_TRUSTED_ROOTS=/Users/you/Dev:/Users/you/work`
  refuses any `--cwd` outside those roots. Unset means anywhere, which is the default and the old
  behaviour; this is opt-in hardening.
- **For code you do not trust, this is the wrong tool.** Use `/in-the-lab` first. Fusion is for
  getting other models' opinions on *your* work, not for triaging a stranger's repository.

## Routing

- Preserve an explicit provider request exactly.
- Route substantial coding, debugging, tests, migrations, and repository edits to Codex.
- Route large document sets, images, audio, video, transcripts, and wide-context comparison to
  Gemini.
- Keep ambiguous judgment, strategy, synthesis, and ordinary conversation in the current session.
- Use `fusion` when the owner explicitly requests it, or when a consequential decision needs
  genuinely different briefs. Do not fan out routine questions.

## Full fusion: the synthesis contract

The panel renders for the assistant, not for the owner. The owner never reads raw legs.

Each engine gets a different brief: the spine model takes strategy, constraints, and failure
modes; Codex takes the concrete implementation plan with verification; Gemini takes the
independent evidence audit (missing context, unsupported assumptions, counterarguments); Grok
takes the red team (argue the approach is wrong, propose the alternative). Four models agreeing
is worth less than three plus a real dissenter.

Read all legs. Evaluate each, keep what survives scrutiny, discard what does not, and say which
legs were discarded and why when it matters. Return ONE answer that names material disagreement
and makes the decision. Never paste unprocessed legs at the owner.

## Safety and billing rails (each one was paid for)

- **Subscription auth only.** The premise is CLIs the owner already pays a flat fee for, never
  metered API keys. The runner deletes every provider billing key from the child environment
  before spawning each CLI. Never add an API key as a fallback; if OAuth is missing or expired,
  report the gate honestly.
- **The Gemini exception (as of 2026-07, verify before relying on it).** Google discontinued
  personal-account OAuth for the Gemini CLI (`IneligibleTierError`, pointing at Antigravity), so
  a personal account can only use it with an API key. The safe pattern: mint a key on a fresh
  Google Cloud project with NO billing account attached. Runaway usage then returns quota errors
  instead of charges, structurally, not as a configurable limit. Set it as `GEMINI_FUSION_API_KEY`
  and let the runner inject it per child process only. Also know: the Gemini CLI loads `~/.env`
  off disk itself, and its `.env` loading never overrides existing process env; guard your paid
  keys with `advanced.excludedEnvVars` in `~/.gemini/settings.json`.
- **Critics do not get pens.** In fusion mode Codex runs `--sandbox read-only`; only a deliberate
  single-provider dispatch gets `workspace-write`.
- **Monitor auth drift.** Subscription auth can silently degrade to metered (the Gemini case
  above went unnoticed for a month on the original stack). A cheap structural probe that checks
  each provider's auth-mode file and withholds a freshness heartbeat on drift closes this; wire
  it into whatever freshness monitor your stack runs. Zero quota: read the auth files, never call
  the providers.
- **Absolute paths for every binary.** Installer-written PATH lines land in `.bashrc`, which
  non-interactive shells skip. The runner accepts `FUSION_<PROVIDER>_BIN` overrides.

## Known sharp edges (found by hitting them)

- `codex exec` reads "additional input" from stdin whenever stdin is a pipe; close the child's
  stdin or the leg hangs forever. It also refuses to run outside a git repo without
  `--skip-git-repo-check` (the twin of Gemini's `--skip-trust`).
- A freshly created free-tier Google project cannot reach the Gemini CLI's default model; pin
  `-m gemini-flash-latest` (override via `FUSION_GEMINI_MODEL`).
- Provider CLIs are beta-grade and their subscription-auth stories change. Treat every claim in
  this file as dated, and re-verify the vendor side before building on it.
