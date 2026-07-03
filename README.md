# Lararium

A clone-and-run scaffold for a personal agentic system: a file-based knowledge **brain**, a layered
**soul** (your assistant's persona), a **clocktower** index over your data, a roster of **agents**
the assistant dispatches, the **hooks** that make it feel alive session to session, and the
**skills** it runs as slash commands. This is the empty cathedral. You bring the life that goes in it.

> This is a *template*, extracted from a working private system and depersonalized. It ships
> structure, conventions, and patterns. It ships **none** of the original owner's data, persona, or
> secrets. See `SCRUB.md` for exactly what was removed and how to verify nothing leaked.

## The six layers

1. **`brain/`**: a human-navigable markdown knowledge store, scoped by life sphere, governed by a
   small set of laws (`brain/CLAUDE.md`). Files are canonical; the database is an index on top. This
   is the heart of the system and the one you should read first.
2. **`soul/`**: how your assistant's persona is assembled each session: seven layered sections, a
   heartbeat loop that lets it remember the last session, and voice-drift monitoring so it keeps
   sounding like itself. Ships blank. You write the character, and `soul/character-craft.md`
   teaches the craft (archetypes, trait tensions, tone proofs). Its rules half lives in
   `rules/OPERATING.md`: action bias, the miss-capture protocol, steering rules, the standards.
3. **`clocktower/`**: the index: schema, an MCP server config, the watcher pattern that ingests
   your corpora, the embeddings standard, and the retrieval doctrine earned in production
   (`clocktower/retrieval-doctrine.md`). The memory layer has four organs, intake, carder, gate, and
   connector; the last is the daily "what I just learned maps to what I am stuck on" job, documented
   in `clocktower/connector-doctrine.md`. Ships with an empty database and no credentials.
4. **`agents/`**: a roster of specialized subagents (build, review, research, infra, adversarial,
   memory) plus the dispatch doctrine for when to use which. The theme is replaceable: the
   re-theming interview (`agents/RETHEME.md`) rebuilds the roster in your own mythology, doctrine
   intact. Bring your own gods.
5. **`hooks/`**: the loops. Session-start briefing, the heartbeat that remembers yesterday, voice
   integrity, compaction continuity, safety rails, dispatch routing. Doctrine plus minimal
   reference implementations that run on plain files, no database required.
6. **`skills/`**: slash-command skills for the session lifecycle (`/end`, `/handoff`, `/sessions`),
   self-improvement (`/evolve`), and memory curation (`/muninn`), plus the doctrine for writing
   your own.

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

**Prerequisite:** an AI coding assistant that can read and write files in a local folder. The install
interview *writes your files for you*, so it needs filesystem access. [Claude Code](https://claude.com/claude-code)
is the reference setup (it has its own subscription or API key). A browser chat can talk you through
the interview but cannot write into your folder, so you would be copy-pasting; use the real tool.

Then get the template locally, whichever way is easiest:

```
# Fastest: the scaffolder fetches the latest release and unpacks it for you
npx lararium [folder]   &&   cd [folder]

# Or, if it is a GitHub template repo: click "Use this template" to make your own copy, then
git clone https://github.com/<you>/<your-copy>.git   &&   cd <your-copy>

# Or, if you were sent a zip: unzip it, then
cd lararium
```

Now open that folder in Claude Code (`claude` from inside it) and run the interview below. That is the
whole install. The brain and soul layers need nothing else. The index (clocktower) is optional and
needs your own database and embedding key when you decide you want search at scale.

## Fast path: let it install itself

The quickest way in is `INSTALL.md`: open this repo in Claude Code and say *"run the install
interview in INSTALL.md."* It interviews you, names your spheres, writes your assistant's character,
turns the example cards into your real ones, and gets out of the way. An agentic stack is installed by
an agent. If you would rather do it by hand, follow the manual setup order below.

## Setup order (manual)

Start with the brain. It is useful on day one with zero infrastructure: just markdown and the laws.
Add the soul when you want a consistent voice, and its rules half with it. Wire the hooks when you
want the assistant to remember yesterday; the reference implementations run on plain files. Add
clocktower when the file layer outgrows grep-and-read and you want semantic search at scale. Add
agents and skills last; they are leverage on top of a system that already works.

```
1. Read  brain/CLAUDE.md          # the laws, the map
2. Fill  brain/now.md             # your cross-cutting heartbeat
3. Write soul/core.md             # your assistant's character (replace the blank)
4. Adopt rules/OPERATING.md       # the operating rules, edited until true of you
5. Wire  hooks/                   # the loops: briefing, heartbeat, rails
6. Adopt skills/                  # the session-lifecycle slash commands
7. Stand up clocktower/           # optional: the index, when you need it
8. Adopt agents/                  # optional: the roster + dispatch doctrine
```

## What this is not

Not a hosted product, not multi-tenant, not a SaaS. It is a personal system you run yourself,
shaped so a peer can clone it and make it theirs. If you want the productized version, that is a
different and much larger build.
