---
title: "The Command Underneath"
slug: the-command-underneath
lane: dispatch
version: v3.2.1
date: 2026-11-10
description: A deny rule has to reach the command the shell will run.
status: draft
---

# The Command Underneath

You put `rm` on the deny list. The assistant calls `/bin/rm`. The shell knows they can name the
same program. Until this release, the reference guard did not.

There was another gap before the command even began. A quoted `<<` in a grep expression looked
like a heredoc opener to the guard. It treated the lines after it as data, including a denied
command on the next line. A bit shift inside a Python string could do the same thing.

A deny list is only as useful as the reader standing in front of it.

The guard in v3.2.1 reads quoting, comments and heredocs in one scanner. It finds executable
substitutions inside double quotes and unquoted heredocs, leaves ordinary bodies alone, and
checks shell strings as commands. It removes spelling differences from the command word and
looks through wrappers such as `sudo`, `env` and `timeout`. It also keeps the written form, so
an existing rule that names a path still works.

It still answers only the question the owner asked: does this command match a deny pattern?
Unknown programs do not acquire a new approval tier. A broken guard does acquire a visible
failure: with deny patterns configured, an internal error returns a deny and instructions for
unwiring the hook. Silence would make the owner's rule disappear.

There are limits. Variables, aliases or functions defined elsewhere, scripts and interpreter code
need run-time knowledge this hook does not have; function bodies written in the command are checked.
Data piped into a shell can become code after the hook has
finished. A copied binary can have another name. The README names these gaps explicitly.

The bypasses affect every version through v3.2. To adopt the fix, copy
`hooks/reference/bash-deny-guard.py` over your installed copy. Pulling this template does not
replace a file you copied into another stack.
