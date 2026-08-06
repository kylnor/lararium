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

## Walls, fences, and speed bumps

Read this before you trust anything below it. Some hooks here are safety rails, and a safety rail
you believe is stronger than it is will get you to grant autonomy you would not otherwise grant.
That is the failure mode this section exists to prevent.

Three tiers, and they are not interchangeable:

| Tier | What it is | What it does | What defeats it |
|---|---|---|---|
| **Wall** | Capability removal, OS-enforced | The dangerous thing is *not reachable*. `040_hooks/sandbox/`, `060_lab/`, a credential that is not in the environment. | Nothing you can type. You have to change the sandbox. |
| **Fence** | Structural analysis of a command | Real tokenization, binary normalization, fail-closed on anything it cannot parse. `bash-deny-guard.py`. | Runtime facts it cannot see: `$VAR`, aliases, functions, the contents of a script it invokes. |
| **Speed bump** | Pattern matching a string | Catches the shape you thought of. `pretooluse-guard.js`. | A different spelling of the same command. |

**Only the wall is a wall.** The fence stops accidents and confused models; it does not stop an
adversary who controls the prompt, because it reads a command *before* the shell resolves any of
it. No amount of better parsing changes that — the information is not there yet.

This matters concretely. Through v2.15, `bash-deny-guard.py` was a speed bump described as a wall
("what makes your deny list hold for autonomous agents"). Three bypasses were confirmed against it
with a `Bash(rm:*)` deny list active:

```
grep "a<<b" notes.txt \n rm -rf /important     ALLOWED
python3 -c "print(1 << 2)" \n rm -rf /...      ALLOWED
/bin/rm -rf /important                         ALLOWED
```

The first two were one bug: heredoc detection was a regex over raw lines, so a `<<` inside a quoted
string started a phantom heredoc and everything after it was swallowed as "data". The third was
prefix matching against a spelling. All three are now regression tests in
`reference/tests/test-bash-deny-guard.py`, and the guard is a fence rather than a speed bump.

If you want an actual wall, it does not live in this file. It lives in `040_hooks/sandbox/` (the
kernel enforces the path, so every spelling fails identically) and in not putting credentials where
an unsupervised process can reach them (see `030_agents/patrol/patrol.sh`).

## The loops this layer implements

Each loop below maps to one reference hook. Together they are the difference between a stateless
assistant and one that remembers yesterday and sounds like itself.

### a. Session-start briefing (`session-start.js`, SessionStart)
> Injected blocks other than the soul core are wrapped in `<untrusted-context>` with a standing
> data-not-instructions preamble. `now.md`, brain cards, and the heartbeat are fed by watchers and by
> the previous session's transcript, so their text is not necessarily yours — and this hook's stdout
> goes straight into the model. See `110_clocktower/connector-doctrine.md`, which prescribed exactly
> this and was not applied here until v2.16.

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
Appends each response (with its prompt and a timestamp) to a local JSONL. On its own that is just a
log. The value comes from a separate scheduled job you write: it samples a handful of recent
responses, scores them against the soul core, and alerts you if the assistant is drifting away from
its own voice. The hook is the cheap capture; the scoring is deliberately out of band, because a Stop
hook cannot afford to think.

It **redacts before writing**, through the same patterns `secret-write-guard.js` uses
(`reference/secret-patterns.js`), keeps only the most recent 500 records, and writes `0600`. This
hook sees every response, which means it sees every credential the assistant was shown or generated;
an unbounded, world-readable, verbatim transcript of your entire working life is a liability with no
upside. Drift scoring never needed the whole history.

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
**Tier: speed bump.** Pattern-matches dangerous commands and blocks them with an explanation the
assistant can act on. The starter set covers `rm -rf` against broad paths and unscoped globs,
force-pushes to main/master (including the `+main` refspec spelling), fetch-piped-to-any-interpreter,
echoing secrets into files, and `chmod 777`. It denies only unconditional destruction and leans on
"ask" for anything ambiguous, because falsely blocking real work is worse than missing an edge case.

Know what this is: it matches the literal word `rm`, so `/bin/rm` and `busybox rm` are not its job —
they are `bash-deny-guard.py`'s (loop i). Keep it as a fast, readable first pass and let the fence
behind it do the structural work. `reference/tests/test-pretooluse-guard.mjs` holds the corpus,
including the spellings that walked past the v2.15 version (`rm --recursive --force /`,
`rm -rf "$HOME"`, `git push origin +main`, `curl x | zsh`).

That starter set is the floor, not the point. The top of the `RULES` array is a block reserved for
**your own working protocol**, and it ships empty. This is the only place a personal rule can fire
*before* the command it governs. A rule written in prose (in your `CLAUDE.md`, in memory, in a doc)
can only ever be recalled, and recall is triggered by relevance scoring over recent turns, so it
trails the action: the reminder about rebasing arrives two or three turns after the merge. That
reads like broken memory and is not. It is a rule with no enforcement point.

Do not sit down and try to enumerate your rules into that block. Nobody can recall their own
protocol cold; people only recognize one being violated. Wait instead for the next reminder that
arrives *after* you have already done the thing, because at that moment you are holding both
halves of the rule: the command you just ran is the regex, and the reminder text is the reason.
Paste them in and that reminder has fired late for the last time. Captured one at a time as they
annoy you, three or four rules is a complete set. Ship it empty and let the misses write it.

### g. Dispatch router (`agent-model-router.js`, PreToolUse on the Agent tool)
Rewrites subagent dispatch parameters by policy: some agents should always run on a certain model, and
nobody should have to remember that. The hook injects the model when policy matches and the caller did
not already pin one. An explicit choice on the dispatch always wins; the router only fills the gap.

It emits `updatedInput` and **no `permissionDecision`**. That is load-bearing: this hook used to send
`permissionDecision: "allow"` alongside the rewrite, which is not a no-op — "allow" bypasses the
permission system for that call, so a hook whose entire job is "pick a model" was also silently
auto-approving every dispatch it touched. Routing is not authorization. If you add a hook that
rewrites input, check that you are not granting permission as a side effect.

### h. Update check (`update-check.js`, SessionStart)
A clone is a detached copy; nothing tells you an upstream release exists. This hook is that signal,
delivered into the session instead of relying on you to watch the repo. At most once a day it fetches
the upstream template's `STACK_VERSION`, compares it numerically to your local stamp, and if you are
behind injects one line: a newer template is out, type `/upgrade`. Between checks it reads a cached
version, so the network is touched only once a day while the nudge keeps showing until you upgrade.
Two things make it safe to run every session: it is fail-soft on everything (no network, a 404, a
timeout, a disabled flag all mean emit nothing and exit 0), and it treats the fetched body as
**untrusted remote input**. The only value it will accept from the network is a string matching
`^v\d+(\.\d+)*$`; it never injects any other remote content into the context. That is deliberate:
a SessionStart hook's stdout goes into the model, so echoing arbitrary upstream text would let the
repo owner inject instructions into every subscriber's session. The nudge is local static text built
from two version numbers, nothing else. Off-switch: `updateCheck: false` in the `stackUpdateCheck`
settings block, or the `STACK_UPDATE_CHECK=off` env var. Privacy: an enabled check makes one HTTPS GET
to GitHub per day, exposing your IP the same way visiting the repo would; turn it off if that matters.

### i. Deny-list depth (`bash-deny-guard.py`, PreToolUse on Bash)
**Tier: fence.** The settings `deny` list matches command strings whole, so `git status && rm -rf
~/.ssh` sails past a `rm -rf ~/.ssh` deny because the string starts with `git`. This hook tokenizes
the command properly (stdlib `shlex`, POSIX quoting), splits it into real sub-commands across `&&`,
`||`, `;`, pipes, newlines, `$()`, `<()`, and backticks, normalizes each binary before matching
(`/bin/rm`, `\rm`, `command rm`, `env FOO=1 rm`, `sudo rm`, `busybox rm` all resolve to `rm`), and
checks the result against your merged deny patterns.

Three properties worth stating precisely, because the v2.15 description of this hook was wrong
about the first two:

- **Quoting is handled by the tokenizer, not a regex.** A `<<` inside a quoted string is a character
  in a word, not a heredoc marker. This is the fix for the bypass class described at the top of this
  file, and it is structural rather than patched.
- **It fails CLOSED.** A command that cannot be tokenized is denied, with a reason. The previous
  version wrapped everything in `except: pass` and allowed on error. A guard that fails open is a
  door.
- **It never emits "allow".** deny / ask / silent only, where silent falls through to Claude Code's
  normal permission prompting. It can make the system stricter, never looser.

What it is *not*: it cannot resolve `$VAR`, aliases, shell functions, or the contents of a script it
invokes, because those are runtime facts and this runs before runtime. Spawn-capable shapes
(`git -c core.pager=...`, `find -exec`, `npm run`, any interpreter) escalate to "ask" rather than
being judged. Unknown binaries escalate too, configurable via `bashGuard.unknownBinaryPolicy`.
Override with `LARARIUM_GUARD=off`, which disables the structural tiers but *not* your deny list.

Corpus: `reference/tests/test-bash-deny-guard.py`, 59 cases, plus
`reference/tests/test-hook-chain.sh`, which runs the guards the way Claude Code runs them and
**attributes every verdict to a named hook**. That attribution matters more than it sounds: your
settings `permissions.deny` is both the input to this guard *and* Claude Code's own enforcement
layer, so a test that puts patterns there cannot tell you which one caught a command. The chain
test supplies patterns via `CLAUDE_SETTINGS_PATH` instead, a file Claude Code does not read, so
nothing is masked. Derived from liberzon/claude-hooks
smart-approve.py (MIT) for the settings-merging and pattern syntax; the analysis engine is a rewrite.

### j. Secret-write guard (`secret-write-guard.js`, PreToolUse on Write|Edit|Bash)
Scans the content about to be written (not the file on disk) for credential patterns: cloud keys,
API tokens, private-key blocks, DB URLs with passwords, JWTs. On a hit it returns "ask" with line
numbers, never "deny", because a matched pattern can be a test fixture. Files named `.env*` are
exempt; that is where secrets are supposed to live.

**Bash is in the matcher deliberately.** A write is a write: `cat > config.py <<EOF ... EOF` puts a
key on disk without ever touching the Write tool, so matching `Write|Edit` alone left the obvious
hole open. Patterns live in `reference/secret-patterns.js`, shared with `voice-log.js` so the two
hooks cannot drift into disagreeing about what a secret is — they used to, and the log won.

## The laws

These are not style preferences. Break one and you will eventually wedge a session or leak a slow hook
into every turn.

- **Fail soft — except where soft means open.** An *observer* hook that throws must exit 0 and inject
  nothing: a briefing is a nice-to-have, a working session is not negotiable, and the correct failure
  mode is "silently do nothing," never "crash the turn." That covers session-start, the heartbeat,
  voice-log, and the update check, all of which swallow errors on purpose.

  A *guard* is the opposite, and conflating the two is how this layer shipped a bypass. If
  `bash-deny-guard.py` cannot parse a command, "silently do nothing" means the command runs
  unchecked — the guard has failed **open**, which is the one outcome it exists to prevent. So it
  denies instead, with a reason and a documented override (`LARARIUM_GUARD=off`). Note that a hook
  can only ever fail closed on its *own* logic: it still exits 0 and still cannot wedge the session.
  The rule is: **observers fail soft, guards fail closed.** Decide which one you are writing before
  you write the try/catch.
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
echo '{"source":"startup"}' | STACK_UPDATE_CHECK_FIXTURE=v9.9 node reference/update-check.js
echo '{"tool_name":"Bash","tool_input":{"command":"git status && rm -rf ~/.ssh"}}' | python3 reference/bash-deny-guard.py
echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/x.py","content":"key=\"AKIAIOSFODNN7EXAMPLE\""}}' | node reference/secret-write-guard.js
```

The guard should print a deny JSON for the destructive command and print nothing for a safe one. The
router should print an `updatedInput` for a policy-matched agent and nothing otherwise. The
briefing hook should print whatever 010_soul/heartbeat/now files it finds (and nothing, cleanly, if none
exist yet). The update checker carries a fixture seam (`STACK_UPDATE_CHECK_FIXTURE`) that stands in
for the network so you can drive all five of its paths without a mock; the header comment lists the
exact one-liners for behind, current, garbage-response, disabled, and a real fetch. If any of them
throws or exits non-zero, fix that before wiring it in.

## The wiring

Copy the reference hooks to wherever you keep hook scripts (the example uses `~/.claude/hooks/stack/`)
and add the `hooks` block from `settings.example.json` to your Claude Code `settings.json`. The block
registers all six reference hooks against their events: two on `SessionStart` (the briefing and the
update checker, both of whose stdout is injected), and two PreToolUse entries, one matched to `Bash`
for the safety rail, one matched to `Agent` for the dispatch router. The example file also carries a
top-level `stackUpdateCheck` block, the config the update checker reads (toggle + upstream); copy it
alongside the `hooks` block.

```json
{
  "stackUpdateCheck": { "updateCheck": true, "templateUpstream": "kylnor/lararium" },
  "hooks": {
    "SessionStart": [
      { "hooks": [
        { "type": "command", "command": "node ~/.claude/hooks/stack/session-start.js" },
        { "type": "command", "command": "node ~/.claude/hooks/stack/update-check.js" }
      ] }
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
handoff, and the update-check state file) and a `100_brain/now.md`. Those are conventions, not
requirements: every path is a named constant at the top of each file. Point them at wherever your
soul, brain, and working files actually live before you wire anything in.

One path is deliberately NOT in `~/.assistant/`: your installed `STACK_VERSION` stamp. The install and
upgrade interviews write it at your stack's repo **root** (the folder you cloned the template into),
and that is the single source of truth, never copied into `~/.assistant/`. The update checker reads it
from the absolute path named by `stackUpdateCheck.localVersionFile` in `~/.claude/settings.json`, which
the install interview fills in with your real repo-root path. The checker reads the rest of its config
(toggle, upstream) from that same `stackUpdateCheck` block; when a key or the file is absent it falls
back to the constants at the top of the hook, and an absent stamp reads as v1.

## What these deliberately do not do

The reference hooks read local files where the live system reads a database. Every place a real index
query would happen is stubbed behind a file read with a comment saying so. That is intentional: the
pattern is identical whether the read hits a JSONL on disk or a vector index over your whole life. Get
the loop working against files first, then swap the stub for your index when the file layer outgrows
it. Start simple; the shape does not change.
