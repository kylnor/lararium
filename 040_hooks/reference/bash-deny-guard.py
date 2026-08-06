#!/usr/bin/env python3
"""Bash guard — fail-CLOSED structural analysis of a command before it runs.

This replaces the regex/string-decomposition guard that shipped through v2.15.
That version was a speed bump: it matched the *spelling* of a command, and every
entry in a deny list has unbounded spellings. Three bypasses were confirmed
against it with a `Bash(rm:*)` deny list in place:

    grep "a<<b" notes.txt \\n rm -rf /important    ALLOWED
    python3 -c "print(1 << 2)" \\n rm -rf /...     ALLOWED
    /bin/rm -rf /important                        ALLOWED

The first two are the same bug: heredoc detection was a regex run against raw
lines, so a `<<` inside a quoted string started a phantom heredoc and every line
after it was swallowed as "data" and never checked. The third is prefix
matching: `rm` and `/bin/rm` are different strings and the same program.

WHAT CHANGED, AND WHAT IT BUYS YOU

  1. Real tokenization (stdlib `shlex`, POSIX mode, punctuation_chars). Quoting
     is now handled by the tokenizer, so `<<` inside a quoted word is a
     character in a word, not an operator. The heredoc class of bypass is gone
     structurally, not patched.
  2. Fail CLOSED. If the command cannot be tokenized (unbalanced quotes, and
     anything else that raises), the answer is DENY. The old guard wrapped
     everything in `except: pass` and allowed on error. A guard that fails open
     is a door.
  3. Binary normalization before matching. `/bin/rm`, `\\rm`, `command rm`,
     `env FOO=1 rm`, `sudo rm` all normalize to `rm` and are matched against
     your deny patterns as `rm`. Absolute-path evasion is gone.
  4. Shape awareness. A program on an allowlist is not safe if it was invoked in
     a way that spawns something else. `git -c core.pager='sh -c ...' log` is
     `git` by name and a shell by behavior. Those shapes escalate to "ask".

WHAT IT STILL IS NOT

  Read this part. It is the honest limit and it does not go away with better
  parsing. This hook reads a command string. It cannot resolve `$VAR`, shell
  aliases, functions defined earlier in the session, or the contents of a script
  it invokes. Those are runtime facts and the guard runs before runtime.

  So: this is a WALL against your own mistakes and a FENCE against a confused
  model. It is NOT a wall against an adversary who controls the prompt. If you
  need that, the enforcement has to move under the shell rather than in front of
  it — a sandbox where the dangerous capability does not exist, credentials that
  are not in the environment, a filesystem that is not mounted. `060_lab/` is
  that shape, pointed at other people's code. See `040_hooks/README.md` for the
  tiering and `sandbox/` for the profile that applies it to your own agent.

DECISION TIERS

  deny    your deny patterns match; the command will not tokenize; a download is
          piped straight into an interpreter. Tight on purpose.
  ask     a spawn-capable shape, or a binary this file does not recognize.
          Escalates to a human instead of guessing.
  silent  known-safe read-only shapes. Silence falls through to Claude Code's
          NORMAL permission flow, which still prompts. This hook never emits
          "allow": that would bypass the permission system and can only widen
          automation. It can make the system stricter, never looser.

OVERRIDE

  Deliberate, visible, and per-invocation:
      LARARIUM_GUARD=off   disables the structural tiers for one command
  Your deny patterns still fire with the override set. Turning off a guard
  should never turn off the list you wrote by hand.

CONFIG (all optional, under "bashGuard" in settings.json)
  enabled              bool,  default true
  unknownBinaryPolicy  "ask" | "silent", default "ask"
  safeExtra            list of binary names to treat as read-only safe
  spawnExtra           list of binary names to always escalate

Source lineage: the settings-merging and Bash(...) pattern parsing come from
liberzon/claude-hooks smart-approve.py (Yair Liberzon, MIT). The analysis engine
is a rewrite.

Input:  JSON on stdin with tool_name and tool_input.command
Output: hookSpecificOutput permissionDecision "deny" | "ask", or silent exit 0

Test standalone:
  echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | python3 bash-deny-guard.py
  python3 tests/test-bash-deny-guard.py     # the bypass corpus, including the
                                            # three confirmed against the old one
"""

import fnmatch
import json
import os
import re
import shlex
import sys


class Unparseable(Exception):
    """The command could not be tokenized. This is a deny, not a skip."""


# ─────────────────────────────────────────────────────────────────────────────
# Settings (kept from the original: same file layers, same Bash(...) syntax)
# ─────────────────────────────────────────────────────────────────────────────

def load_settings(path=None):
    """Load and return a settings dict from one settings.json layer."""
    if path is None:
        path = os.path.expanduser("~/.claude/settings.json")
    path = os.path.expanduser(path)
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def load_merged_settings(global_path=None):
    """Merge the three settings layers Claude Code itself merges.

      1. Global:        ~/.claude/settings.json (or $CLAUDE_SETTINGS_PATH)
      2. Project:       $CLAUDE_PROJECT_DIR/.claude/settings.json
      3. Project-local: $CLAUDE_PROJECT_DIR/.claude/settings.local.json
    """
    settings = load_settings(global_path)

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR")
    if not project_dir:
        return settings

    shared = load_settings(os.path.join(project_dir, ".claude", "settings.json"))
    local = load_settings(os.path.join(project_dir, ".claude", "settings.local.json"))
    if not shared and not local:
        return settings

    def merge(key):
        return list(dict.fromkeys(
            settings.get("permissions", {}).get(key, [])
            + shared.get("permissions", {}).get(key, [])
            + local.get("permissions", {}).get(key, [])
        ))

    settings.setdefault("permissions", {})
    settings["permissions"]["deny"] = merge("deny")
    settings["permissions"]["allow"] = merge("allow")
    # bashGuard config: later layers win on a per-key basis.
    guard = {}
    for layer in (settings, shared, local):
        block = layer.get("bashGuard")
        if isinstance(block, dict):
            guard.update(block)
    if guard:
        settings["bashGuard"] = guard
    return settings


def parse_bash_patterns(patterns):
    """"Bash(git status:*)" -> ("git status", "git status *"). Non-Bash skipped."""
    result = []
    for pat in patterns:
        m = re.match(r'^Bash\((.+)\)$', pat)
        if not m:
            continue
        inner = m.group(1)
        colon = inner.find(':')
        if colon == -1:
            result.append((inner, inner))
        else:
            prefix, suffix = inner[:colon], inner[colon + 1:]
            result.append((prefix, prefix + ' ' + suffix if suffix else prefix))
    return result


def command_matches_pattern(cmd, patterns):
    """Exact-prefix or glob match against parsed Bash(...) patterns."""
    for prefix, glob_pat in patterns:
        if cmd == prefix or fnmatch.fnmatch(cmd, glob_pat):
            return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
# Tokenization
# ─────────────────────────────────────────────────────────────────────────────

OPERATORS = {';', '&&', '||', '|', '&', ';;', '|&'}


def is_separator(tok):
    """True for control operators and for runs of newlines.

    shlex emits consecutive newlines as a single token ('\\n\\n'), so this tests
    the shape rather than listing every run length.
    """
    return tok in OPERATORS or (tok != '' and tok.strip() == '')
REDIRECTS = {'<', '>', '>>', '<<', '<<-', '<<<', '>&', '<&', '&>', '&>>', '2>', '2>>'}


def tokenize(command):
    """Tokenize with POSIX quoting rules. Raises Unparseable on any failure.

    `punctuation_chars` makes shlex emit `;`, `&&`, `||`, `|`, `(`, `)`, `<`,
    `>` as their own tokens while leaving quoted text intact. That is the whole
    fix for the heredoc bypass: a `<<` inside quotes never becomes an operator,
    because the tokenizer knows what a quote is.

    Newline is moved OUT of `whitespace` and INTO `punctuation_chars` so that a
    newline separates commands instead of vanishing. Leaving it as whitespace
    silently glues `ls\\nrm -rf /` into one command whose binary is `ls`, which
    is the same class of bug this rewrite exists to kill. A newline inside
    quotes is still ordinary data, because quoting is handled first.
    """
    try:
        lx = shlex.shlex(command, posix=True, punctuation_chars='();<>|&\n')
        lx.whitespace_split = True
        lx.whitespace = ' \t\r'
        # shlex's own comment handling truncates at '#' ANYWHERE in a word,
        # which bash does not do. That divergence hides code: with it on,
        # `curl http://x/#y | sh` loses the pipe and reads as a bare curl.
        # Comments are stripped below instead, with bash's actual rule.
        lx.commenters = ''
        return list(lx)
    except ValueError as exc:
        raise Unparseable(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - any tokenizer failure is a deny
        raise Unparseable(f"tokenizer error: {exc}") from exc


BACKTICK_RE = re.compile(r'`([^`]*)`')


def extract_backticks(command):
    """shlex does not split backticks, so pull their contents out separately.

    Returns the inner command strings. Nested backticks are not legal without
    escaping, so one level is the whole surface.
    """
    return [m.group(1) for m in BACKTICK_RE.finditer(command) if m.group(1).strip()]


def strip_comments(tokens):
    """Drop `#` comments using bash's rule, not shlex's.

    Bash starts a comment only when `#` begins a word; `http://x/#y` is not a
    comment. Only a token that is EXACTLY `#` is treated as a starter, which is
    the conservative direction: a missed comment leaves extra tokens that
    escalate to "ask", while an over-eager one would hide a real command.
    """
    out = []
    skipping = False
    for tok in tokens:
        if skipping:
            if tok != '' and tok.strip() == '':  # newline run ends the comment
                skipping = False
                out.append(tok)
            continue
        if tok == '#':
            skipping = True
            continue
        out.append(tok)
    return out


def strip_heredoc_bodies(tokens):
    """Drop heredoc BODIES (they are data), keep everything else.

    Correct heredoc handling, unlike the version this replaces: `<<` is only
    honored when the TOKENIZER produced it as an operator, which means it was
    unquoted. `grep "a<<b" f` never reaches here as a heredoc.
    """
    out = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok in ('<<', '<<-') and i + 1 < len(tokens):
            delim = tokens[i + 1]
            i += 2
            # Everything up to the delimiter token is the body: data, not code.
            while i < len(tokens) and tokens[i] != delim:
                i += 1
            i += 1  # consume the closing delimiter
            continue
        out.append(tok)
        i += 1
    return out


def split_commands(tokens):
    """Split a token stream into individual commands.

    Splits on control operators and recurses into $( ) command substitutions,
    which are separate commands that really do execute.
    """
    commands = []
    current = []
    depth_stack = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]

        # Nested command contexts, all of which really do execute:
        #   $( ... )   command substitution
        #   <( ... )   process substitution   (shlex emits "<(" as one token)
        #   >( ... )   process substitution
        # Missing these is a silent bypass: `cat <(rm -rf /x)` reads as a bare
        # `cat` once the redirection is stripped, and `rm` never gets checked.
        opens_nested = (
            (tok == '$' and i + 1 < len(tokens) and tokens[i + 1] == '(')
            or tok in ('<(', '>(')
        )
        if opens_nested:
            depth = 0
            j = i + 1 if tok == '$' else i
            inner = []
            while j < len(tokens):
                cur = tokens[j]
                if cur in ('(', '<(', '>('):
                    depth += 1
                    if depth == 1:
                        j += 1
                        continue
                elif cur == ')':
                    depth -= 1
                    if depth == 0:
                        break
                inner.append(cur)
                j += 1
            if depth != 0:
                raise Unparseable("unbalanced command substitution")
            commands.extend(split_commands(inner))
            i = j + 1
            continue

        if tok == '(':
            depth_stack.append(tok)
            i += 1
            continue
        if tok == ')':
            if depth_stack:
                depth_stack.pop()
            i += 1
            continue

        if is_separator(tok):
            if current:
                commands.append(current)
            current = []
            i += 1
            continue

        current.append(tok)
        i += 1

    if current:
        commands.append(current)
    return commands


# ─────────────────────────────────────────────────────────────────────────────
# Normalization: what program is this, really?
# ─────────────────────────────────────────────────────────────────────────────

ASSIGNMENT_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*=')

# Wrappers that run their argument as the real command. Peeled off to find it.
# `busybox` belongs here for the same reason as `command`: `busybox rm` is rm.
WRAPPERS = {'command', 'builtin', 'exec', 'time', 'nohup', 'nice', 'ionice',
            'stdbuf', 'setsid', 'env', 'sudo', 'doas', 'timeout', 'busybox'}

# Some wrappers take a bare numeric argument before the real command
# (`timeout 5 rm ...`, `nice -n 5 rm ...`). Without this the peel stops on the
# number and the binary reads as "5", which downgrades a deny to an ask.
NUMERIC_ARG_RE = re.compile(r'^[0-9]+(\.[0-9]+)?[smhdkKmMgG]?$')

# Wrappers whose presence is itself worth a human look.
NOTABLE_WRAPPERS = {'sudo', 'doas'}

SHELL_KEYWORDS = {'do', 'done', 'then', 'else', 'elif', 'fi', 'esac', 'in',
                  '{', '}', 'break', 'continue', 'for', 'while', 'until', 'if',
                  'case', 'select', 'function'}


def normalize(tokens):
    """Peel assignments, wrappers, and paths down to (binary, args, notes).

    Returns (None, [], notes) when there is no real command (a bare assignment,
    a shell keyword, a pure redirection).
    """
    notes = []
    toks = [t for t in tokens if t not in REDIRECTS]
    # Drop redirection targets: `> file` leaves `file` dangling as an argument.
    cleaned = []
    skip_next = False
    for idx, t in enumerate(tokens):
        if skip_next:
            skip_next = False
            continue
        if t in REDIRECTS:
            skip_next = True
            continue
        cleaned.append(t)
    toks = cleaned

    while toks:
        head = toks[0]
        if ASSIGNMENT_RE.match(head):
            toks = toks[1:]
            continue
        if head in SHELL_KEYWORDS:
            toks = toks[1:]
            continue
        break

    if not toks:
        return None, [], notes

    # Peel wrappers. `env FOO=1 rm -rf /` and `sudo rm -rf /` are both `rm`.
    guard = 0
    while toks and guard < 10:
        guard += 1
        head = toks[0]
        base = os.path.basename(head.lstrip('\\'))
        if base in WRAPPERS:
            if base in NOTABLE_WRAPPERS:
                notes.append(base)
            rest = toks[1:]
            # env/sudo carry assignments and flags before the command; timeout
            # and nice carry a bare number. Peel all three shapes.
            while rest and (ASSIGNMENT_RE.match(rest[0])
                            or rest[0].startswith('-')
                            or NUMERIC_ARG_RE.match(rest[0])):
                rest = rest[1:]
            if not rest:
                return base, [], notes
            toks = rest
            continue
        break

    if not toks:
        return None, [], notes

    binary = os.path.basename(toks[0].lstrip('\\'))
    return binary, toks[1:], notes


# ─────────────────────────────────────────────────────────────────────────────
# Policy: which shapes are safe, which spawn, which are unknown
# ─────────────────────────────────────────────────────────────────────────────

# Read-only enough that any argument shape is fine. Deliberately generous: a
# guard that cries wolf gets disabled, and a disabled guard protects nothing.
SAFE_READONLY = {
    'ls', 'pwd', 'echo', 'printf', 'cat', 'head', 'tail', 'wc', 'file', 'stat',
    'date', 'whoami', 'hostname', 'uname', 'df', 'du', 'basename', 'dirname',
    'realpath', 'readlink', 'sort', 'uniq', 'cut', 'tr', 'column', 'rg', 'grep',
    'egrep', 'fgrep', 'diff', 'cmp', 'shasum', 'md5sum', 'sha256sum', 'tree',
    'which', 'type', 'true', 'false', 'test', 'seq', 'yes', 'sleep', 'id',
    'groups', 'tty', 'locale', 'printenv', 'jq', 'cd', 'pushd', 'popd',
}

# Always a human decision: these exist to run other code.
ALWAYS_SPAWN = {
    'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh',
    'python', 'python2', 'python3', 'perl', 'ruby', 'node', 'deno', 'bun',
    'php', 'lua', 'Rscript', 'osascript', 'eval', 'source', '.',
    'xargs', 'parallel', 'ssh', 'scp', 'sftp', 'telnet', 'nc', 'ncat', 'socat',
    'docker', 'podman', 'kubectl', 'systemctl', 'launchctl', 'crontab', 'at',
    'chroot', 'unshare', 'nsenter', 'gdb', 'lldb', 'strace', 'dtrace',
}

# Safe by name, spawn-capable in specific shapes. Value = arg predicates.
CONDITIONAL_SPAWN = {
    'git':    lambda a: any(x == '-c' or x.startswith('--exec-path') or
                            x in ('--upload-pack', '--receive-pack') for x in a),
    'find':   lambda a: any(x in ('-exec', '-execdir', '-ok', '-okdir',
                                  '-delete', '-fprintf', '-fprint') for x in a),
    'awk':    lambda a: any('system(' in x or 'print >' in x or '| "' in x or
                            "| '" in x for x in a),
    'gawk':   lambda a: any('system(' in x or 'print >' in x for x in a),
    'mawk':   lambda a: any('system(' in x for x in a),
    'sed':    lambda a: any(x.startswith('-i') or 'w /' in x or 'e ' in x for x in a),
    'vim':    lambda a: any(x == '-c' or x.startswith('+') or x == '--cmd' for x in a),
    'vi':     lambda a: any(x == '-c' or x.startswith('+') for x in a),
    'nvim':   lambda a: any(x == '-c' or x.startswith('+') or x == '--cmd' for x in a),
    'less':   lambda a: any(x.startswith('+') for x in a),
    'tar':    lambda a: any(x.startswith('--to-command') or
                            x.startswith('--checkpoint-action') or
                            x.startswith('--use-compress-program') for x in a),
    'rsync':  lambda a: any(x == '-e' or x.startswith('--rsh') for x in a),
    'npm':    lambda a: bool(a) and a[0] in ('run', 'run-script', 'exec', 'start',
                                             'test', 'install', 'i', 'ci', 'publish'),
    'yarn':   lambda a: True,
    'pnpm':   lambda a: True,
    'npx':    lambda a: True,
    'make':   lambda a: True,
    'cmake':  lambda a: True,
    'go':     lambda a: bool(a) and a[0] in ('run', 'generate', 'test', 'install'),
    'cargo':  lambda a: bool(a) and a[0] in ('run', 'test', 'install', 'build'),
    'pip':    lambda a: bool(a) and a[0] in ('install', 'download'),
    'pip3':   lambda a: bool(a) and a[0] in ('install', 'download'),
    'brew':   lambda a: bool(a) and a[0] in ('install', 'upgrade', 'reinstall'),
    'curl':   lambda a: any(x.startswith('-o') or x == '--output' or
                            x == '-O' or x == '--remote-name' for x in a),
    'wget':   lambda a: any(x.startswith('-O') or x == '--output-document' for x in a),
}

INTERPRETERS = {'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'python', 'python2',
                'python3', 'perl', 'ruby', 'node', 'php', 'lua'}
FETCHERS = {'curl', 'wget', 'fetch', 'aria2c', 'http', 'httpie'}


def piped_download_into_interpreter(command_lists):
    """`curl ... | sh` in any spelling, including `| sudo bash` and `| python3`.

    Pipe structure survives tokenization, so this reads the actual shape rather
    than looking for the literal string "| sh".
    """
    binaries = []
    for toks in command_lists:
        binary, _args, _notes = normalize(toks)
        binaries.append(binary)
    for idx, binary in enumerate(binaries[:-1]):
        if binary in FETCHERS and binaries[idx + 1] in INTERPRETERS:
            return True
    return False


def classify(binary, args, cfg):
    """Return ('safe'|'spawn'|'unknown', reason)."""
    if binary is None:
        return 'safe', ''
    if binary in cfg['spawn_extra'] or binary in ALWAYS_SPAWN:
        return 'spawn', f"`{binary}` exists to run other code"
    if binary in CONDITIONAL_SPAWN:
        try:
            if CONDITIONAL_SPAWN[binary](args):
                return 'spawn', f"`{binary}` invoked in a shape that can run other code"
        except Exception:  # noqa: BLE001 - a predicate bug must not allow
            return 'spawn', f"`{binary}` shape could not be evaluated"
        return 'safe', ''
    if binary in cfg['safe_extra'] or binary in SAFE_READONLY:
        return 'safe', ''
    return 'unknown', f"`{binary}` is not a binary this guard recognizes"


# ─────────────────────────────────────────────────────────────────────────────
# Decision
# ─────────────────────────────────────────────────────────────────────────────

def resolve_config(settings):
    block = settings.get("bashGuard") if isinstance(settings.get("bashGuard"), dict) else {}
    policy = block.get("unknownBinaryPolicy")
    return {
        'enabled': block.get("enabled", True) is not False,
        'unknown_policy': policy if policy in ('ask', 'silent') else 'ask',
        'safe_extra': set(x for x in block.get("safeExtra", []) if isinstance(x, str)),
        'spawn_extra': set(x for x in block.get("spawnExtra", []) if isinstance(x, str)),
    }


def decide(command, settings):
    """Return (decision, reason) where decision is "deny", "ask", or None."""
    if not command or not command.strip():
        return None, None

    cfg = resolve_config(settings)
    deny_patterns = parse_bash_patterns(
        settings.get("permissions", {}).get("deny", [])
    )
    override = os.environ.get("LARARIUM_GUARD", "").strip().lower() == "off"

    # ── Tokenize. Failure is a deny, not a skip. ──
    try:
        tokens = strip_comments(tokenize(command))
        command_lists = split_commands(strip_heredoc_bodies(tokens))
        for inner in extract_backticks(command):
            command_lists.extend(
                split_commands(strip_heredoc_bodies(strip_comments(tokenize(inner))))
            )
    except Unparseable as exc:
        if override:
            return None, None
        return "deny", (
            f"Command could not be parsed ({exc}), so it could not be checked. "
            "Rewrite it, or split it into separate calls. "
            "This guard fails closed on purpose."
        )

    # ── Deny patterns, against BOTH raw and normalized forms. ──
    # Normalizing is what makes `/bin/rm -rf /` match a `Bash(rm:*)` deny.
    flat = re.sub(r'\s+', ' ', command).strip()
    if deny_patterns and command_matches_pattern(flat, deny_patterns):
        return "deny", "Command matches a deny pattern in your settings"

    for toks in command_lists:
        binary, args, _notes = normalize(toks)
        if binary is None:
            continue
        candidates = [' '.join([binary] + args), binary]
        raw = ' '.join(toks)
        if raw not in candidates:
            candidates.append(raw)
        for cand in candidates:
            if deny_patterns and command_matches_pattern(cand, deny_patterns):
                return "deny", (
                    f"Sub-command `{' '.join([binary] + args)}` matches a deny "
                    "pattern in your settings"
                )

    if override:
        return None, None

    # ── Structural denies. Kept tight on purpose. ──
    if piped_download_into_interpreter(command_lists):
        return "deny", (
            "A download is piped straight into an interpreter, which runs "
            "unreviewed remote code. Save it to a file, read it, then run it."
        )

    # ── Structural asks. ──
    unknowns = []
    for toks in command_lists:
        binary, args, notes = normalize(toks)
        kind, reason = classify(binary, args, cfg)
        if kind == 'spawn':
            extra = f" (via {', '.join(notes)})" if notes else ""
            return "ask", (
                f"{reason}{extra}. The guard cannot see what it will run, so "
                "this is a human decision."
            )
        if kind == 'unknown':
            unknowns.append(binary)
        elif notes:
            return "ask", (
                f"Runs under {', '.join(notes)}, which changes what the command "
                "can reach. Confirm it is intended."
            )

    if unknowns and cfg['unknown_policy'] == 'ask':
        listed = ', '.join(f"`{u}`" for u in dict.fromkeys(unknowns))
        return "ask", (
            f"{listed} is not on this guard's known-safe list, so its effects "
            "were not assessed. Approve if you know what it does, or add it to "
            "bashGuard.safeExtra in settings.json."
        )

    return None, None


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def emit(decision, reason):
    json.dump({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }, sys.stdout)
    sys.stdout.write("\n")


def main():
    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError, ValueError):
        # No payload at all is a harness problem, not a command to judge.
        # Denying here would wedge every session on a malformed stdin.
        sys.exit(0)

    if input_data.get("tool_name") != "Bash":
        sys.exit(0)

    command = input_data.get("tool_input", {}).get("command", "")
    if not command:
        sys.exit(0)

    settings = load_merged_settings(os.environ.get("CLAUDE_SETTINGS_PATH"))
    if not resolve_config(settings)['enabled']:
        sys.exit(0)

    try:
        decision, reason = decide(command, settings)
    except Exception as exc:  # noqa: BLE001
        # An unexpected bug in the guard itself. Fail closed, but say so
        # clearly enough that the user can disable it and keep working.
        emit("deny", (
            f"The bash guard errored while checking this command ({exc}). "
            "It fails closed. Re-run with LARARIUM_GUARD=off to bypass the "
            "structural checks, and please file this command as a bug."
        ))
        sys.exit(0)

    if decision:
        emit(decision, reason)
    sys.exit(0)


if __name__ == "__main__":
    main()
