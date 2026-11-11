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

The briefing also injects the pointer lines of `memory/MEMORY.md` (up to 200 lines or about 24KB,
the cut a loader applies), so lessons recorded as cards are in context from the first turn. It
injects nothing when the index has no pointers.

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
The settings `deny` list can miss a denied command inside a compound command. This hook checks
both the full command string and each executable sub-command against the merged deny patterns.
It emits `deny` or nothing, never `allow` or `ask`. Hook denies also apply in bypass-permissions
sessions. Derived from liberzon/claude-hooks smart-approve.py (MIT), with the allow path removed.

The scanner reads supported Bash quoting, escapes, word-boundary comments, command separators,
groups, conditionals and substitutions. Quoted shift text, arithmetic shifts and here-strings
cannot open heredocs. It reads multiple heredocs in order and honors `<<-` tab stripping. Bodies are data with
two exceptions: an unquoted delimiter permits executable `$()` and backtick substitutions, and a
heredoc or here-string attached directly to a shell is checked as shell commands, even when quoted.
A body attached to `cat` and piped into a shell stays run-time data.
Inside `${ }`, arithmetic, and any word that begins with a name and a subscript such as
`arr['...']`, a quoted substitution is treated as code even where Bash would leave it as
text, because Bash evaluates such subscripts in assignments and in several builtins.

For each command, matching retains its written form and also normalizes the command word: quotes
and backslashes are removed, paths become basenames, and wrappers with their options are peeled.
The wrappers are `command`, `builtin`, `exec`, `env`, `sudo`, `doas`, `nohup`, `time`, `timeout`,
`nice`, `ionice`, `stdbuf`, `setsid`, `busybox` and `xargs`. Known value options consume their value;
unknown options check both readings. `command -v` and `command -V` are lookups. Ordinary command
arguments are never treated as fresh command starts. Shell `-c` strings, `eval`, `env -S` and
`find` execution clauses are checked recursively, up to eight levels.

While deny patterns are configured, the guard denies what it cannot parse: a NUL byte, a carriage
return, unterminated syntax in any scanner, or a heredoc whose exact terminator never appears.
It also rejects these constructs: parentheses in arithmetic parameter expansions, process
substitution text in arithmetic, expansions in heredoc delimiters, unsupported backslash-newlines
touching operators, and extended glob operators outside arithmetic and conditional regex operands.
An unquoted `?(`, `*(`, `+(`, `@(` or `!(` is rejected even when preceded by `$` or `$$`.
Special parameters without an adjacent `(`, double-quoted text and heredoc body text remain supported.
A command that turns `extglob` on is also denied as not analyzed, including computed option names
with `shopt -s` or shell `-O`, and assignments of `BASHOPTS` that could enable it.
Continuations after complete control operators remain supported when the next character is not
an operator character.
Unterminated syntax includes quotes, substitutions, parameter and arithmetic expansions, arithmetic
commands, array initializers and `[[` conditionals, including in nested shell strings and expansions.
A heredoc also fails if input ends or an enclosing substitution closes before the body newline.
Here-strings have no terminator and are unaffected by the heredoc rule.
The reason names the byte, syntax kind, construct or heredoc delimiter in this form:
`Command not analyzed: <what>. This guard denies what it cannot parse while deny patterns are configured.`
A guard error with configured deny patterns fails closed with a reason explaining how to remove
the hook from settings. With no deny patterns, or unreadable settings, the hook stays silent.

Two checks run in order: the parser first, then an unchanged copy of the previous release's
matcher if the parser stays silent. Either check can deny. Parser denials keep their existing
reasons. Legacy denials start with `Legacy check: ` to identify the check.
Every command the previous release denied is still denied.
The property test checked 1,429 must-deny rows: 0 silent.
The legacy check has a two-second time budget on the main thread when a signal timer is available.
Otherwise it runs directly without a time limit. An error, recursion failure or timeout leaves
the parser's decision intact. Neither check runs shell code.

This guard runs before Bash. It cannot resolve variables or computed command words such as `$CMD`,
`$(echo rm)`, brace expansions, globs or `${IFS}`, aliases or functions defined elsewhere (function
bodies written in the command are checked), script contents, interpreter payloads such as `python3 -c`
and `node -e`, strings a builtin evaluates again at run time, such as the arguments of `let`,
`declare`, `unset`, `read`, `trap` and `alias`, data piped into a shell at run time, or binaries that
have been renamed or copied. Shell command strings are checked only for `sh`, `bash`, `zsh`, `dash`
and `ksh`; other shells and `su -c` are not checked. A script sourced from standard input is not checked.
These are limits of static inspection. This guard is a backstop that makes a deny list much harder
to slip past. It is not a sandbox or a security boundary: a hand-written scanner cannot model all
of Bash, and review of this hook kept finding new shapes that reached a denied command. Pair it
with real isolation, such as `lab/`, for untrusted input.

**Known over-denials:** a backslash-newline touching `|`, `;`, `&` or another operator character
inside double quotes, or directly after `;;` in a `case` body, is denied although Bash runs
nothing denied. Put the line break elsewhere.
`[[ x =~ $$$@(x) ]]` style regex operands are also denied as not analyzed: a `$$` directly
before `@(`, `?(`, `*(`, `+(` or `!(` in arithmetic or a `=~` operand can trigger the
conservative extended-glob check.
Accepted over-denials inherited from the previous matcher are pinned in ten test rows.
Bash runs nothing denied in these cases: command substitution text inside single quotes in
plain words, array elements, `let` arguments and `[[ =~ ]]` operands; bodies of heredocs with
a quoted or escaped delimiter and of several heredocs on one line; text after `#` following a
redirection operator; and a deny-listed word alone on a line inside a multi-line `case` pattern.
These denials start with `Legacy check: `.

**Known open:** review found 13 rows that reach a denied command but are not denied by either
check. The previous release also did not deny them, so these are not regressions:

- `for NAME` without `in`, and `for (( ... ))`, followed directly by `do` or `{` (3).
- `xargs` long options with optional arguments, such as `--replace` and `--max-lines`,
  followed by a command (2).
- GNU `env -S` strings using the `\_` escape (1).
- A `#` comment inside an array initializer, quoted variants (2).
- Array subscript variants, including an indexed assignment used as a prefix to a command (2).
- The `$'\c\''` ANSI-C control escape followed by a quote (1).
- `$$'` inside `$(( ))` (2).

The run-time limits above still apply. This guard is not a sandbox or a security boundary.

To upgrade an existing install, copy `hooks/reference/bash-deny-guard.py` over the installed copy.
Updating this template alone does not update a copied hook.

### j. Secret-write guard (`secret-write-guard.js`, PreToolUse on Write|Edit)
Scans the content about to be written (not the file on disk) for credential patterns: cloud keys,
API tokens, private-key blocks, DB URLs with passwords, JWTs. On a hit it returns "ask" with line
numbers, never "deny", because a matched pattern can be a test fixture. Files named `.env*` are
exempt; that is where secrets are supposed to live. This is the enforcement half of a "no secrets
in repos" rule: the rule in prose catches nothing at 2am, the hook does.

## The laws

These are not style preferences. Break one and you will eventually wedge a session or leak a slow hook
into every turn.

- **Fail soft, always.** A hook that throws must exit 0 and inject nothing. Never block a session on
  infrastructure failure. Every reference hook wraps its body in try/catch and swallows the error. A
  briefing is a nice-to-have; a working session is not negotiable. The correct failure mode is
  "silently do nothing," never "crash the turn." The one exception is `bash-deny-guard.py`: after
  deny patterns load, a guard error emits a deny so a broken guard cannot silently bypass them.
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
echo '{"tool_name":"Agent","tool_input":{"subagent_type":"reviewer","prompt":"x"}}' | node reference/agent-model-router.js
echo '{"source":"startup"}' | STACK_UPDATE_CHECK_FIXTURE=v9.9 node reference/update-check.js
echo '{"tool_name":"Bash","tool_input":{"command":"git status && rm -rf ~/.ssh"}}' | python3 reference/bash-deny-guard.py
echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/x.py","content":"key=\"AKIAIOSFODNN7EXAMPLE\""}}' | node reference/secret-write-guard.js
```

The guard should print a deny JSON for the destructive command and print nothing for a safe one. The
router should print an `updatedInput` for a policy-matched agent and nothing otherwise. The
briefing hook should print whatever soul/heartbeat/now files it finds (and nothing, cleanly, if none
exist yet). The update checker carries a fixture seam (`STACK_UPDATE_CHECK_FIXTURE`) that stands in
for the network so you can drive all five of its paths without a mock; the header comment lists the
exact one-liners for behind, current, garbage-response, disabled, and a real fetch. If any of them
throws or exits non-zero, fix that before wiring it in.

## The wiring

**Memory ships wired.** The template's `.claude/settings.json` registers the two memory hooks as
project hooks, `node "$CLAUDE_PROJECT_DIR/hooks/reference/session-start.js"` and the heartbeat
writer in the same shape. Claude Code runs them in any conversation opened in the stack folder once
the folder is trusted. No absolute path, no env var, nothing to set. Add more hooks to that file in
the same shape. The rest of this section is for wiring hooks globally, so they also run in
conversations opened elsewhere.

Copy the reference hooks to wherever you keep hook scripts (the example uses `~/.claude/hooks/stack/`)
and add the `hooks` block from `settings.example.json` to your Claude Code `settings.json`. The block
registers all eight reference hooks against their events: two on `SessionStart` (the briefing and the
update checker, both of whose stdout is injected), one on `SessionEnd` (the heartbeat), one on `Stop`
(the voice log), and four PreToolUse hooks in three entries (two matched to `Bash` for the safety
rails, one to `Agent` for the dispatch router, one to `Write|Edit` for the secret guard). The example file also carries a
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
      { "matcher": "Bash", "hooks": [
        { "type": "command", "command": "node ~/.claude/hooks/stack/pretooluse-guard.js" },
        { "type": "command", "command": "python3 ~/.claude/hooks/stack/bash-deny-guard.py", "timeout": 10 }
      ] },
      { "matcher": "Agent", "hooks": [ { "type": "command", "command": "node ~/.claude/hooks/stack/agent-model-router.js" } ] },
      { "matcher": "Write|Edit", "hooks": [ { "type": "command", "command": "node ~/.claude/hooks/stack/secret-write-guard.js", "timeout": 10 } ] }
    ]
  }
}
```

## Paths and where the files live

The reference hooks read from a stack home at `~/.assistant/` (soul core, heartbeat, voice log,
handoff, and the update-check state file) and a `brain/now.md`. Those are conventions, not
requirements. The two memory hooks find their stack in this order: `LARARIUM_ROOT` if it is set
(one absolute path), else the stack they ship in (they live at `hooks/reference/` inside it, so
moving or renaming the folder moves the memory with it), else the legacy `~/.assistant/` layout
for copies kept elsewhere. Either way they use `soul/heartbeat.md` under that root; startup also
reads `soul/core.md`, `brain/now.md`, and `handoff.md` there. A `core` or `now.md` still holding
the shipped template is announced in one line instead of injected. Other reference hooks keep
their own path settings. Do not infer that all hooks are configured just because memory is.

One path is deliberately NOT in `~/.assistant/`: your installed `STACK_VERSION` stamp. It lives at
your stack's repo **root** (the folder you scaffolded or cloned the template into), and that is the
single source of truth, never copied into `~/.assistant/`. The update checker finds it on its own
when it runs from inside the stack, so there is nothing to configure. Only if you copied the hooks
elsewhere, add `stackUpdateCheck.localVersionFile` (an absolute path to that stamp) to
`~/.claude/settings.json`. The checker reads the rest of its config (toggle, upstream) from that
same `stackUpdateCheck` block; when a key or the file is absent it falls back to the constants at
the top of the hook, and an absent stamp reads as v1.

## What these deliberately do not do

The reference hooks read local files where the live system reads a database. Every place a real index
query would happen is stubbed behind a file read with a comment saying so. That is intentional: the
pattern is identical whether the read hits a JSONL on disk or a vector index over your whole life. Get
the loop working against files first, then swap the stub for your index when the file layer outgrows
it. Start simple; the shape does not change.

## Pointing other agents at the same memory (`memory-pointers.mjs`)

Not a lifecycle hook. A one-shot installer for the shared pointer block (`memory/pointer-block.md`)
that tells Claude Code, Codex and Gemini CLI where the map and the memory cards live. Usage:
`node hooks/memory-pointers.mjs <stack-folder> [--project] [--check] [--only claude,codex,gemini]`.
It is idempotent, appends after any block another tool manages, writes through symlinks, refuses
on unbalanced markers, and `--check` changes nothing. These hooks capture for Claude Code only;
the other CLIs share the files, not the capture.

## Diagnose memory without changing it

Run `node hooks/memory-check.mjs .` from the installed template root. This read-only diagnostic
reports missing, empty, or unreadable standard brain files without printing their contents.
It does not inspect hook registration or claim that capture works. Follow
[the memory acceptance check](../docs/memory-check.md) for fresh-session recall and corrections.

`memory-check.mjs` also reads `memory/`: it flags a card with no pointer (orphaned), a pointer to a
missing card (dangling), bad frontmatter, and an index past the 200-line cut a loader applies. It
never edits the index.

Developer checks: `node --test hooks/memory-check.test.mjs`.

## Automatic memory contract

The heartbeat keeps excerpts from the last four completed exchanges in the session. It is not a
full archive, a fact extractor, or a replacement for curated project notes. User and assistant
excerpts remain labeled. Corrections remain conversation text and need interpretation.

One completed exchange is enough. Missing transcripts, malformed lines, sessions with no completed
exchange, and API-error-only sessions do not replace the last useful heartbeat. Atomic replacement
prevents partially written files from being loaded. If several sessions share a root, the last
writer wins; use separate roots for separate projects. A process killed before SessionEnd runs
cannot save its latest turn. This release does not add a per-turn checkpoint.

Run `node --test hooks/memory-check.test.mjs hooks/memory-loop.test.mjs hooks/memory-pointers.test.mjs hooks/memory-cards.test.mjs`
to test the file contracts.
The live assistant test in `docs/memory-check.md` is still needed to verify hook registration.
