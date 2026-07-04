---
title: "The Hooks, and the Reflexes That Make It Feel Alive"
slug: the-hooks-and-the-nervous-system
order: 5
description: The loops that fire on their own, every session, without you asking. The layer that turns a folder of files into a presence.
status: draft
---

# The Hooks, and the Reflexes That Make It Feel Alive

Everything so far is something the assistant knows or is. The brain is what it knows. The soul is who it is. The clocktower is what it can search. But knowing, being, and searching are all passive. They sit there until a conversation reaches for them. What makes the difference between a chatbot with a long system prompt and something that feels alive is a set of reflexes that fire on their own, every session, without you asking.

That is the hooks layer. If the brain is what the assistant knows and the soul is who it is, hooks are the nervous system. They ship as reference implementations: clean-room, dependency-light, short enough that you read one and understand the whole pattern in a few minutes. You copy them, point the paths at your files, and wire them in.

## What a hook actually is

A hook is a shell command wired to a lifecycle event. The coding assistant runs it at the right moment, hands it a JSON payload on standard input, and reads what it does. The events that matter:

- **SessionStart** fires when a session begins, resumes, or clears. Its output is injected into the conversation as context.
- **UserPromptSubmit** fires on each of your turns before the model sees it. Its output is injected for that turn.
- **Stop** fires after each assistant response. It runs on every response, so it has to be cheap.
- **SessionEnd** fires once when the session closes. The place for end-of-session bookkeeping.
- **PreCompact** fires just before the context window compacts.
- **PreToolUse** fires before a tool call and is the only event that can change what happens next: it can allow, block, pause for a human, or rewrite the call.
- **PostToolUse** fires after a tool call, for logging and reaction, not prevention.

Two of these are structural. SessionStart and UserPromptSubmit **inject** their output into the conversation. PreToolUse can **block or rewrite** a tool call. The rest are observers: they act on the world but their output is not fed back to the model.

## The reflexes this layer implements

Each loop the soul layer described actually runs here.

**The session-start briefing** is the single highest-leverage hook in the stack. It loads the soul core, the heartbeat, your `now.md`, and any pending handoff, and prints them as a block that gets injected into context. The assistant opens the session already knowing who it is, what it did last time, what you are focused on, and where the last session told it to pick up. Without this hook, every session starts cold. With it, the assistant walks in mid-conversation.

**The heartbeat writer** is the other half of remembering yesterday. At session end it reads the transcript, distills what happened, and writes it to the heartbeat file the next briefing will read. The reference version writes a mechanical summary; a comment marks exactly where you upgrade it to a paragraph in the assistant's own voice.

**Voice integrity** appends every response to a local log. On its own that is just a log. Paired with a scheduled job that samples recent responses and scores them against the soul core, it becomes drift detection. The hook is the cheap capture; the scoring happens out of band, because a Stop hook cannot afford to think.

**The continuity primer** fires right before the context window compacts and writes down the state that should survive the squeeze, so the assistant does not lose the thread mid-task. A heartbeat for the middle of a session rather than the end.

**The safety rail** pattern-matches dangerous commands before they run and blocks them with an explanation the assistant can act on: destructive deletes against broad paths, force-pushes to main, curl piped into a shell, secrets echoed into files.

**The dispatch router** rewrites subagent dispatch parameters by policy, so that agents which should always run on a certain model just do, and nobody has to remember. An explicit choice on the dispatch always wins; the router only fills the gap.

**The update check** turns a detached clone into one that knows when it is behind. Once a day at session start it compares your installed version against the upstream template and, if you are behind, injects one line: a newer version is out, type `/upgrade`.

## The laws, because a bad hook wedges a session

These are not style preferences. Break one and you eventually jam a session or leak a slow reflex into every turn.

**Fail soft, always.** A hook that throws must exit cleanly and inject nothing. A briefing is a nice-to-have; a working session is not negotiable. The correct failure mode is "silently do nothing," never "crash the turn." Every reference hook wraps its body in a try/catch and swallows the error.

**Be fast.** Hooks run synchronously, in the critical path of whatever triggered them. A slow hook is felt as a slow assistant. Keep the hook to file reads and quick string work, and push anything heavy, an LLM call, a network round-trip, to a background worker it spawns and does not wait on.

**A Stop hook fires on every response,** which makes it the most cost-sensitive code in the system. Capture in the hook, score somewhere else.

**Deny only unconditional destruction.** Reserve a hard block for commands with no recovery path; use "ask" for anything ambiguous. A guard that cries wolf gets disabled, and a disabled guard protects nothing.

**Test standalone before you wire it.** Every hook reads its payload on standard input, so you can run it by hand with a fake payload and confirm it behaves before it ever touches a live session. Each reference hook carries its exact test command in the header comment.

There is one more property worth calling out, because it is a security decision and not a convenience. The update-check hook treats the version string it fetches from the network as **untrusted remote input.** A SessionStart hook's output goes straight into the model, so a hook that echoed arbitrary upstream text would let whoever owns the upstream repo inject instructions into every subscriber's session. The hook accepts exactly one thing from the network, a string that looks like a version number, and builds the nudge from local static text. That is the kind of care the whole layer is written with: the reflexes touch the most sensitive part of the loop, so they are built to be boring and safe.

## Start on files, swap for the index later

The reference hooks read local files everywhere the live system would read a database. That is intentional. The pattern is identical whether the read hits a file on disk or a vector index over your whole life, so you get the loop working against files first and swap the stub for your index when the file layer outgrows it. Start simple. The shape does not change.

Next in the series: the skills, slash commands for the rhythm of a life.
