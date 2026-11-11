#!/usr/bin/env python3
"""Bash deny guard, DENY-ONLY variant of smart-approve for Claude Code.

Decomposes compound bash commands (&&, ||, ;, |, $(), backticks, heredocs)
into individual sub-commands and checks each against the DENY patterns in
the merged settings.json layers. Emits a deny when any sub-command (or the
full command) matches. With deny patterns configured, it also denies commands
with unterminated syntax, never-closed heredocs, NUL bytes or carriage returns.
Otherwise it stays silent and normal permission flow applies.
Because hook denies fire even under bypassPermissions, this makes
the settings deny-list hold for agent sessions too.

Source: https://github.com/liberzon/claude-hooks (smart-approve.py)
Author: Yair Liberzon. License: MIT.
Local modifications (this template, 2026-07-10):
  * allow path removed entirely, this hook never auto-approves. The
    upstream allow path silently widened automation (compound commands
    native CC would prompt on) and strip_redirections made redirect
    targets invisible to the check. Deny-only sidesteps both.
  * full-command deny check added: pipe-shaped deny patterns like
    "Bash(curl * | sh)" never match decomposed segments, so the raw
    command string is also checked against deny patterns.

Input:  JSON on stdin with tool_name and tool_input.command
Output: hookSpecificOutput permissionDecision "deny", or silent exit
"""

import fnmatch
import json
import os
import re
import signal
import sys
import threading
import time


def load_settings(path=None):
    """Load and return the permissions dict from settings.json."""
    if path is None:
        path = os.path.expanduser("~/.claude/settings.json")
    path = os.path.expanduser(path)
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def load_merged_settings(global_path=None):
    """Load and merge all settings layers matching Claude Code's behavior.

    Loads up to three sources and merges their permissions.allow/deny arrays:
      1. Global:        ~/.claude/settings.json (or $CLAUDE_SETTINGS_PATH)
      2. Project:       $CLAUDE_PROJECT_DIR/.claude/settings.json (committed)
      3. Project-local: $CLAUDE_PROJECT_DIR/.claude/settings.local.json (gitignored)
    """
    settings = load_settings(global_path)

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR")
    if not project_dir:
        return settings

    # Load both project settings files
    project_shared = load_settings(
        os.path.join(project_dir, ".claude", "settings.json")
    )
    project_local = load_settings(
        os.path.join(project_dir, ".claude", "settings.local.json")
    )

    if not project_shared and not project_local:
        return settings

    # Merge permissions arrays from all layers (deduplicated, order-preserving)
    global_perms = settings.get("permissions", {})
    shared_perms = project_shared.get("permissions", {})
    local_perms = project_local.get("permissions", {})

    merged_allow = list(dict.fromkeys(
        global_perms.get("allow", [])
        + shared_perms.get("allow", [])
        + local_perms.get("allow", [])
    ))
    merged_deny = list(dict.fromkeys(
        global_perms.get("deny", [])
        + shared_perms.get("deny", [])
        + local_perms.get("deny", [])
    ))

    settings.setdefault("permissions", {})
    settings["permissions"]["allow"] = merged_allow
    settings["permissions"]["deny"] = merged_deny

    return settings


def parse_bash_patterns(patterns):
    """Extract command prefixes from Bash(...) permission patterns.

    "Bash(git status:*)" -> "git status"
    "Bash(rm:*)"         -> "rm"
    Non-Bash patterns are skipped.

    Returns a list of (prefix_string, glob_pattern) tuples.
    The glob_pattern is what fnmatch should match against.
    """
    result = []
    for pat in patterns:
        m = re.match(r'^Bash\((.+)\)$', pat)
        if not m:
            continue
        inner = m.group(1)
        # inner is like "git status:*" or "rm:*" or "/home/you/...adb*"
        # Split on first ':'
        colon_idx = inner.find(':')
        if colon_idx == -1:
            # Pattern like "Bash(something)" with no colon: treat as exact prefix
            result.append((inner, inner))
        else:
            prefix = inner[:colon_idx]
            suffix = inner[colon_idx + 1:]
            # The glob pattern is prefix + ' ' + suffix (for matching with args)
            # But we also want bare prefix to match (no args)
            glob_pat = prefix + ' ' + suffix if suffix else prefix
            result.append((prefix, glob_pat))
    return result


def command_matches_pattern(cmd, patterns):
    """Check if a command matches any of the parsed Bash patterns.

    Each pattern is (prefix, glob_pattern).
    A command matches if:
      - It equals the prefix exactly (bare command, no args), OR
      - fnmatch(cmd, glob_pattern) is True
    """
    for prefix, glob_pat in patterns:
        if cmd == prefix:
            return True
        if fnmatch.fnmatch(cmd, glob_pat):
            return True
    return False


MAX_DEPTH = 8
ASSIGNMENT = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*\+?=')
SUBSCRIPT = re.compile(r'[A-Za-z_][A-Za-z0-9_]*\[')
NUMBER = re.compile(r'^[0-9]+(?:\.[0-9]+)?[smhd]?$')
SHELLS = {'sh', 'bash', 'zsh', 'dash', 'ksh'}
PREFIXES = {'!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'coproc'}
HEADERS = {'for', 'case', 'select', 'done', 'fi', 'esac', 'in'}
REDIRECTION = re.compile(r'(?:[0-9]+|\{[A-Za-z_][A-Za-z0-9_]*\})?(<<<|<<-|<<|&>>|&>|>>|<>|>&|<&|>\||>|<)')


def after_prefixes(words):
    # Bash timing and control prefixes can precede each other and compound commands.
    i = 0
    while i < len(words) and not words[i].quoted:
        if words[i].value in PREFIXES:
            i += 1
        elif words[i].value == 'time':
            j = i + 1
            while j < len(words) and words[j].value in ('-p', '--'):
                j += 1
            if j < len(words) and words[j].value.startswith('-'):
                break
            i = j
        else:
            break
    return words[i:]


class ParseProblem(ValueError):
    """Syntax the scanner cannot finish, distinct from an internal guard error."""


class Word:
    def __init__(self, raw, value, quoted=False):
        self.raw = raw
        self.value = value
        self.quoted = quoted


class Scanner:
    """One forward cursor; heredoc queues belong to their code context."""

    def __init__(self, text, depth=0, boundary_only=False):
        if depth > MAX_DEPTH:
            raise ValueError('command nesting exceeds 8 levels')
        self.text = text
        self.i = 0
        self.depth = depth
        self.segments = []
        self.parenthesis_ends = {}
        self.substitution_ends = {}
        self.boundary_only = boundary_only

    def substitution_end(self, opening, double_quoted=False):
        if opening not in self.substitution_ends:
            scanner = Scanner(self.text, self.depth, boundary_only=True)
            scanner.i = opening
            scanner.parenthesis_ends = self.parenthesis_ends
            scanner.substitution_ends = self.substitution_ends
            marker = '`' if self.text[opening] == '`' else '$('
            scanner.substitution(marker, self.depth, double_quoted)
        return self.substitution_ends[opening]

    def continuation(self, position, control=False):
        s = self.text
        if not s.startswith('\\\n', position):
            return
        before = s[position - 1:position] if position else ''
        after = s[position + 2:position + 3]
        operators = '<>[]{}()$;&|'
        if after and after in operators:
            raise ParseProblem('backslash-newline touching an operator')
        if before and before in operators and not control:
            raise ParseProblem('backslash-newline touching an operator')

    def parenthesis_end(self, opening):
        # Locate the inner close without interpreting words as commands. Remember
        # nested closes so arithmetic expansions do not repeat this lookahead.
        if opening in self.parenthesis_ends:
            return self.parenthesis_ends[opening]
        s = self.text
        stack = [[opening, ')', None]]
        i = opening + 1
        while i < len(s):
            frame = stack[-1]
            quote = frame[2]
            ch = s[i]
            if quote in ("'", 'ansi'):
                if ch == ('\'' if quote == 'ansi' else quote):
                    frame[2] = None
                elif ch == '\\' and quote != "'":
                    i += 1
                i += 1
                continue
            if ch == '\\' and i + 1 < len(s):
                self.continuation(i)
                i += 2 if quote is None or s[i + 1] in '$`"\\\n' else 1
                continue
            if s[i:i + 2] in ('<(', '>('):
                raise ParseProblem('process substitution in arithmetic')
            if ch == '"':
                frame[2] = None if quote else '"'
            elif quote is None and s.startswith("$'", i):
                frame[2] = 'ansi'
                i += 1
            elif ch == '`' or (s.startswith('$(', i) and not s.startswith('$((', i)):
                # Shell substitutions own case patterns, comments and heredocs.
                # Locate them without contributing command candidates.
                i = self.substitution_end(i, double_quoted=quote == '"')
                continue
            elif quote is None and ch == "'":
                frame[2] = ch
            elif s[i:i + 2] in ('$(', '${', '$['):
                # An expansion owns its quotes and delimiters, even inside quotes.
                stack.append([i + 1, {'(': ')', '{': '}', '[': ']'}[s[i + 1]], None])
                i += 1
            elif quote is None:
                if ch == frame[1]:
                    if ch == '}' and any(c in s[frame[0] - 1:i + 1] for c in '()'):
                        raise ParseProblem('parenthesis in arithmetic parameter expansion')
                    if ch == ')':
                        self.parenthesis_ends[frame[0]] = i
                    stack.pop()
                    if not stack:
                        return i
                elif (ch == '(' and frame[1] == ')') or (ch == '[' and frame[1] == ']'):
                    stack.append([i, ')' if ch == '(' else ']', None])
            i += 1
        for position, close, quote in stack:
            if close == ')':
                self.parenthesis_ends[position] = None
        return None

    def arithmetic(self, depth, marker='$(('):
        start = self.i
        close = self.parenthesis_end(start + len(marker) - 1)
        if close is not None and not self.text.startswith(')', close + 1):
            # Only an adjacent second close selects arithmetic. Otherwise the
            # outer parenthesis owns shell code beginning with the inner one.
            self.i = start + len(marker) - 1
            if not self.code(')', depth + (marker == '$((')):
                raise ParseProblem('unterminated {} group'.format(marker))
            return
        self.data_unit(marker, ')', depth)

    def data_unit(self, marker, close, depth, scan_quoted=False):
        # Expansions, arithmetic commands and array words own their matching close.
        # Their operators are data; word() still discovers executable substitutions.
        self.i += len(marker)
        # Bare braces are parameter data; word() recurses into actual expansions.
        opening = None if marker == '${' else marker[-1]
        level = 2 if marker in ('((', '$((') else 1
        while self.i < len(self.text) and level:
            ch = self.text[self.i]
            if ch == close:
                level -= 1
                self.i += 1
            elif ch == opening:
                level += 1
                self.i += 1
            else:
                begin = self.i
                self.word(depth, stop=close, unit_open=opening,
                          scan_quoted=scan_quoted or marker != '(', array_item=marker == '(',
                          arithmetic=marker in ('((', '$((', '$['))
                if self.i == begin:
                    self.i += 1
        if level:
            kind = {'${': 'parameter expansion', '$((': 'arithmetic expansion',
                    '((': 'arithmetic command', '$[': 'legacy arithmetic expansion',
                    '(': 'array initializer'}[marker]
            raise ParseProblem('unterminated {} ({})'.format(kind, marker))
        return True

    def substitution(self, marker, depth, double_quoted=False):
        # Substitutions re-enter code even inside double quotes, at a bounded depth.
        if depth >= MAX_DEPTH:
            raise ValueError('command nesting exceeds 8 levels')
        start = self.i
        if self.boundary_only and start in self.substitution_ends:
            self.i = self.substitution_ends[start]
            return
        self.i += len(marker)
        if marker == '`':
            body = []
            while self.i < len(self.text):
                ch = self.text[self.i]
                self.i += 1
                if ch == '`':
                    nested = Scanner(''.join(body), depth + 1, self.boundary_only)
                    nested.code()
                    self.segments.extend(nested.segments)
                    self.substitution_ends[start] = self.i
                    return
                if ch == '\\' and self.i < len(self.text):
                    nxt = self.text[self.i]
                    self.i += 1
                    if nxt not in '$`\\' and not (double_quoted and nxt == '"'):
                        body.append(ch)
                    body.append(nxt)
                else:
                    body.append(ch)
            raise ParseProblem('unterminated ` substitution')
        if not self.code(')', depth + 1):
            raise ParseProblem('unterminated {} substitution'.format(marker))
        self.substitution_ends[start] = self.i

    def word(self, depth, delimiter=False, stop=None, unit_open=None,
             scan_quoted=False, array_item=False, regex=False, pattern=False, arithmetic=False):
        start = self.i
        value = []
        quoted = False
        quote = None
        ansi_ended = False
        s = self.text
        scan_quoted = not delimiter and (scan_quoted or (
            array_item and s.startswith('[', start)) or bool(
            SUBSCRIPT.match(s, start)))
        quote_start = None
        pattern_level = 0
        while self.i < len(s):
            ch = s[self.i]
            if delimiter and s[self.i:self.i + 2] in ('?(', '*(', '+(', '@(', '!('):
                raise ParseProblem('heredoc delimiter containing an extended glob operator')
            if delimiter and (s[self.i:self.i + 2] in ('${', '$[', '$(', '<(', '>(') or ch == '`'):
                raise ParseProblem('heredoc delimiter containing a substitution marker')
            if quote is None and ch == stop:
                break
            # Keep quote boundaries, but inspect their raw contents in expansion data.
            if quote in ("'", 'ansi'):
                if ch == "'":
                    if scan_quoted:
                        self.expansions(s[quote_start:self.i], depth)
                    quote = None
                    self.i += 1
                elif ch == '\\' and quote == 'ansi':
                    m = re.match(r'\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|c.|.)', s[self.i:self.i + 10], re.S)
                    if m:
                        esc = m.group(1)
                        simple = {'a': '\a', 'b': '\b', 'e': '\x1b', 'E': '\x1b',
                                  'f': '\f', 'n': '\n', 'r': '\r', 't': '\t', 'v': '\v',
                                  '\\': '\\', "'": "'", '"': '"', '?': '?'}
                        if esc[0] in '01234567':
                            decoded = chr(int(esc, 8) % 256)
                        elif esc[0] in 'xuU' and len(esc) > 1:
                            decoded = chr(int(esc[1:], 16))
                        elif esc[0] == 'c' and len(esc) == 2:
                            decoded = chr(ord(esc[1].upper()) % 32)
                        else:
                            decoded = simple.get(esc, '\\' + esc)
                        if decoded == '\0':
                            ansi_ended = True
                        if not ansi_ended:
                            value.append(decoded)
                        self.i += len(m.group(0))
                    else:
                        if not ansi_ended:
                            value.append(ch)
                        self.i += 1
                else:
                    if quote != 'ansi' or not ansi_ended:
                        value.append(ch)
                    self.i += 1
                continue
            # Backslash-newline vanishes; double quotes only escape $, `, ", and backslash.
            if ch == '\\' and self.i + 1 < len(s):
                nxt = s[self.i + 1]
                if nxt == '\n':
                    self.continuation(self.i)
                    self.i += 2
                elif quote != '"' or nxt in '$`"\\':
                    quoted = True
                    value.append(nxt)
                    self.i += 2
                else:
                    value.append(ch)
                    self.i += 1
                continue
            if quote is None and s.startswith('$"', self.i):
                self.i += 1
                ch = '"'
            if ch == '"':
                quoted = True
                quote = None if quote == '"' else '"'
                self.i += 1
                continue
            if quote is None and (ch == "'" or s.startswith("$'", self.i)):
                quoted = True
                quote = 'ansi' if ch == '$' else "'"
                ansi_ended = False
                self.i += 2 if ch == '$' else 1
                quote_start = self.i
                continue
            if not delimiter:
                if arithmetic and s[self.i:self.i + 2] in ('<(', '>('):
                    raise ParseProblem('process substitution in arithmetic')
                if (quote is None and not arithmetic and not regex and
                        ch in '?*+@!' and s.startswith('(', self.i + 1)):
                    # A preceding dollar does not hide an unquoted glob opener.
                    raise ParseProblem('extended glob operator')
                begin = self.i
                if s.startswith('$((', self.i):
                    self.arithmetic(depth)
                elif s.startswith('${', self.i):
                    self.data_unit('${', '}', depth)
                    if arithmetic and any(c in s[begin:self.i] for c in '()'):
                        raise ParseProblem('parenthesis in arithmetic parameter expansion')
                elif s.startswith('$[', self.i):
                    self.data_unit('$[', ']', depth)
                elif s.startswith('$(', self.i) or (quote is None and s[self.i:self.i + 2] in ('<(', '>(')):
                    self.substitution(s[self.i:self.i + 2], depth)
                elif ch == '`':
                    self.substitution('`', depth, double_quoted=quote == '"')
                elif s.startswith('$$', self.i) and s[self.i + 2:self.i + 3] not in ('(', '{', '['):
                    # Keep the PID pair from becoming an overlapping ANSI-C quote.
                    # Still inspect overlapping substitution markers conservatively.
                    self.i += 2
                elif ((arithmetic or regex) and quote is None and ch == '$' and
                      s[self.i + 1:self.i + 2] in ('?', '*', '@', '!') and
                      self.i >= start + 2 and s[self.i - 2:self.i] == '$$' and
                      s.startswith('(', self.i + 2)):
                    # Preserve prior conservative PID denials in arithmetic and regex data.
                    raise ParseProblem('extended glob operator after PID expansion')
                elif quote is None and ch == '(' and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*\+?=', s[start:self.i]):
                    self.data_unit('(', ')', depth, scan_quoted=scan_quoted)
                if self.i != begin:
                    value.append(s[begin:self.i])
                    continue
            # Regex groups and extended patterns keep shell metacharacters in one word.
            if quote is None and (regex or pattern):
                if ch == '(' and (regex or pattern_level or (
                        self.i > start and s[self.i - 1] in '?*+@!')):
                    pattern_level += 1
                elif ch == ')' and pattern_level:
                    pattern_level -= 1
                elif not pattern_level and not (regex and ch == '|'):
                    if ch in ' \t\n;&|()<>':
                        break
                value.append(ch)
                self.i += 1
                continue
            if quote is None and ch == unit_open:
                break
            if quote is None and (ch in ' \t\n;&|()<>' or ch == '`'):
                break
            value.append(ch)
            self.i += 1
        if quote:
            kind = {"'": 'single quote', '"': 'double quote', 'ansi': "ANSI-C quote ($'...)"}[quote]
            raise ParseProblem('unterminated ' + kind)
        if pattern_level:
            raise ParseProblem('unterminated {} group'.format('regex' if regex else 'pattern'))
        return Word(s[start:self.i], ''.join(value), quoted)

    def bodies(self, pending, depth, substitution=False):
        # Bash reads queued heredocs after newline, in order, with exact delimiter lines.
        s = self.text
        for doc in pending:
            chunks = []
            while self.i < len(s):
                end = s.find('\n', self.i)
                if end < 0:
                    end = len(s)
                line = s[self.i:end]
                self.i = min(end + 1, len(s))
                while (not doc['quoted'] and end < len(s) and
                       (len(line) - len(line.rstrip('\\'))) % 2):
                    next_end = s.find('\n', self.i)
                    if next_end < 0:
                        next_end = len(s)
                    line = line[:-1] + s[self.i:next_end]
                    end = next_end
                    self.i = min(end + 1, len(s))
                tested = line.lstrip('\t') if doc['tabs'] else line
                if substitution and tested.startswith(doc['delimiter'] + ')'):
                    raise ParseProblem('heredoc {!r} terminator shares substitution closing line'.format(doc['delimiter']))
                if tested == doc['delimiter']:
                    break
                chunks.append(tested + ('\n' if end < len(s) else ''))
            else:
                raise ParseProblem('heredoc {!r} has no terminator'.format(doc['delimiter']))
            doc['body'] = ''.join(chunks)
            # Unquoted heredocs expand substitutions; ordinary quotes there are just data.
            if not doc['quoted']:
                self.expansions(doc['body'], depth)

    def expansions(self, body, depth):
        scanner = Scanner(body, depth, self.boundary_only)
        while scanner.i < len(body):
            ch = body[scanner.i]
            if ch == '\\' and scanner.i + 1 < len(body) and body[scanner.i + 1] in '\\$`\n':
                scanner.i += 2
            elif body.startswith('$((', scanner.i):
                scanner.arithmetic(depth)
            elif body.startswith('${', scanner.i):
                scanner.data_unit('${', '}', depth)
            elif body.startswith('$[', scanner.i):
                scanner.data_unit('$[', ']', depth)
            elif body.startswith('$(', scanner.i):
                scanner.substitution('$(', depth)
            elif ch == '`':
                scanner.substitution('`', depth)
            else:
                scanner.i += 1
        self.segments.extend(scanner.segments)

    def conditional(self, depth, pending):
        # Conditional operators and pattern groups are data, substitutions are code.
        self.i += 2
        s = self.text
        state = 'term'
        while self.i < len(s):
            if s[self.i] == '\n' and pending:
                raise ParseProblem('heredoc body starts inside conditional ([[)')
            if s[self.i] in ' \t\n' or s.startswith('\\\n', self.i):
                self.continuation(self.i)
                self.i += 2 if s.startswith('\\\n', self.i) else 1
                continue
            # word() consumes embedded hashes; only a boundary hash reaches here.
            if s[self.i] == '#':
                pos = s.find('\n', self.i)
                self.i = len(s) if pos < 0 else pos
                continue
            if s.startswith(']]', self.i) and (
                    self.i + 2 == len(s) or s[self.i + 2] in ' \t\n;&|()<>'):
                self.i += 2
                return
            if state != 'regex' and s[self.i:self.i + 2] in ('&&', '||'):
                state = 'term'
                self.i += 2
                continue
            if state == 'term' and s[self.i] == '(':
                self.i += 1
                continue
            if s[self.i] == ')':
                state = 'end'
                self.i += 1
                continue
            begin = self.i
            word = self.word(depth, regex=state == 'regex', pattern=state == 'right')
            if self.i == begin:
                self.i += 1
            if state == 'term':
                if not word.quoted and word.value == '!':
                    continue
                unary = not word.quoted and re.fullmatch(r'-[abcdefghkLnoprstuvwxGNORSz]', word.value)
                state = 'unary' if unary else 'operator'
            elif state == 'operator':
                state = 'regex' if not word.quoted and word.value == '=~' else 'right'
            else:
                state = 'end'
        raise ParseProblem('unterminated conditional ([[)')

    def code(self, end=None, depth=None):
        depth = self.depth if depth is None else depth
        s = self.text
        words, raw, docs, pending = [], [], [], []
        groups = 0
        cases = []

        def flush():
            if not self.boundary_only and (raw or words) and not (cases and cases[-1][0] != 'body'):
                self.segments.append((words[:], ' '.join(raw), docs[:], depth))
            words.clear()
            raw.clear()
            docs.clear()

        while self.i < len(s):
            ch = s[self.i]
            # An unquoted backtick or closing substitution parenthesis returns to its word.
            if end and ch == end and not groups and not (
                    end == ')' and cases and cases[-1][0] == 'pattern'):
                if pending:
                    raise ParseProblem('heredoc {!r} has no body before substitution closes'.format(pending[0]['delimiter']))
                flush()
                self.i += 1
                return True
            if s.startswith('\\\n', self.i):
                self.continuation(self.i)
                self.i += 2
                continue
            if ch in ' \t':
                self.i += 1
                continue
            # Comments start only at a word boundary; their quotes cannot alter scanner state.
            if ch == '#':
                pos = s.find('\n', self.i)
                self.i = len(s) if pos < 0 else pos
                continue
            # Case patterns are headers up to ')'; alternatives are not pipelines.
            if cases and cases[-1][0] == 'pattern' and ch in '()|':
                if ch == ')':
                    cases[-1][0] = 'body'
                    words.clear()
                    raw.clear()
                self.i += 1
                continue
            if s.startswith('[[', self.i) and (
                    self.i + 2 == len(s) or s[self.i + 2] in ' \t\n') and (
                    not cases or cases[-1][0] == 'body') and len(raw) == len(words) and not after_prefixes(words):
                begin = self.i
                self.conditional(depth, pending)
                text = s[begin:self.i]
                words.append(Word(text, '[['))
                raw.append(text)
                continue
            if s.startswith('((', self.i):
                begin = self.i
                header = after_prefixes(words)
                if len(header) == 1 and not header[0].quoted and header[0].value == 'for':
                    self.data_unit('((', ')', depth)
                else:
                    self.arithmetic(depth, '((')
                text = s[begin:self.i]
                words.append(Word(text, text))
                raw.append(text)
                continue
            # Control operators separate commands; grouping exposes commands on either side.
            if ch in ';|&\n()' and s[self.i:self.i + 2] not in ('&>',):
                begin = self.i
                if ch == '(':
                    groups += 1
                elif ch == ')' and groups:
                    groups -= 1
                flush()
                self.i += 1
                if ch != '\n' and self.i < len(s) and s[self.i] in '|&;' and ch in '|&;':
                    if ch == ';' and cases and s[self.i] in ';&':
                        cases[-1] = ['pattern', True]
                    self.i += 1
                    if ch == ';' and self.i < len(s) and s[self.i] == '&':
                        self.i += 1
                if ch == '\n':
                    self.bodies(pending, depth, substitution=end == ')')
                    pending.clear()
                elif s.startswith('\\\n', self.i):
                    self.continuation(self.i, control=s[begin:self.i] in ('|', '||', '&&', ';', '&', '|&'))
                    self.i += 2
                continue
            if ch in '{}' and (
                    self.i + 1 == len(s) or s[self.i + 1] in ' \t\n;)'):
                header = after_prefixes(words)
                named_group = (ch == '{' and not any(w.quoted for w in header) and (
                    (len(header) == 2 and header[0].value == 'function') or
                    (len(header) == 1 and any(w.value == 'coproc' and not w.quoted for w in words))))
                if not header or named_group:
                    if named_group:
                        words.clear()
                        raw.clear()
                    flush()
                    self.i += 1
                    continue
            # Redirection operands are data; process substitutions remain executable words.
            m = REDIRECTION.match(s, self.i)
            if m and not (s[self.i:self.i + 2] in ('<(', '>(')):
                op = m.group(1)
                raw.append(m.group(0))
                self.i += len(m.group(0))
                while self.i < len(s):
                    if s[self.i] in ' \t':
                        self.i += 1
                    elif s.startswith('\\\n', self.i):
                        self.continuation(self.i)
                        self.i += 2
                    else:
                        break
                # A comment cannot supply a redirection operand or a heredoc delimiter.
                if self.i < len(s) and s[self.i] == '#':
                    continue
                operand = self.word(depth, delimiter=op in ('<<', '<<-'), stop=end)
                raw.append(operand.raw)
                if operand.raw and op in ('<<', '<<-', '<<<'):
                    doc = {'delimiter': operand.value, 'quoted': operand.quoted,
                           'tabs': op == '<<-', 'body': operand.value if op == '<<<' else ''}
                    docs.append(doc)
                    if op != '<<<':
                        pending.append(doc)
                continue
            word = self.word(depth, stop=end)
            if self.i == len(s) or word.raw:
                phase = cases[-1][0] if cases else None
                command_position = len(raw) == len(words) and not after_prefixes(words)
                if phase == 'subject':
                    cases[-1][0] = 'in'
                elif phase == 'in':
                    if not word.quoted and word.value == 'in':
                        cases[-1][0] = 'pattern'
                        words.clear()
                        raw.clear()
                        continue
                elif not word.quoted:
                    if word.value == 'case' and command_position and phase != 'pattern':
                        cases.append(['subject', False])
                    elif word.value == 'esac' and cases:
                        # In a body only a command-position esac closes the case.
                        # The first pattern may itself be spelled esac, even unquoted.
                        pattern_close = False
                        if phase == 'pattern' and command_position:
                            look = self.i
                            while look < len(s):
                                if s[look] in ' \t\n':
                                    look += 1
                                elif s.startswith('\\\n', look):
                                    self.continuation(look)
                                    look += 2
                                else:
                                    break
                            following = s[look:look + 1]
                            pattern_close = (following not in (')', '|') or (
                                end == ')' and cases[-1][1] and following == ')'))
                        if (phase == 'body' and command_position) or pattern_close:
                            cases.pop()
                raw.append(word.raw)
                words.append(word)
            else:
                # A stray unmatched closer is syntax, never a reason to stop scanning.
                self.i += 1
        flush()
        if pending:
            raise ParseProblem('heredoc {!r} has no body before end of input'.format(pending[0]['delimiter']))
        return False


# Each wrapper lists value options and flags; unknown options branch into both readings.
WRAPPERS = {
    'command': (set(), {'-p'}),
    'builtin': (set(), set()),
    'exec': ({'-a'}, {'-c', '-l'}),
    'env': ({'-u', '--unset', '-C', '--chdir', '-S', '--split-string'},
            {'-i', '--ignore-environment', '-', '-0', '--null', '-v', '--debug'}),
    'sudo': ({'-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt',
              '-C', '--close-from', '-T', '--command-timeout', '-r', '--role',
              '-t', '--type', '-D', '--chdir', '-R', '--chroot'},
             {'-E', '--preserve-env', '-H', '-n', '-S', '-b', '-k', '-K', '-v'}),
    'doas': ({'-u', '-C'}, {'-n', '-s', '-L'}),
    'nohup': (set(), set()),
    'time': ({'-f', '--format', '-o', '--output'}, {'-p', '-a', '--append', '-v'}),
    'timeout': ({'-s', '--signal', '-k', '--kill-after'},
                {'--foreground', '--preserve-status', '-v', '--verbose'}),
    'nice': ({'-n', '--adjustment'}, set()),
    'ionice': ({'-c', '--class', '-n', '--classdata', '-p', '-P', '-u'}, {'-t', '--ignore'}),
    'stdbuf': ({'-i', '--input', '-o', '--output', '-e', '--error'}, set()),
    'setsid': (set(), {'-c', '--ctty', '-f', '--fork', '-w', '--wait'}),
    'busybox': (set(), set()),
    'xargs': ({'-a', '--arg-file', '-E', '-I', '--replace', '-L', '--max-lines',
               '-n', '--max-args', '-P', '--max-procs', '-s', '--max-chars', '-d', '--delimiter'},
              {'-0', '--null', '-r', '--no-run-if-empty', '-t', '--verbose', '-p', '--interactive', '-x', '--exit'}),
}


def extglob_option(value):
    # Computed option names cannot establish that extended globbing stays off.
    return value == 'extglob' or any(c in value for c in '$`*?[{}')


def check_bashopts(value):
    assignment = re.match(r'^BASHOPTS\+?=(.*)$', value, re.S)
    if assignment and ('extglob' in assignment[1] or extglob_option(assignment[1])):
        raise ParseProblem('extglob turned on')


def command_starts(words, payload):
    """Yield real command positions without walking their ordinary arguments."""
    todo = [0]
    visited = set()
    while todo:
        i = todo.pop()
        while i < len(words) and ASSIGNMENT.match(words[i].value):
            check_bashopts(words[i].value)
            i += 1
        if i >= len(words) or i in visited:
            continue
        visited.add(i)
        yield i
        base = os.path.basename(words[i].value)
        if base not in WRAPPERS:
            continue
        takes, flags = WRAPPERS[base]
        options = [i + 1]
        seen = set()
        while options:
            j = options.pop()
            while j < len(words):
                if j in seen:
                    break
                seen.add(j)
                arg = words[j].value
                if base == 'command' and arg.startswith('-') and not arg.startswith('--') and any(c in arg[1:] for c in 'vV'):
                    break
                if base == 'env' and (arg in ('-S', '--split-string') or arg.startswith('--split-string=') or arg.startswith('-S')):
                    if arg in ('-S', '--split-string'):
                        j += 1
                        text = words[j].value if j < len(words) else ''
                    else:
                        text = arg.split('=', 1)[1] if '=' in arg else arg[2:]
                    payload(text + ' ' + ' '.join(w.raw for w in words[j + 1:]), 'env ')
                    break
                if arg == '--':
                    todo.append(j + (2 if base == 'timeout' else 1))
                    break
                if base == 'timeout' and (not arg.startswith('-') or arg == '-'):
                    todo.append(j + 1)
                    break
                if ASSIGNMENT.match(arg) or NUMBER.fullmatch(arg):
                    check_bashopts(arg)
                    j += 1
                    continue
                if not arg.startswith('-') or arg == '-':
                    if arg in flags:
                        j += 1
                        continue
                    todo.append(j)
                    break
                opt = arg.split('=', 1)[0]
                if opt in takes:
                    j += 1 if '=' in arg else 2
                elif opt in flags:
                    j += 1
                elif not arg.startswith('--') and any(arg.startswith(o) and len(arg) > len(o) for o in takes if o.startswith('-') and not o.startswith('--')):
                    j += 1
                elif not arg.startswith('--') and all('-' + c in flags for c in arg[1:]):
                    j += 1
                else:
                    # Unknown option: the next word may be its value or its command.
                    options.append(j + 2)
                    j += 1


def decompose_command(command, depth=0):
    scanner = Scanner(command, depth)
    scanner.code()
    result = [re.sub(r'[ \t\n]+', ' ', command).strip(' \t\n')]

    def payload(text, nested_depth, prefix=''):
        result.append(re.sub(r'[ \t\n]+', ' ', text).strip(' \t\n'))
        result.extend(decompose_command(prefix + text, nested_depth))

    def analyze(words, raw, docs, level):
        if level > MAX_DEPTH:
            raise ValueError('command nesting exceeds 8 levels')
        # Reserved prefixes expose the following command; loop and case headers do not run it.
        words = after_prefixes(words)
        if not words or (not words[0].quoted and words[0].value in HEADERS):
            return
        result.append(raw.strip(' \t\n'))
        for i in command_starts(words, lambda text, prefix='': payload(text, level + 1, prefix)):
            word = words[i]
            base = os.path.basename(word.value)
            args = words[i + 1:]
            result.append(' '.join([word.raw] + [w.raw for w in args]))
            result.append(' '.join([base] + [w.raw for w in args]))
            if base == 'shopt':
                k = 0
                setting = False
                while k < len(args) and args[k].value.startswith('-'):
                    flag = args[k].value
                    k += 1
                    if flag == '--':
                        break
                    setting = setting or 's' in flag[1:]
                if setting and any(extglob_option(arg.value) for arg in args[k:]):
                    raise ParseProblem('extglob turned on')
            elif base in ('export', 'declare', 'typeset', 'readonly', 'local'):
                for arg in args:
                    check_bashopts(arg.value)
            # Shell -c consumes one command string; eval joins all its arguments as code.
            if base in SHELLS:
                k = 0
                command_string = False
                while k < len(args):
                    arg = args[k]
                    if arg.value == '--':
                        k += 1
                        break
                    if arg.value in ('-', '+') or not arg.value.startswith(('-', '+')):
                        break
                    if arg.value.startswith('-') and not arg.value.startswith('--') and 'O' in arg.value:
                        attached = arg.value.split('O', 1)[1]
                        following = args[k + 1].value if k + 1 < len(args) else ''
                        if extglob_option(attached) or extglob_option(following):
                            raise ParseProblem('extglob turned on')
                    if arg.value in ('-o', '-O', '+o', '+O', '--rcfile', '--init-file'):
                        k += 2
                        continue
                    if not arg.value.startswith('--') and 'c' in arg.value[1:]:
                        command_string = arg.value.startswith('-')
                    # A grouped -o/-O also consumes the following option value.
                    k += 2 if not arg.value.startswith('--') and any(
                        c in arg.value[1:] for c in 'oO') else 1
                if command_string and k < len(args):
                    payload(args[k].value, level + 1)
                for doc in docs:
                    payload(doc['body'], level + 1)
            elif base == 'eval':
                if args and args[0].value == '--':
                    args = args[1:]
                payload(' '.join(w.value for w in args), level + 1)
            elif base == 'find':
                k = 0
                while k < len(args):
                    if args[k].value in ('-exec', '-execdir', '-ok', '-okdir'):
                        start = k + 1
                        k = start
                        while k < len(args) and args[k].value not in (';', '+'):
                            k += 1
                        sub = args[start:k]
                        analyze(sub, ' '.join(w.raw for w in sub), [], level + 1)
                    k += 1

    for words, raw, docs, level in scanner.segments:
        analyze(words, raw, docs, level)
    return [cmd for cmd in result if cmd]


def parse_denial(problem):
    return 'deny', (
        'Command not analyzed: {}. This guard denies what it cannot parse '
        'while deny patterns are configured.'.format(problem)
    )


def guard_error(exc):
    return 'deny', (
        'Bash deny guard error ({}: {}). Remove the bash-deny-guard.py '
        'PreToolUse hook from your settings to unwire it.'.format(type(exc).__name__, exc)
    )


def parser_decide(command, settings):
    """Deny matches and parse problems; errors with configured denies fail closed."""
    denies = settings.get('permissions', {}).get('deny', [])
    if not denies:
        return None, None
    try:
        patterns = parse_bash_patterns(denies)
        if not patterns or not command or not command.strip(' \t\n'):
            return None, None
        if '\0' in command:
            return parse_denial('NUL byte')
        if '\r' in command:
            return parse_denial('carriage return')
        flat = re.sub(r'[ \t\n]+', ' ', command).strip(' \t\n')
        if command_matches_pattern(flat, patterns):
            return 'deny', 'Command matches deny pattern'
        for cmd in decompose_command(command):
            if command_matches_pattern(cmd, patterns):
                return 'deny', "Sub-command '{}' matches deny pattern".format(cmd)
        return None, None
    except ParseProblem as exc:
        return parse_denial(exc)
    except Exception as exc:
        return guard_error(exc)


# Keep this matcher independent of the scanner, copied from origin/main's matcher.
def legacy_parse_bash_patterns(patterns):
    """Extract command prefixes from Bash(...) permission patterns.

    "Bash(git status:*)" -> "git status"
    "Bash(rm:*)"         -> "rm"
    Non-Bash patterns are skipped.

    Returns a list of (prefix_string, glob_pattern) tuples.
    The glob_pattern is what fnmatch should match against.
    """
    result = []
    for pat in patterns:
        m = re.match(r'^Bash\((.+)\)$', pat)
        if not m:
            continue
        inner = m.group(1)
        # inner is like "git status:*" or "rm:*" or "/opt/tools/...adb*"
        # Split on first ':'
        colon_idx = inner.find(':')
        if colon_idx == -1:
            # Pattern like "Bash(something)" with no colon , treat as exact prefix
            result.append((inner, inner))
        else:
            prefix = inner[:colon_idx]
            suffix = inner[colon_idx + 1:]
            # The glob pattern is prefix + ' ' + suffix (for matching with args)
            # But we also want bare prefix to match (no args)
            glob_pat = prefix + ' ' + suffix if suffix else prefix
            result.append((prefix, glob_pat))
    return result


def legacy_command_matches_pattern(cmd, patterns):
    """Check if a command matches any of the parsed Bash patterns.

    Each pattern is (prefix, glob_pattern).
    A command matches if:
      - It equals the prefix exactly (bare command, no args), OR
      - fnmatch(cmd, glob_pattern) is True
    """
    for prefix, glob_pat in patterns:
        if cmd == prefix:
            return True
        if fnmatch.fnmatch(cmd, glob_pat):
            return True
    return False


def legacy_extract_subshells(command):
    """Extract contents of executable substitutions, recursively.

    Returns a list of substitution content strings.
    """
    subshells = []

    i = 0
    while i < len(command):
        if command[i] == '$' and i + 1 < len(command) and command[i + 1] == '(' \
                and not (i + 2 < len(command) and command[i + 2] == '('):
            depth = 0
            start = i + 2
            j = i + 1
            while j < len(command):
                if command[j] == '(':
                    depth += 1
                elif command[j] == ')':
                    depth -= 1
                    if depth == 0:
                        content = command[start:j]
                        subshells.append(content)
                        subshells.extend(legacy_extract_subshells(content))
                        break
                j += 1
            i = j + 1
            continue

        if command[i] in ('<', '>') and i + 1 < len(command) and command[i + 1] == '(':
            depth = 0
            start = i + 2
            j = i + 1
            while j < len(command):
                if command[j] == '(':
                    depth += 1
                elif command[j] == ')':
                    depth -= 1
                    if depth == 0:
                        content = command[start:j]
                        subshells.append(content)
                        subshells.extend(legacy_extract_subshells(content))
                        break
                j += 1
            i = j + 1
            continue

        i += 1

    parts = command.split('`')
    for idx in range(1, len(parts), 2):
        content = parts[idx]
        if content.strip():
            subshells.append(content)
            subshells.extend(legacy_extract_subshells(content))

    return subshells


def legacy_strip_heredocs(command):
    """Strip heredoc bodies from a command, leaving just the <<DELIM marker.

    Heredocs like <<'EOF'\\n...\\nEOF are replaced with the marker only
    (body removed).  This prevents heredoc content lines from being treated
    as sub-commands when we split on newlines.
    """
    lines = command.split('\n')
    result = []
    heredoc_delim = None
    i = 0

    while i < len(lines):
        if heredoc_delim is not None:
            # Inside heredoc body , look for the terminator line
            if lines[i].strip() == heredoc_delim:
                heredoc_delim = None
            i += 1
            continue

        # Check for heredoc marker: <<[-]?['"]?WORD['"]?
        m = re.search(r'<<-?\s*[\'"]?(\w+)[\'"]?', lines[i])
        if m:
            heredoc_delim = m.group(1)

        result.append(lines[i])
        i += 1

    return '\n'.join(result)


def legacy_split_on_operators(command):
    """Split a command string on &&, ||, ;, |, and newlines.

    Respects quoted strings and $() subshells (doesn't split inside them).
    Returns the top-level command segments.
    """
    # Strip heredoc bodies so their lines aren't treated as commands
    command = legacy_strip_heredocs(command)
    # Collapse backslash-newline continuations before parsing
    command = command.replace('\\\n', ' ')

    segments = []
    current = []
    i = 0
    in_single_quote = False
    in_double_quote = False
    paren_depth = 0

    while i < len(command):
        ch = command[i]

        # Handle backslash escaping (not inside single quotes, where \ is literal)
        if ch == '\\' and not in_single_quote and i + 1 < len(command):
            current.append(ch)
            current.append(command[i + 1])
            i += 2
            continue

        # Track quoting
        if ch == "'" and not in_double_quote and paren_depth == 0:
            in_single_quote = not in_single_quote
            current.append(ch)
            i += 1
            continue
        if ch == '"' and not in_single_quote and paren_depth == 0:
            in_double_quote = not in_double_quote
            current.append(ch)
            i += 1
            continue

        if in_single_quote or in_double_quote:
            current.append(ch)
            i += 1
            continue

        # Track $() subshell depth , consume $( as a single token
        if ch == '$' and i + 1 < len(command) and command[i + 1] == '(':
            paren_depth += 1
            current.append('$')
            current.append('(')
            i += 2
            continue
        if ch == '(' and paren_depth > 0:
            paren_depth += 1
            current.append(ch)
            i += 1
            continue
        if ch == ')' and paren_depth > 0:
            paren_depth -= 1
            current.append(ch)
            i += 1
            continue

        if paren_depth > 0:
            current.append(ch)
            i += 1
            continue

        # Split on operators at top level
        if ch == '&' and i + 1 < len(command) and command[i + 1] == '&':
            segments.append(''.join(current))
            current = []
            i += 2
            continue
        if ch == '|' and i + 1 < len(command) and command[i + 1] == '|':
            segments.append(''.join(current))
            current = []
            i += 2
            continue
        if ch == ';':
            segments.append(''.join(current))
            current = []
            i += 1
            continue
        if ch == '|':
            segments.append(''.join(current))
            current = []
            i += 1
            continue
        if ch == '\n':
            segments.append(''.join(current))
            current = []
            i += 1
            continue

        current.append(ch)
        i += 1

    segments.append(''.join(current))
    return [s.strip() for s in segments if s.strip()]


def legacy__skip_shell_value(cmd, i):
    """Skip past one shell 'word' value starting at position i.

    Handles quoted strings, $() subshells (tracking paren depth), and
    bare non-whitespace runs.  Returns the index just past the value.
    """
    if i >= len(cmd):
        return i

    # Quoted value
    if cmd[i] == '"':
        i += 1
        while i < len(cmd) and cmd[i] != '"':
            if cmd[i] == '\\' and i + 1 < len(cmd):
                i += 2
            else:
                i += 1
        if i < len(cmd):
            i += 1  # skip closing quote
        return i
    if cmd[i] == "'":
        i += 1
        while i < len(cmd) and cmd[i] != "'":
            i += 1
        if i < len(cmd):
            i += 1  # skip closing quote
        return i

    # Unquoted value , consume non-whitespace, tracking $() depth
    paren_depth = 0
    while i < len(cmd):
        ch = cmd[i]
        if ch == '$' and i + 1 < len(cmd) and cmd[i + 1] == '(':
            paren_depth += 1
            i += 2
            continue
        if ch == '(' and paren_depth > 0:
            paren_depth += 1
            i += 1
            continue
        if ch == ')' and paren_depth > 0:
            paren_depth -= 1
            i += 1
            continue
        if paren_depth > 0:
            i += 1
            continue
        if ch in (' ', '\t'):
            break
        i += 1
    return i


def legacy_strip_env_vars(cmd):
    """Strip leading environment variable assignments (FOO=bar cmd ...).

    Returns the command with env var prefixes removed.
    Correctly handles values containing $() subshells.
    """
    while True:
        m = re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', cmd)
        if not m:
            break
        # Find end of value (respecting quotes and $() depth)
        i = legacy__skip_shell_value(cmd, m.end())
        # If nothing follows the assignment, this IS the command , keep it
        rest = cmd[i:].lstrip()
        if not rest:
            break
        cmd = rest
    return cmd


def legacy_strip_redirections(cmd):
    """Strip output/input redirections from a command.

    Removes patterns like >file, >>file, 2>&1, <file, etc.
    """
    # Remove redirections: N>file, N>>file, N>&N, <file, <<word, <<<word
    cmd = re.sub(r'\d*>>?\s*&?\d*\S*', '', cmd)
    cmd = re.sub(r'<<<?\s*\S+', '', cmd)
    # Simple input redirection: < file
    cmd = re.sub(r'<\s*\S+', '', cmd)
    return cmd.strip()


# Shell keywords that are structural, not commands to approve/deny.
# These appear as segments after splitting on ;/newlines in for/while/if blocks.
legacy_SHELL_KEYWORDS = frozenset({
    'do', 'done', 'then', 'else', 'elif', 'fi', 'esac', '{', '}',
    'break', 'continue',
})

# Keywords that can prefix a command when joined by ; (e.g. "do echo hello").
# These should be stripped to expose the real command underneath.
legacy__KEYWORD_PREFIX_RE = re.compile(
    r'^(do|then|else|elif)\s+'
)

# Patterns for shell compound statement headers (for, while, until, if, case).
# These introduce control flow but aren't executable commands themselves.
legacy__COMPOUND_HEADER_RE = re.compile(
    r'^(for|while|until|if|case|select)\b'
)


def legacy_strip_keyword_prefix(cmd):
    """Strip leading shell keyword prefix from a command.

    "do echo hello" -> "echo hello"
    "then git status" -> "git status"
    """
    m = legacy__KEYWORD_PREFIX_RE.match(cmd)
    if m:
        return cmd[m.end():]
    return cmd


def legacy_is_shell_structural(cmd):
    """Return True if cmd is a shell keyword or compound-statement header."""
    if cmd in legacy_SHELL_KEYWORDS:
        return True
    if legacy__COMPOUND_HEADER_RE.match(cmd):
        return True
    return False


def legacy_is_standalone_assignment(cmd):
    """Return True if cmd is purely a variable assignment (no following command).

    e.g. "result=$(curl ...)" or "FOO=bar" , these are not commands to check.
    The subshell contents, if any, are extracted and checked separately.
    """
    m = re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', cmd)
    if not m:
        return False
    # Check if the entire string is consumed by the assignment value
    end = legacy__skip_shell_value(cmd, m.end())
    rest = cmd[end:].strip()
    return rest == ''


def legacy_normalize_command(cmd):
    """Normalize a command by stripping env vars, redirections, and whitespace."""
    cmd = cmd.strip()
    if not cmd:
        return cmd
    cmd = legacy_strip_keyword_prefix(cmd)
    cmd = legacy_strip_env_vars(cmd)
    cmd = legacy_strip_redirections(cmd)
    # Collapse multiple spaces
    cmd = re.sub(r'\s+', ' ', cmd)
    return cmd.strip()


def legacy_decompose_command(command):
    """Decompose a compound command into all individual sub-commands.

    Splits on operators, extracts subshell contents, normalizes each.
    Filters out shell structural keywords (for/do/done/etc.) and
    standalone variable assignments (whose subshell contents are checked
    separately).
    Returns a list of normalized command strings.
    """
    all_commands = []

    # Get top-level segments
    segments = legacy_split_on_operators(command)

    for seg in segments:
        # Also decompose any subshells found in this segment
        subshells = legacy_extract_subshells(seg)
        for sub in subshells:
            sub_segments = legacy_split_on_operators(sub)
            for ss in sub_segments:
                normalized = legacy_normalize_command(ss)
                if normalized:
                    all_commands.append(normalized)

        # Normalize the top-level segment itself
        normalized = legacy_normalize_command(seg)
        if normalized:
            all_commands.append(normalized)

    # Filter out shell structural keywords and standalone assignments
    return [
        cmd for cmd in all_commands
        if not legacy_is_shell_structural(cmd) and not legacy_is_standalone_assignment(cmd)
    ]


def legacy_decide(command, settings):
    """Make a permission decision for a compound command. DENY-ONLY.

    Returns:
        ("deny", reason) if any sub-command OR the full command matches
                         a deny pattern
        (None, None) otherwise , fall through to normal permission flow
    """
    if not command or not command.strip():
        return None, None

    permissions = settings.get("permissions", {})
    deny_patterns = legacy_parse_bash_patterns(permissions.get("deny", []))
    if not deny_patterns:
        return None, None

    # Full-command check: pipe-shaped deny patterns ("curl * | sh") only
    # match the undecomposed string.
    flat = re.sub(r'\s+', ' ', command).strip()
    if legacy_command_matches_pattern(flat, deny_patterns):
        return "deny", f"Command matches deny pattern"

    for cmd in legacy_decompose_command(command):
        if legacy_command_matches_pattern(cmd, deny_patterns):
            return "deny", f"Sub-command '{cmd}' matches deny pattern"

    return None, None


LEGACY_TIME_BUDGET_SECONDS = 2.0


def _legacy_alarm(signum, frame):
    raise TimeoutError('previous matcher time budget exceeded')


def _legacy_with_budget(command, settings):
    # Signal timers are process-wide and can only be installed on the main thread.
    if (threading.current_thread() is not threading.main_thread() or
            not all(hasattr(signal, name) for name in
                    ('SIGALRM', 'ITIMER_REAL', 'setitimer', 'getitimer'))):
        return legacy_decide(command, settings)
    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    started = time.monotonic()
    try:
        signal.signal(signal.SIGALRM, _legacy_alarm)
        signal.setitimer(signal.ITIMER_REAL, LEGACY_TIME_BUDGET_SECONDS)
        return legacy_decide(command, settings)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        delay, interval = previous_timer
        if delay:
            delay = max(0.000001, delay - (time.monotonic() - started))
        signal.setitimer(signal.ITIMER_REAL, delay, interval)


def decide(command, settings):
    """Run the scanner first, then retain any denial from the previous matcher."""
    denies = settings.get('permissions', {}).get('deny', [])
    if not denies:
        return None, None
    try:
        if not parse_bash_patterns(denies):
            return None, None
    except Exception:
        # The scanner keeps its existing fail-closed reason for invalid patterns.
        return parser_decide(command, settings)
    verdict = parser_decide(command, settings)
    if verdict[0] == 'deny':
        return verdict
    try:
        decision, reason = _legacy_with_budget(command, settings)
        if decision == 'deny':
            return 'deny', 'Legacy check: ' + reason
    except BaseException:
        # An optional check must never replace the scanner verdict with an error.
        pass
    return verdict


_log_lines = []


def _verbose_enabled():
    """Check if verbose logging is enabled.

    Controlled by SMART_APPROVE_VERBOSE env var:
      "1", "true", "yes" → enabled
      "0", "false", "no", unset → disabled
    """
    return os.environ.get("SMART_APPROVE_VERBOSE", "").lower() in ("1", "true", "yes")


def log(msg):
    """Collect verbose log line when enabled."""
    if _verbose_enabled():
        _log_lines.append(msg)


def _build_reason(reason):
    """Build the permissionDecisionReason, appending verbose logs if any."""
    if not _log_lines:
        return reason
    verbose = " | ".join(_log_lines)
    if reason:
        return f"{reason} | {verbose}"
    return verbose


def main():
    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        log("no valid JSON on stdin, skipping")
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    if tool_name != "Bash":
        log(f"tool={tool_name}, not Bash, skipping")
        sys.exit(0)

    command = input_data.get("tool_input", {}).get("command", "")
    if not command:
        log("empty command, skipping")
        sys.exit(0)

    settings_path = os.environ.get("CLAUDE_SETTINGS_PATH")
    settings = load_merged_settings(settings_path)
    configured = bool(settings.get("permissions", {}).get("deny", []))

    try:
        cmd_preview = command[:80].replace('\n', '\\n')
        log(f"checking: {cmd_preview}{'...' if len(command) > 80 else ''}")
        if _verbose_enabled() and configured:
            try:
                sub_commands = decompose_command(command)
                log(f"sub-commands: {sub_commands[:5]}{'...' if len(sub_commands) > 5 else ''}")
            except ParseProblem as exc:
                log(f"parse problem: {exc}")
        decision, reason = decide(command, settings)
        log(f"decision={decision or 'passthrough'} reason={reason or 'no pattern matched'}")
        reason = _build_reason(reason) if decision == "deny" else reason
    except Exception as exc:
        if configured:
            decision, reason = guard_error(exc)
        else:
            decision, reason = None, None

    if decision == "deny":
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": decision,
                "permissionDecisionReason": reason,
            }
        }
        json.dump(output, sys.stdout)
        sys.stdout.write("\n")
    # Otherwise fall through silently to normal prompting.


if __name__ == "__main__":
    main()
