# Hooks

The soul layer describes loops (a session-start briefing, a heartbeat, voice-drift monitoring). This
layer is where those loops actually run. If the brain is what the assistant knows and the soul is who
it is, hooks are the nervous system: the reflexes that fire on their own, every session, without you
asking. This is the layer that makes the system feel alive instead of feeling like a chatbot with a
long system prompt.

Ships as reference implementations, not production code. They are clean-room, dependency-light, and
short on purpose: read one and you understand the whole pattern in a few minutes. Copy them, rename
the paths, and wire them into your own config.

## What a hook is

A hook is a shell command wired to a lifecycle event. Claude Code runs it at the right moment, hands
it a JSON payload on stdin, and reads what it does. You register hooks in `settings.json` under a
`hooks` block (see `settings.example.json`). The events this layer uses:

- **SessionStart**: fires when a session starts, resumes, or clears. stdout is injected into the
  conversation as context. This is how the assistant arrives already briefed.
- **UserPromptSubmit**: fires on each user turn before the model sees it. stdout is injected as
  context for that turn. Good for cheap, per-turn enrichment.
- **Stop**: fires after each assistant response. Runs on every response, so it must be cheap.
- **SessionEnd**: fires once when the session closes. The place for end-of-session bookkeeping.
- **PreCompact**: fires just before the context window compacts. Your chance to write down state that
  should survive the squeeze.
- **PreToolUse**: fires before a tool call. Can allow, block ("deny"), pause for a human ("ask"), or
  rewrite the call's input. This is the only event that can change what happens next.
- **PostToolUse**: fires after a tool call completes. For logging and reaction, not prevention.

Two of those events are special because their stdout does something structural. SessionStart and
UserPromptSubmit **inject** their stdout into the conversation. PreToolUse can **block or rewrite** the
tool call via a JSON decision on stdout. The rest are observers: they act on the world (write a file,
hit a DB), but their stdout is not fed back into the model.

## The loops this layer implements

Each loop below maps to one reference hook. Together they are the difference between a stateless
assistant and one that remembers yesterday and sounds like itself.

### a. Session-start briefing (`session-start.js`, SessionStart)
Loads the soul core, the heartbeat, `now.md`, and any pending handoff file, and prints them as a
briefing block that gets injected into context. The assistant opens the session already knowing who
it is, what it did last time, what you are focused on, and where the last session told it to pick up.
This is the single highest-leverage hook in the stack: without it, every session starts cold.

### b. Heartbeat (`session-end-heartbeat.js`, SessionEnd)
Reads the session transcript, distills what happened into a short summary, and writes it to the
heartbeat file. That file is what the next session's briefing reads back. This is the write half of
"remember yesterday." The reference version writes a mechanical tail-of-the-conversation summary; the
comment in the file marks exactly where you upgrade it to an LLM-written paragraph in the assistant's
own voice.

### c. Voice integrity (`voice-log.js`, Stop)
Appends every response (with its prompt and a timestamp) to a local JSONL. On its own that is just a
log. The value comes from a separate scheduled job you write: it samples a handful of recent
responses, scores them against the soul core, and alerts you if the assistant is drifting away from
its own voice. The hook is the cheap capture; the scoring is deliberately out of band, because a Stop
hook cannot afford to think.

### d. Context injection (UserPromptSubmit)
Fail-soft, per-turn enrichment. stdout is injected before the model sees the turn, so this is where
you add small live context: a cross-surface "what we're talking about right now" note so a
conversation can move from your phone to your desk, the current time of day, a weather line, whatever
is cheap and useful. Not shipped as a reference hook here (it is a two-line file once you know the
contract: read stdin, print a string, exit 0), but the event is in `settings.example.json`-adjacent
territory and worth wiring when you have a note worth injecting.

### e. Continuity primer (PreCompact)
When the context window is about to compact, the conversation is about to lose detail. A PreCompact
hook writes a dense state summary first, so the post-compact session can be re-primed and does not
lose the thread mid-task. Think of it as a heartbeat for the middle of a session rather than the end
of one. Same shape as the heartbeat writer, different trigger.

### f. Safety rail (`pretooluse-guard.js`, PreToolUse)
Pattern-matches dangerous commands and blocks them with an explanation the assistant can act on. The
starter set covers `rm -rf` against broad paths and unscoped globs, force-pushes to main/master,
curl-piped-to-shell, echoing secrets into files, and `chmod 777`. It denies only unconditional
destruction and leans on "ask" for anything ambiguous, because falsely blocking real work is worse
than missing an edge case.

### g. Dispatch router (`agent-model-router.js`, PreToolUse on the Agent tool)
Rewrites subagent dispatch parameters by policy: some agents should always run on a certain model, and
nobody should have to remember that. The hook injects the model when policy matches and the caller did
not already pin one. An explicit choice on the dispatch always wins; the router only fills the gap.

## The laws

These are not style preferences. Break one and you will eventually wedge a session or leak a slow hook
into every turn.

- **Fail soft, always.** A hook that throws must exit 0 and inject nothing. Never block a session on
  infrastructure failure. Every reference hook wraps its body in try/catch and swallows the error. A
  briefing is a nice-to-have; a working session is not negotiable. The correct failure mode is
  "silently do nothing," never "crash the turn."
- **Be fast.** Hooks run synchronously, in the critical path of the thing that triggered them. A slow
  hook is felt as a slow assistant. Keep the hook itself to file reads and quick string work; push any
  heavy work (an LLM call, a network round-trip) to a background worker the hook spawns and does not
  wait on, or to a scheduled job entirely out of band.
- **A Stop hook fires on every response.** That makes it the most cost-sensitive hook in the system.
  It must be cheap enough to run hundreds of times a day without you noticing. Capture in the hook,
  score somewhere else.
- **Deny only unconditional destruction.** In the PreToolUse guard, reserve "deny" for commands with
  no recovery path. Use "ask" for anything ambiguous. A guard that cries wolf gets disabled, and a
  disabled guard protects nothing.
- **Test standalone before you wire it.** Every hook reads a JSON payload on stdin. Before adding it
  to `settings.json`, run it by hand with a fake payload and confirm it exits 0 and does the right
  thing. The reference hooks each carry their exact test command in the header comment.

## Testing a hook

Every hook takes its payload on stdin, so you can exercise it without Claude Code at all:

```
echo '{"source":"startup","session_id":"test","cwd":"/tmp"}' | node reference/session-start.js
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | node reference/pretooluse-guard.js
echo '{"tool_name":"Agent","tool_input":{"subagent_type":"architect","prompt":"x"}}' | node reference/agent-model-router.js
```

The guard should print a deny JSON for the destructive command and print nothing for a safe one. The
router should print an `updatedInput` for a policy-matched agent and nothing otherwise. The
briefing hook should print whatever soul/heartbeat/now files it finds (and nothing, cleanly, if none
exist yet). If any of them throws or exits non-zero, fix that before wiring it in.

## The wiring

Copy the reference hooks to wherever you keep hook scripts (the example uses `~/.claude/hooks/stack/`)
and add the `hooks` block from `settings.example.json` to your Claude Code `settings.json`. The block
registers all five reference hooks against their events, with two PreToolUse entries: one matched to
`Bash` for the safety rail, one matched to `Agent` for the dispatch router.

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node ~/.claude/hooks/stack/session-start.js" } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "node ~/.claude/hooks/stack/session-end-heartbeat.js" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node ~/.claude/hooks/stack/voice-log.js" } ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash",  "hooks": [ { "type": "command", "command": "node ~/.claude/hooks/stack/pretooluse-guard.js" } ] },
      { "matcher": "Agent", "hooks": [ { "type": "command", "command": "node ~/.claude/hooks/stack/agent-model-router.js" } ] }
    ]
  }
}
```

## Paths and where the files live

The reference hooks read from a stack home at `~/.assistant/` (soul core, heartbeat, voice log,
handoff) and a `brain/now.md`. Those are conventions, not requirements: every path is a named constant
at the top of each file. Point them at wherever your soul, brain, and working files actually live
before you wire anything in.

## What these deliberately do not do

The reference hooks read local files where the live system reads a database. Every place a real index
query would happen is stubbed behind a file read with a comment saying so. That is intentional: the
pattern is identical whether the read hits a JSONL on disk or a vector index over your whole life. Get
the loop working against files first, then swap the stub for your index when the file layer outgrows
it. Start simple; the shape does not change.
