# <Your name>'s folder

This file is the map. It is loaded at the start of every conversation, so keep it short: it says
where things are, not what they say.

## What this is for

<One or two sentences: what you use this folder for. Example: "Running my consulting business and
my household. Clients, projects and the notes behind them.">

## The most useful thing to know about me

<One sentence an assistant should never have to ask. Example: "I read on my phone, so keep
replies short and put the answer first.">

## Where things live

- `people/`: one person per file. Who they are and what we owe each other.
- `projects/`: one project per file. What it is and where it stands.
- `notes/`: one topic per file. Things I know, decisions, how-tos.
- `memory/`: lessons and corrections, one card per fact. `memory/MEMORY.md` is the index.

## How to look things up

1. Search the files first, always: `grep -ril --exclude-dir=.git "<term>" .`
2. Read the matching file before you answer.
3. A search miss is not proof a fact is absent. Say "not found in <where you looked>", never "it
   does not exist". The fact may live under another name or in a place you did not search.

## File rules

- One topic per file. Two topics means two files.
- Name files for what is in them: lowercase, hyphens, `.md`. Example: `kitchen-remodel.md`.
- When something changes, edit the file. Do not write a second file saying it changed.

## Memory

When I correct you, or tell you something worth keeping, write a card in `memory/` (one fact per
file, frontmatter, format in `memory/README.md`) and put a one-line pointer at the top of
`memory/MEMORY.md`. Read the card back to confirm it saved. Do not rely on remembering.

## When this outgrows the starter

Optional layers (brain, soul, governance, forge, workspaces, index) are described in
`starter/README.md`. Add one only when its pain shows up, and when you do, add one line here
saying where it lives. Keep this file a map.
