# sandbox: the capability wall for your own agent

`060_lab/` sandboxes *other people's* code. This sandboxes *yours* — or rather,
the shell your assistant drives on your behalf, which is the one nobody thinks
to contain because it is supposed to be trusted.

## Why a second control at all

`../reference/bash-deny-guard.py` reads a command string and decides. That is
useful and it is a fence, not a wall. It cannot resolve `$VAR`, aliases, shell
functions, or the contents of a script it invokes, because those are runtime
facts and the guard runs before runtime. Better parsing does not fix it; the
information is not there yet.

This does not read the command. It removes the capability and lets the kernel
enforce it. The difference shows up immediately:

```
$ cat ~/.ssh/config                    # guard: judges the string
$ /bin/cat "$HOME/.ssh/config"         # guard: different string, same effect
$ X=~/.ssh; ls $X                      # guard: cannot resolve $X at all
```

All three are `Operation not permitted` under the profile, because the kernel
is checking the resolved path, not the spelling. There is nothing to talk past.

## Use it

```
040_hooks/sandbox/sandboxed-bash 'your command'   # one command
040_hooks/sandbox/sandboxed-bash                  # interactive sandboxed shell
```

Point your agent's Bash at `sandboxed-bash` instead of `/bin/bash`, or use it
by hand for the sessions that make you nervous.

## What the profile blocks

- **Credential stores, read AND write**: `~/.ssh`, `~/.aws`, `~/.gnupg`,
  `~/.config/gcloud`, `~/.kube`, `~/.docker`, Keychains, browser cookies,
  `.netrc`, `~/.env`, `~/.npmrc`, `~/.git-credentials`. Blocking *read* is the
  important half: what cannot be read cannot be exfiltrated.
- **The assistant's own auth and controls**: `~/.claude/.credentials.json` is
  unreadable; `~/.claude/hooks/` and both `settings*.json` are unwritable, so a
  session cannot quietly edit the guard that governs it.
- **Shell startup files and LaunchAgents**: the usual places a foothold
  survives a reboot.
- **System paths**: `/System`, `/usr/bin`, `/bin`, `/etc`, and friends.

Everything else is allowed, so ordinary work is unaffected.

## Honest limits

- It is `allow default` plus targeted denials — a blocklist, the same shape
  criticized elsewhere in this stack. What makes it worth shipping anyway is
  that it is enforced on the **resolved path by the kernel**, not on the
  spelling by a regex. An unlisted path is still reachable; no amount of clever
  quoting reaches a listed one. Add your own paths.
- **It does not restrict the network.** A sandboxed shell can still make
  outbound connections. It just has nothing sensitive to send. Add
  `(deny network*)` if you want that too, and expect to spend a while
  re-allowing the things that legitimately need it.
- `sandbox-exec` is deprecated by Apple. It works today and has for many
  releases. `sandboxed-bash` **fails closed** if it disappears rather than
  silently running unsandboxed — a wall that quietly stops being a wall is
  worse than no wall, because you keep trusting it.
- macOS only. On Linux, the same shape comes from a container; `060_lab/`
  already has the pattern.
