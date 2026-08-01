---
title: "Model Fusion, and Why Your Assistant Should Not Be a Committee"
slug: model-fusion
lane: dispatch
version: v2.15
date: 2026-08-01
description: You probably pay for more than one AI subscription. The wrong move is four sovereign assistants. The right move is one spine that summons critics, reads them, and answers you once.
status: draft
---

# Model Fusion, and Why Your Assistant Should Not Be a Committee

Count your AI subscriptions. If you are the kind of person running this stack, the number is probably not one. A Claude plan for the assistant, a ChatGPT plan someone in the house uses, maybe a Gemini or a Grok that came bundled with something else. Each one ships a terminal CLI now. Each CLI is a capable engineer sitting idle while you pay its salary.

The obvious move is to use all of them. The obvious move, done naively, is also a mistake.

## Four peers is a committee, one spine is an architecture

Run four assistants as equals and you get four contexts, four memories, four opinions, and no accountability. Nobody owns the conversation. Nobody remembers what you decided last week. When two of them disagree, the tiebreaker is you, which means you have hired four advisors and become the secretary.

The v2.15 skill takes the other shape. Your assistant stays the spine: it owns the conversation, the judgment, the permissions, and the durable memory. The other CLIs are engines it summons when a second opinion earns its tokens. Substantial code goes to Codex for a cross-model review, because a model reviewing its own work has the same blind spots twice. Giant contexts go to Gemini. And when a consequential decision is on the table, all four render at once, each with a different brief: strategist, implementer, evidence auditor, and a red team told to argue the whole approach is wrong and mean it.

The panel renders for the assistant, not for you. It reads every leg, keeps what survives scrutiny, discards what does not, and comes back with one answer that names the disagreement that mattered. You never read four raw opinions. That was the job you were trying to delegate in the first place.

One rule inside the panel is worth stealing even if you steal nothing else: four models agreeing is worth less than three plus a real dissenter. The red-team seat is not decoration. A panel that always concurs is a mirror, and you already had one of those.

## Critics do not get pens

A detail that earned its place through review rather than foresight: in fusion mode, the implementation engine runs read-only. When Codex is deliberately dispatched to build, it can write to the workspace. When it is one voice on a panel critiquing a decision, it cannot touch a file. The failure mode this prevents is exactly as dumb as it sounds: you ask four models whether an approach is right, and one of them helpfully starts implementing it. A critic with a pen is not a critic.

## The bill that arrived without an event

The skill's premise is flat-rate only: subscription logins, never metered API keys. Here is the story of defending that premise, told in the order it actually hurt.

The stack this template is extracted from ran Gemini on a metered key for about a month without anyone choosing that. There was no incident, no error, no moment where anything visibly broke. Every session worked. What had happened, invisibly, is that the CLI stopped honoring the subscription login and fell back to an API key it found on disk, and from that day the meter was quietly running. A working system cannot feel this class of failure, because nothing in it has failed. The auth mode is just different from the one you chose, and auth mode, it turns out, is infrastructure that can drift.

Chasing that down surfaced the reason. Google has ended personal-account OAuth for the Gemini CLI. The login flow still works: it completes, writes healthy-looking credentials, and then the first real call returns an ineligibility error pointing you at a different product. A personal account can only use that CLI with an API key now. The answer that preserves the no-surprise-bills property: mint the key on a fresh Google Cloud project with no billing account attached. Runaway usage on such a project returns quota errors, not charges. That is structural, not a spending limit someone can misconfigure.

The runner does its half by construction: it strips every metered API key out of the child environment before spawning a CLI, so a stray key in your shell or your dotfiles never rides along. But be honest about what that guarantees. A CLI can also read keys from its own on-disk config, which is the exact route the silent month took, and no amount of environment hygiene sees that. Stripping closes one door. The other door needs a watcher.

## The probe: auth mode is infrastructure, so monitor it like infrastructure

The watcher ships in v2.15, and it is almost embarrassingly cheap: a probe that reads each provider's local auth state on a schedule, checks the mode is still the one you chose, and reports into whatever freshness monitoring your stack already runs. It burns zero quota, because it checks files, not providers.

Scope it honestly, because the two failure modes are different. Local drift, a CLI rewriting its own config or falling back to a key on disk, leaves a trace in the files, and the probe catches it in hours instead of a month. Both real incidents in this story were that kind. A purely server-side change, a vendor flipping your eligibility with nothing local changing, is invisible to any file check and surfaces at call time instead, which is why the runner reports a failed login gate honestly rather than falling back to a meter. Detection at the file layer, honesty at the call layer. Neither alone is enough.

## Reviewed like it tells you to

One more honesty note, in the spirit of the lab dispatch telling you not to trust our installer. This skill went through the stack's own adversarial review the day before it shipped, and the review found that the full four-way fusion mode had never actually been proven end to end. The author had tested each engine alone and written "the risk is low." The reviewer ran it anyway, and it hung forever, twice over: one CLI blocks reading an input stream nobody closes, and it refuses headless work outside a git repository besides. Both fixes are in the runner you are getting, along with the review's other findings. The version in the template is the version that survived being attacked, which is the only version worth shipping.

## And about the silence

If you watch this repo, you noticed it went quiet. The precise sins, because precision is the point of this section: releases stopped being cut at v2.8, so six versions reached the changelog without the release that was supposed to announce them, and this dispatch stream itself skipped v2.14. The ritual said every version gets both, the day it ships. The ritual ran on discipline, and discipline is exactly the mechanism this series keeps telling you not to trust. We wrote "no quiet failures" as a dispatch title and then failed quietly.

So that is fixed the only way we fix things: mechanically. Releases are now cut by automation the moment the version file changes, with notes pulled from the changelog, and a version bump without a changelog entry fails the build. The catch-up release covers the whole gap in one jump. A rule that lives in prose is a hope. A rule that lives in a mechanism is real.

## Take it

The skill is optional and ships with v2.15. If you hold one AI subscription, skip it entirely; it earns its place the day you hold two.

```
npx lararium        # new stack, or:
git pull            # existing stack, then copy skills/defs/model-fusion/
```

The skill lives at `skills/defs/model-fusion/`: a SKILL.md carrying the doctrine and a single-file runner with no dependencies. Wire it in and the invocations are plain language: ask your assistant for "a second opinion on this diff" and Codex renders one, hand it a monster PDF and Gemini eats it, say "run fusion on this" and the four-brief panel convenes. The full routing table, the safety rails, and every sharp edge we hit are documented in the skill itself, dated, so you can check whether the vendor ground has shifted before you stand on it.
