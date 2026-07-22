---
name: in-the-lab
description: Run an untrusted repo, folder, or zip inside the disposable lab sandbox before it touches the host, offline recon first, optional deeper interactive session. Triggers on "/in-the-lab", "in the lab", "run this in the lab", "is this repo safe", "I downloaded a repo", "should I run this", "check this repo", "tear this apart safely".
---

# /in-the-lab: sandbox untrusted code before it touches the machine

Someone handed the owner code they did not write, or they just cloned/downloaded a repo. Your job
is to look at it *inside the lab* (`../lab/`, a disposable container) and never on the host. The
lab is the blast wall: no network by default, nothing of the owner's mounted in, disposable,
every Linux capability dropped. Reading a hostile file can talk an assistant into running it, so
the discipline is: **the untrusted code runs in the box, or it does not run.**

## Step 1: Resolve the source

Take it from args if given. Otherwise infer it from what just happened in the conversation: the
repo they cloned, the zip in `~/Downloads`, the path they pasted. The source is one of:

- a git URL (`https://…` or `git@…`)
- a local directory
- a `.zip` file

If you cannot tell which repo they mean, ask once, precisely. Do not guess across two candidates.

## Step 2: Find the lab and check Docker

The wrapper is `lab/lab` in this stack (or wherever it was installed, check `lab/` at the stack
root). It needs a running Docker daemon. If `docker info` fails, tell the owner to start Docker
(Docker Desktop, OrbStack, or `colima start`) and stop here. Do not fall back to running the code
on the host.

## Step 3: Recon in the box (never on the host)

Run the non-interactive recon:

```bash
<stack>/lab/lab --analyze <source>
```

This spins the sandbox, clones/copies the code in, runs an **offline, read-only** pass (install
hooks, network/shell/eval reaches, obfuscation, dependency count), prints a report, and tears
down. It executes none of the repo's own code. Read the report.

**Never**, as part of triage, `npm install` or run the untrusted code on the host. That is the
whole point of the lab.

## Step 4: Report and offer the next move

Tell the owner in plain language what the code reaches for and your read on it:

- Install/postinstall hooks? What do they do?
- Does it reach for the network, spawn shells, `eval`/`atob`/base64-decode, or look obfuscated?
- How big is the dependency tree it wants to pull that nobody has read?
- Your honest call: looks ordinary, looks worth a closer look, or looks hostile.

Then offer the next step, matched to what you found:

- **Go deeper:** `<stack>/lab/lab <source>` drops into an interactive offline shell in the box:
  `npm install`, run it, watch it, all contained. `--net <source>` if they want to test something
  that genuinely needs network and are willing to watch what it dials.
- **They trust it:** only then does running it on the host become the owner's call, made with eyes
  open, not a default you reached for.

## The standing reflex

Beyond the explicit command: whenever the owner clones or downloads code neither of you wrote and
is about to install or run it, say so first, "run it in the lab before it touches your machine",
and offer `/in-the-lab`. Reading narrows the risk; the lab contains what reading cannot see.
