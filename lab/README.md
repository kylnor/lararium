# lab — the untrusted-code sandbox

Your assistant is at its most useful when it can clone and run other people's code. That is
also exactly when it is most dangerous: `npm install` pulls a dependency tree nobody read, a
repo's postinstall or runtime can exfiltrate or wreck the machine, and an assistant *reading*
a hostile file can be talked into running it. The lab is the answer that ships in the box:
a disposable container you throw untrusted code into so it can do its worst and it doesn't
matter.

The container is the blast wall. Every run guarantees:

- **Nothing of yours is mounted in.** No assistant config, no SSH keys, no keychain, no home
  dir. Code enters by `git clone` inside the box or `docker cp` — never a bind mount. If the
  code fully owns the box, there is nothing of yours in there to steal.
- **No network by default.** A git URL gets network for the *clone only*, then the shell drops
  offline. `--net` keeps it on when you actually want to watch what it dials.
- **Disposable.** `--rm` on exit; any volume it creates is deleted on the way out. You never
  clean it, you delete it. Cattle, not a pet.
- **De-fanged.** Every Linux capability dropped + `no-new-privileges`, so even the root user
  inside has no kernel power. Plus memory + pid limits so a zip-bomb or fork-bomb can't take
  the host down.

## Use

```bash
lab https://github.com/someone/sketchy-repo    # clone, land offline inside it
lab ~/Downloads/thing                           # copy a local dir in, offline shell
lab ~/Downloads/thing.zip                        # copy a zip in, unzip, offline shell
lab --net https://github.com/x/y                 # leave network ON to test install/run
lab --analyze <source>                           # non-interactive recon report, then tear down
```

Inside you get a normal shell. `npm install`, run the dev server, whatever — if it detonates,
type `exit` and the box and everything in it is gone. Nothing reached your machine.

`--analyze` is what the `/in-the-lab` skill runs: it spins the box, does an offline read-only
recon (install hooks, network/shell/eval reaches, obfuscation, dependency count), prints a
report, and tears down. It executes none of the repo's own code — it only reads — so your
assistant can tell you what the code reaches for before anyone runs it for real.

First run builds the `lab:latest` image once (~30s). After that it's instant.

## What this is NOT

- Not protection if you `--net` AND the code exfiltrates — network on means it can talk. Use
  `--net` only when you are watching, and prefer reading (`--analyze`) first.
- Not proof against a kernel container-escape 0-day (nation-state tier, not the usual threat).
  For "safe regardless of contents," run it in a throwaway cloud box instead.
- Not a substitute for reading. `--analyze` narrows it down; the lab contains what reading
  can't see (the dependency tree `npm install` pulls, runtime-only payloads).

## Requires

A running Docker daemon (Docker Desktop, OrbStack, `colima start`, or any Linux Docker/Podman).
The wrapper only shells out to the `docker` CLI, so any of them work.
