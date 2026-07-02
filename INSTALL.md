# Install (the interview)

This is not a script. It is a prompt. An agentic stack is installed by an agent.

**How to run it:** open this freshly-cloned template in any capable assistant (Claude Code, or paste
this file into a chat) and say: *"Run the install interview in INSTALL.md against this repo."* The
assistant interviews you and writes your files. You answer questions; it does the typing.

**The rules the assistant follows during the interview:**
- Ask **one question at a time.** Never dump the whole questionnaire. This is a conversation, not a form.
- Ask only what changes the output. Infer the rest and state what you inferred so the user can correct it.
- Write files as you go, show the user each one, move on. Do not wait until the end to produce everything.
- When a phase is optional, say so and let the user skip it. The brain layer alone is useful on day one.

---

## Phase 0: Read the map
Before any question, read `brain/CLAUDE.md` (the laws) and `README.md` (the six layers). Tell the
user, in two sentences, what they are about to set up. Then begin.

## Phase 1: The brain (required, do this first)
The goal of this phase is a brain the user could start using today.
1. **Whose system is this, and what do they do?** One or two questions. Enough to name the owner and
   their main lanes.
2. **The spheres.** The template ships `ventures / work / personal / infrastructure`. Confirm or
   rename them to fit the user's life (a student is not a founder; a freelancer is not an employee).
   Rename the sphere folders and rewrite each `CONTEXT.md` opening line to match. Delete a sphere
   they do not need; add one they do. Apply the shape only where populated.
3. **First real cards.** Ask for the two or three things actually on their plate right now (a project,
   a key person). Turn the `example-project.md` / `jane-doe.md` templates into those real cards.
   **Delete the leftover example files** once at least one real card exists in that folder.
4. **`now.md`.** From what they just told you, write a real `now.md`: the one or two hot things,
   ranked by life not by project. Delete the template scaffolding inside it.

At the end of Phase 1 the user has a working brain. Offer to stop here. Everything below is leverage.

## Phase 2: The soul (optional: do this when they want a consistent voice)
The goal is a `soul/core.md` that sounds like a specific someone.
1. Read `soul/README.md` aloud-in-summary so they understand what a persona layer is.
2. Interview for the character, not the rules. Good questions, asked one at a time:
   - What should the assistant's default register be? (dry, warm, blunt, playful, formal)
   - Should it lead with its opinion or wait to be asked? Push back when you are wrong, or defer?
   - How should it open a reply: react first, or get straight to the work?
   - What would make it sound like a generic chatbot? (so we can ban those phrases)
   - Does it have a name? Whose assistant is it?
3. Write `soul/core.md` from the answers, in prose, character only. Keep rules out of it.
4. Note what they still need to wire themselves: the session-start hook that loads `core`, the
   session-end hook that writes `heartbeat`, the drift monitor. Point them at `soul/README.md`.

## Phase 3: The rules and the loops (optional, but the cheapest leverage here)
1. **Rules.** Walk `rules/OPERATING.md` with them. The miss-capture protocol is the one section to
   sell hard: it needs zero infrastructure and compounds from day one. Help them copy the document
   into their global config (`CLAUDE.md` or equivalent) and delete the example steering rules that
   are not theirs.
2. **Hooks.** Read `hooks/README.md` for the loop catalog. Ask which loops they want first (the
   honest default: session-start briefing + heartbeat, skip the rest until the voice exists). Copy
   the chosen reference hooks into their assistant config, wire them per
   `hooks/settings.example.json`, and run each once standalone with a fake payload to prove it
   exits clean. The reference hooks run on plain files; no database needed yet.
3. **Skills.** Copy `skills/defs/` into their skills directory. Adapt the paths the skills mention
   (handoff file location, index tool names) to what actually exists in their install; a skill that
   references infrastructure they skipped should have that step cut, not left to error.

## Phase 4: The agents (optional: leverage on top of a working system)
1. Ask whether they want the themed roster as-is or renamed. If renamed, do a find-and-replace pass
   over `agents/defs/` and the README.
2. Ask which functions they actually need (most people do not need chaos + load + red-team on day one).
   Prune the defs they will not use; keep the dispatch doctrine in the README.

## Phase 5: The index (optional: only when files outgrow grep-and-read)
1. Tell them plainly: this is the heaviest phase and they can defer it indefinitely. The brain works
   without it.
2. Walk `clocktower/README.md`. Help them produce a real `.env` from `.env.example` (their own
   database, their own embedding key, their own host). **Never invent or reuse anyone else's
   credentials.**
3. Point them at the schema and the watcher pattern. Standing up the actual database and watchers is
   their infrastructure to run; the interview hands them the map, not the keys.

---

## Closing
End the interview with a short checklist of what is done and what the user still owns (hooks to wire,
infra to stand up). Then get out of the way. The system is theirs now.
