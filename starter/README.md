# Start here in five minutes

You do not need the six layers, the soul, the index, the agents or any of the governance to get
value from this. The starter is a map, three folders and a memory index. That is enough for an
assistant that stops asking you the same questions.

## What you end up with

```
CLAUDE.md          the map: what lives where, and how to look things up
notes/             one topic per file: things you know, decisions, how-tos
people/            one person per file: who they are, what you owe each other
projects/          one project per file: what it is, where it stands
memory/MEMORY.md   the index of lessons your assistant has learned about you
```

File rules, the whole system in four lines:

- One topic per file. Two topics means two files.
- Name files for what is in them, lowercase with hyphens: `jane-doe.md`, `kitchen-remodel.md`.
- Search before you answer. The assistant greps the folder first, then says what it found.
- A miss is not proof. If a search finds nothing, the answer is "not found in X", never "that
  does not exist".

## The five minutes

1. **Get the folder and open it in your assistant.** Claude Code is the reference setup; it needs
   to read and write files here.

   ```
   npx lararium my-stack  &&  cd my-stack  &&  claude
   ```

2. **Say this:**

   ```
   Run the starter in starter/README.md
   ```

3. **The assistant does the typing.** It follows the steps below, one question at a time, and
   shows you each file as it writes it.

## Steps the assistant follows

Use the file tools for every edit. When a shell command is unavoidable, run one short command at a
time and say what it does first. Never chain commands.

1. Copy `starter/CLAUDE.template.md` to `CLAUDE.md` at the root, then fill the three blanks in it
   from the user's answers: whose folder this is, what they use it for, and the single most useful
   thing for an assistant to know about them.
2. Create the three folders by writing a file in each: `notes/README.md`, `people/README.md`,
   `projects/README.md`, each one or two lines saying what belongs there. (The template's brain
   law is never to pre-build empty folders. These three are the one deliberate exception, because
   the map points at them.)
3. Interview, one question at a time, and write one note each:
   - A person who matters right now: `people/<name>.md`.
   - A project on their plate: `projects/<name>.md`.
   - One fact they are tired of repeating: `notes/<topic>.md`.
   Read each file back from disk and let the user correct it.
4. Point the other assistants at the same map. If `node` is available, run
   `node hooks/memory-pointers.mjs . --project` from this folder. It adds a short block to
   `AGENTS.md` and `GEMINI.md` here, so Codex and Gemini CLI find the same files. It touches
   nothing outside this folder. If `node` is missing, open `memory/pointer-block.md`, replace
   `{{STACK_ROOT}}` with this folder's full path, and paste the result at the end of `AGENTS.md`.
5. Prove it. Tell the user to open a new conversation in this folder and ask: "Where does my
   memory live, and what do you know about me?" It should answer from the files without being told
   which ones to read. If it does not, say so plainly and fix that before anything else.

## What your assistant does after that

When you correct it or tell it something worth keeping, it writes a card in `memory/` and adds a
one-line pointer to `memory/MEMORY.md` (the card format is in `memory/README.md`). The shipped
startup hook loads that index at the start of each Claude Code session, so a lesson learned once
stays learned. Check any time with `node hooks/memory-check.mjs .`.

## When you outgrow the starter

Everything else is optional and you add it when the pain shows up, not before:

| when you notice | add | where |
|---|---|---|
| The assistant forgets what you were doing yesterday | the hooks come wired already; check them | `docs/memory-check.md` |
| Notes about people and ventures are getting tangled | the full brain, with spheres | `brain/CLAUDE.md` |
| You want one consistent voice | the soul | `soul/README.md` |
| Your instruction file keeps growing and agents skip it | governance and a constitution | `governance/README.md` |
| You hand builds to agents and they guess what you meant | the forge | `forge/README.md` |
| One project needs its own space | a workspace, once it has earned one | `workspaces/README.md` |
| Grep stops finding things at your scale | the index | `clocktower/README.md` |
| A machine fills its disk or loses unpushed work | the ops guards | `docs/ops-guards.md` |

The full install interview in `INSTALL.md` walks all of it. You do not need it to start.
