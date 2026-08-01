# Lararium

*A lararium was the shrine in a Roman house where the household gods lived. The family kept it, fed
it, and spoke to it daily. This is that, for a life run with AI: the shrine, and the gods you keep
in it.*

A clone-and-run scaffold for a personal agentic system. Six layers: a file-based knowledge
**brain**, a layered **soul** (the assistant you actually talk to), a **clocktower** index over
your data, a roster of **agents** the assistant dispatches, the **hooks** that make it feel alive
session to session, and the **skills** it runs as slash commands.

It ships empty on purpose. The architecture was never the moat: your life is. So you get the
shrine, and you bring your own gods.

> **This is a template**, extracted from a working private system and depersonalized. It ships
> structure, conventions, and hard-won patterns. It ships **none** of the original owner's data,
> persona, or secrets. See `SCRUB.md` for exactly what was removed and how to verify nothing leaked.

## Why this instead of a prompt pack

Everyone else hands you *their* context: their prompts, their personas, their ten hacks. Lararium
hands you the empty structure and teaches you to pour your own life into it. A second brain can't
be copied off a shelf; it has to be lived. That is the whole design, and it is why giving this away
costs nothing: nobody can steal a life they have to build themselves.

It also installs itself. You open it in an AI coding assistant and say *"run the install interview."*
An agentic stack is installed by an agent. It interviews you, one question at a time, and writes
your files while you answer.

## The six layers

1. **`brain/`**: a human-navigable markdown knowledge store, scoped by life sphere, governed by a
   small set of laws (`brain/CLAUDE.md`). Files are canonical; the database is an index on top. The
   heart of the system, and the one to read first. Useful on day one with nothing but markdown.
2. **`soul/`**: the assistant's persona, assembled fresh each session: seven layered sections, a
   heartbeat loop that lets it remember yesterday, voice-drift monitoring so it keeps sounding like
   itself. Ships blank; `soul/character-craft.md` teaches the craft (archetypes, trait tensions,
   tone proofs). Its rules half lives in `rules/OPERATING.md`: action bias, the miss-capture
   protocol, steering rules, the standards.
3. **`clocktower/`**: the index: schema, an MCP server config, the watcher pattern that ingests
   your corpora, the embeddings standard, and the retrieval doctrine earned in production
   (`clocktower/retrieval-doctrine.md`). The memory layer has four organs, intake, carder, gate, and
   connector; the last is the daily "what I just learned maps to what I am stuck on" job, documented
   in `clocktower/connector-doctrine.md`. Coordination is a separate surface: `clocktower/queue-doctrine.md`
   runs multi-agent work natively on the tasks table you already have. Ships with
   an empty database and no credentials.
4. **`agents/`**: a roster of specialized subagents (build, review, research, infra, adversarial,
   memory) plus the dispatch doctrine for which to use when. The theme is yours to replace: the
   re-theming interview (`agents/RETHEME.md`) rebuilds the whole roster in your own mythology,
   doctrine intact. Bring your own gods, literally.
5. **`hooks/`**: the loops that make it feel alive. Session-start briefing, the heartbeat that
   remembers yesterday, voice integrity, compaction continuity, safety rails, dispatch routing.
   Doctrine plus minimal reference implementations that run on plain files, no database required.
6. **`skills/`**: slash-command skills for the session lifecycle (`/end`, `/handoff`, `/sessions`),
   self-improvement (`/evolve`), and memory curation (`/muninn`), plus the doctrine for writing
   your own.

Beside the six layers ships one optional tool: **`lab/`**, a disposable sandbox for untrusted
code. Your assistant is most useful when it can clone and run other people's repos, which is
exactly when it is most dangerous. The lab is a throwaway container, no network by default,
nothing of yours mounted in, every capability dropped, that you drop untrusted code into so it can
do its worst and it doesn't matter. The `/in-the-lab` skill runs it for you: offline recon first,
then an optional deeper session. Requires Docker; skip it if you don't have a daemon.

And one more beside them: **`measure/`**, four small programs that grade the assistant from evidence
it already produced. They read your session transcripts (read-only, always) and derive what a session
actually did from its tool calls, what you left unfinished, what you have now started twice, and
whether the assistant is getting better or worse, the last one read off your own next message rather
than out of a survey nobody answers honestly. No model call, no spend, no database. Run them with
`/measure`. The doctrine underneath, why a green heartbeat proves nothing and what to grade instead,
is `rules/MEASUREMENT.md`.

Staying current is meant to be passive: **your stack tells you when it is behind.** Adopt the
update-check hook (`hooks/reference/update-check.js`) and once a day, at session start, it checks the
upstream template's version against your own `STACK_VERSION` and, if a newer release is out, drops one
line into your session: type **`/upgrade`**. That skill fetches the latest template and runs the
upgrade interview in `UPGRADING.md` for you, applying the doc-only deltas directly and asking you only
about the structural ones. You answer questions; your assistant does the typing. The manual fallback,
for a stack that has not wired the hook yet: **Watch releases** on the upstream repo and read
`CHANGELOG.md`, where each release maps to an entry that classifies it as a doc copy-in or a full
interview and names exactly which files moved since your own `STACK_VERSION`.

## Getting it onto your machine

**Prerequisite:** an AI coding assistant that can read and write files in a local folder. The
install interview *writes your files for you*, so it needs filesystem access.
[Claude Code](https://claude.com/claude-code) is the reference setup (it brings its own subscription
or API key). A browser chat can talk you through the interview but cannot write into your folder, so
you would be copy-pasting; use the real tool.

Get the template locally. Three ways in, pick your trust level:

```
# Fast path: the scaffolder downloads the latest release and unpacks it
npx lararium my-stack  &&  cd my-stack

# GitHub template repo: click "Use this template" to make your own copy, then
git clone https://github.com/<you>/<your-copy>.git  &&  cd <your-copy>

# Sent a zip: unzip it, then
cd lararium
```

Wary of `npx`-ing a stranger's installer? Good instinct, it is the whole reason this stack
exists. The scaffolder (`npx/index.js`) is about 200 lines of Node standard library with zero
dependencies: it downloads a release tarball, unpacks it, and runs `git init`. It runs none of
the template's own code. Read it before you run it, or skip it entirely and clone the repo by
hand, then you have inspected everything before a single line executes.

And if you are properly paranoid: the two files worth eyeballing are both short (`npx/index.js`
and `lab/lab`). Read those, then let your very first lab run be Lararium itself:

```
lab/lab https://github.com/kylnor/lararium
```

That vets the rest of the stack inside the box it ships. The tool's first job can be auditing
its own supplier.

Then open the folder in Claude Code (`claude` from inside it) and say:

```
Run the install interview in INSTALL.md
```

That is the whole install. The brain and soul layers need nothing else. The index (clocktower) is
optional and wants your own database and embedding key, the day you decide you want search at scale.

## Where your copy lives (never a fork)

You are about to pour your life into this repo. Decide where it lives before you push it anywhere,
because one of the obvious options cannot be undone. `SCRUB.md` is about what you publish on
purpose; this is about not publishing by accident.

**Do not use GitHub's Fork button.** A fork of a public repo cannot be made private. Visibility is
inherited from the parent and there is no switch that flips it later, so the only fix is to delete
the fork and start again.

The less obvious half is worse. Every fork shares one object store with the repo it came from.
Commits you push to a fork stay fetchable by SHA from the public parent, and deleting the fork does
not retract them. A "private" fork of a public template is not private in any sense that matters; it
is a public repo with a quiet URL. For the repo that ends up holding your people, your money, and
your health, that is the whole ballgame.

Two clean routes, and neither one is a fork:

**Use this template.** That button makes a genuinely new repository, outside the fork network, with
its own object store, and it lets you choose private at creation. If you came in that way you are
already done.

**A plain clone pushed to a new private repo.** Works from any of the three routes above, from a
zip, from any host:

```
git clone https://github.com/kylnor/lararium.git my-stack
cd my-stack
git remote rename origin upstream          # keep it to read from; never push to it

gh repo create <you>/my-stack --private    # a NEW repo, not a fork. That is the whole point.
git remote add origin git@github.com:<you>/my-stack.git
git push -u origin main
```

Want a history that starts with you instead of with the template? Run `rm -rf .git && git init`
before the `gh repo create` line. That is exactly what the npx scaffolder does, which is why the
fast path never has this problem.

You give up nothing by not forking. Staying current needs no git relationship with upstream:
`/upgrade` fetches the latest release and applies it, and the update-check hook reads the upstream
version over plain HTTPS. Keep `upstream` as a read-only remote if you like diffing against it.
Fetching from a public repo leaks nothing.

One cost worth naming, after yc-software/qm (MIT): a plain clone is an ordinary repository, so any
CI workflows the template ships run live in your own account the moment you push. Lararium ships
none today. Check before you take any other template this way.

The rest of these docs say "fork" loosely, meaning your own copy of the stack. This section means
the literal button.

## Setup order (if you would rather do it by hand)

Start with the brain: useful immediately, zero infrastructure, just markdown and the laws. Add the
soul when you want a consistent voice, its rules half with it. Wire the hooks when you want the
assistant to remember yesterday; the reference implementations run on plain files. Add clocktower
when the file layer outgrows grep-and-read and you want semantic search at scale. Agents and skills
last: leverage on top of a system that already works.

```
1. Read  brain/CLAUDE.md          # the laws, the map
2. Fill  brain/now.md             # your cross-cutting heartbeat
3. Write soul/core.md             # your assistant's character (replace the blank)
4. Adopt rules/OPERATING.md       # the operating rules, edited until true of you
5. Wire  hooks/                   # the loops: briefing, heartbeat, rails
6. Adopt skills/                  # the session-lifecycle slash commands
7. Stand up clocktower/           # optional: the index, when you need it
8. Adopt agents/                  # optional: the roster + dispatch doctrine
9. Run   measure/                 # optional: grade the whole thing from evidence
```

Already running an earlier version? Open your stack beside this template and say *"run the upgrade
interview in UPGRADING.md."* It adds the new layers without touching anything you made yours.

## What this is not

Not a hosted product, not multi-tenant, not a SaaS. It is a personal system you run yourself, shaped
so a peer can clone it and make it theirs. The productized version is a different and much larger
build. This is the shrine, free. What you enshrine in it is the part only you can make.

---

MIT licensed. Built in the open from a system that runs a real life. Bring your own gods.
