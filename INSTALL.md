# Install (the interview)

This is not a script. It is a prompt. An agentic stack is installed by an agent.

**How to run it:** open this folder in a coding assistant with local file access (Claude Code is the reference setup) and say: *"Run the install interview in INSTALL.md against this repo."* The
assistant interviews you and writes your files. You answer questions; it does the typing.

**The first question, before anything else:** do you want the five-minute starter or the full
setup? The starter is the right answer for most people. Run it in `starter/README.md` and stop
there; come back here only when you outgrow it.

**The rules the assistant follows during the interview:**
- Ask **one question at a time.** Never dump the whole questionnaire. This is a conversation, not a form.
- Ask only what changes the output. Infer the rest and state what you inferred so the user can correct it.
- Write files as you go, show the user each one, move on. Do not wait until the end to produce everything.
- When a phase is optional, say so and let the user skip it. The brain layer alone is useful on day one.
- **No shell walls.** Every command the user must approve is one they have to judge, and most users
  cannot read a loop or a chain. Write and edit files with the file tools. When a shell command is
  unavoidable (renaming a folder, deleting one), run one short command at a time with paths relative
  to this folder, and say in plain words what it does before the approval appears. Never chain
  commands with `&&`, `;` or a loop, never `cd` first, never use `git mv` or `git rm`.

---

## Start here in five minutes (the starter tier)

If the user wants value now and nothing else, do not run the phases below. Run the starter in
`starter/README.md`: a root map file, three folders (`notes/`, `people/`, `projects/`), the memory
index, one topic per file, lowercase-hyphen names. It takes about five minutes and needs none of
the later layers. Everything from Phase 0 down is labelled **when you outgrow the starter**: it is
the full interview, and none of it is required to get value. If the user did the starter first,
the folders and the map already exist, so read them instead of recreating them, and skip the
pointer step if they already ran it.

## When you outgrow the starter: the full interview

The phases below are the full install. Phase 1 is its base; every phase after it is optional.

## Phase 0: Read the map
0. Check where this folder came from. If `AGENTS.md` starts with the line
   `<!-- lararium:contributor-file -->`, this is a copy made with "Use this template" or from a
   zip, and it still carries Lararium's own contributor files. Delete these before anything else:
   `AGENTS.md`, `SCRUB.md`, `CHANGELOG.md`, `npx/`, `tests/`, `docs/blog/`, `.github/`, and
   `agents/examples/` (keep that one only if the user wants the themed agent roster). Tell the
   user what you removed. If `AGENTS.md` is missing or does not start with that line (the `npx`
   route already left them out), skip this step.

Then, before any question, read `brain/CLAUDE.md` (the laws) and `README.md` (the six layers). Tell the
user, in two sentences, what they are about to set up. Then begin.

Memory is already switched on, and it is the point: this folder ships `.claude/settings.json`, which
registers two hooks. When a conversation opened here ends, `session-end-heartbeat.js` saves the last
few exchanges to `soul/heartbeat.md`; when the next one starts, `session-start.js` hands the assistant
that heartbeat plus `brain/now.md` (and `soul/core.md` once Phase 2 writes one). The hooks find this
folder on their own, so the user can move or rename it later without breaking anything. Tell the user
this in plain words: the brain you build in Phase 1 is what gets remembered. Do not offer memory as a
later or optional step, and do not rewrite `.claude/settings.json` unless the user asks.

## Phase 1: The brain (the base of the full interview, do this first)
The goal of this phase is a brain the user could start using today.
1. **Whose system is this, and what do they do?** One or two questions. Enough to name the owner and
   their main lanes.
2. **The spheres.** The template ships `ventures / work / personal / infrastructure`. Confirm or
   rename them to fit the user's life (a student is not a founder; a freelancer is not an employee).
   Rename the sphere folders (one plain `mv brain/spheres/old brain/spheres/new` per folder, per the
   no-shell-walls rule) and rewrite each `CONTEXT.md` opening line to match. Delete a sphere
   they do not need; add one they do. Update the sphere map and routing references in
   `brain/CLAUDE.md` to match the folders that actually remain. Apply the shape only where populated.
   If a required file operation is unavailable, name the unfinished step and do not claim Phase 1
   is complete.
3. **First real cards.** Ask for the two or three things actually on their plate right now (a project,
   a key person). Turn the `example-project.md` / `jane-doe.md` templates into those real cards.
   **Delete the leftover example files** once at least one real card exists in that folder.
4. **`now.md`.** From what they just told you, write a real `now.md`: the one or two hot things,
   ranked by life not by project. Delete the template scaffolding inside it.

At the end of Phase 1, verify the saved files and the memory before offering to stop:

1. Read back `brain/now.md` and one real card from disk. Summarize what they actually contain and let the user correct mistakes.
2. Tell the user exactly how deep the memory goes, in plain words. Every new conversation here opens
   knowing `now.md` and the last few exchanges of the previous conversation, and nothing older. The
   heartbeat is replaced each time. Anything worth keeping longer goes on a card or into `now.md`,
   and the assistant should offer to put it there. Do not claim that every conversation is saved.
3. Give them the test: exit this conversation (type `/exit`), open a new one in the same folder, and
   ask "What did we set up last time, and what am I focused on right now?" Pass: it answers from the
   heartbeat and `now.md` without being told which files to read.
4. If the new conversation does not know, the hooks did not run. The usual cause is declining the
   "trust this folder" question; open the folder again and accept it. Check before adding more layers.

Run `node hooks/memory-check.mjs .` from the template root for a read-only file diagnostic, and
offer the longer save, recall, and correction test in `docs/memory-check.md`.

### Point every agent at the same memory

Memory should not belong to one tool. If the user has Codex or Gemini CLI as well as Claude Code,
install the shared pointer block so each reads the same files. Ask which CLIs they use, then:

1. Ask whether they want it for this folder only or for every folder.
2. Run the read-only check for the scope they chose: `node hooks/memory-pointers.mjs . --project --check`
   for this folder only, or `node hooks/memory-pointers.mjs . --check` for every folder. It changes
   nothing and says which instruction files would be written. Exit code 1 means "would write"
   or "refused"; read the output before going on. Show the user, then run the same command without `--check`. For this folder only
   that writes `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` here, nothing outside. For every folder it
   writes to `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` and `~/.gemini/GEMINI.md`, for the CLIs
   that exist. The global form edits files outside this folder: say that in plain words and get a
   yes first.
3. The script puts a marked block at the end of each file, after any block another tool manages,
   and never twice: running it again says `unchanged`. It refuses, and tells the user, when a file
   has unbalanced markers or ends inside another tool's block. Do not edit around a refusal.
   It writes through a symlinked file and leaves the link in place, and refuses a symlink that
   points nowhere. It also refuses when our block overlaps, contains or sits inside another tool's
   block. `--project` covers this folder only. An existing `CLAUDE.md` keeps its text and gets the
   block appended; a new one starts with an import of `brain/CLAUDE.md`. It refuses inside a clone
   of the Lararium repository itself; make the user's own stack first.
4. Without `node`, do it by hand. First check that `AGENTS.md` does not start with
   `<!-- lararium:contributor-file -->` (if it does, Phase 0 step 0 was skipped: do it now). Then
   copy `memory/pointer-block.md`, replace `{{STACK_ROOT}}` with
   this folder's full path and `{{STACK_ROOT_SHELL}}` with the same path wrapped in single quotes,
   where every single quote inside the path is written as `'\''` (so `/home/it's/stack` becomes
   `'/home/it'\''s/stack'`), and append it to `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` (or the
   global files, for the every-folder scope). Check each file for an existing
   `lararium:shared-memory:start` marker first.
5. Test each CLI the user has, in a new session, with no hints: "In one line: where does my memory
   live and how do I search it?" It should name this folder's map and a grep. If it does not,
   tell the user which one failed and why you think so.

Offer to stop here. Everything below is optional. A browser-only chat can help draft content, but the user must save it themselves.

## Phase 2: The soul (optional: do this when they want a consistent voice)
The goal is a `soul/core.md` that sounds like a specific someone.
1. Read `soul/README.md` aloud-in-summary so they understand what a persona layer is.
2. **Ask the archetype question first.** Read the archetype list in `soul/character-craft.md` and
   ask which one fits: the concierge, the anticipator, the gatekeeper, the quartermaster, the ops
   sergeant, the partner-with-root. If they answer with a famous character's name, treat it as
   pointing at an archetype and build an original character on it (the craft doc explains why).
3. Interview for the character, not the rules. Good questions, asked one at a time:
   - What should the assistant's default register be? (dry, warm, blunt, playful, formal)
   - Should it lead with its opinion or wait to be asked? Push back when you are wrong, or defer?
   - How should it open a reply: react first, or get straight to the work?
   - What would make it sound like a generic chatbot? (so we can ban those phrases)
   - Does it have a name? Whose assistant is it?
4. Write `soul/core.md` from the answers using the dimensions in `soul/character-craft.md`: trait
   tensions, the register gap, the anti-list, and at least three tone proofs (sample responses to
   real scenarios from their life). The samples are the spec. Name the persona's failure mode.
5. Tell them the session-start hook already loads `core` from the next conversation on. What they
   still wire themselves is the drift monitor. Point them at `soul/README.md`.

## Phase 3: The rules and the loops (optional, but the cheapest leverage here)
1. **Rules.** Walk `rules/OPERATING.md` with them. The miss-capture protocol is the one section to
   sell hard: it needs zero infrastructure and compounds from day one. Help them copy the document
   into their global config (`CLAUDE.md` or equivalent) and delete the example steering rules that
   are not theirs.
2. **Hooks.** The two memory hooks are already running from `.claude/settings.json` (Phase 0). Add
   the others there too, with commands relative to `$CLAUDE_PROJECT_DIR` in the same shape, never an
   absolute path. `LARARIUM_ROOT` is only for a user who wants this stack's memory in conversations
   opened in other folders, which means copying the hooks into their global settings.
   Read `hooks/README.md` for the loop catalog. Ask which loops they want next (the
   honest default: the update checker; skip voice-drift until the voice exists). The update checker
   rides `SessionStart` like the briefing: add `node "$CLAUDE_PROJECT_DIR/hooks/reference/update-check.js"`
   as a second command in the existing `SessionStart` entry. It reads the `STACK_VERSION` in this
   folder on its own, so it needs no path. Its optional `stackUpdateCheck` block (toggle, upstream,
   see `hooks/settings.example.json`) is read from the user's global `~/.claude/settings.json`; skip
   it unless they want to switch the check off or re-point it at a fork.
   Run each new hook once standalone with a fake payload to prove it exits clean. The reference
   hooks run on plain files; no database needed yet.
3. **Skills.** Copy `skills/defs/` into their skills directory. Adapt the paths the skills mention
   (handoff file location, index tool names) to what actually exists in their install; a skill that
   references infrastructure they skipped should have that step cut, not left to error.

## Phase 4: The agents (optional: leverage on top of a working system)
Start with these three, and only if the user wants subagents at all. The default is one assistant in
one loop: it sees each skill's short description first and loads the full skill only when needed
(progressive disclosure), so a procedure belongs in a skill, not in another agent.
1. Offer the three plain defs in `agents/defs/`: `reviewer.md` (adversarial review, read-only),
   `researcher.md` (read-heavy questions, compact answers) and `verifier.md` (re-proves a
   deliverable against ground truth, read-only). Copy the ones they want into their assistant's agent
   config. The reviewer works best on a different model or CLI than the builder.
2. Add a subagent later only when a skill cannot do the job and one of the four cases in
   `agents/README.md` applies: context bloat that measurably hurts the loop, parallel work that
   wants fresh context, one agent picking the wrong tool or holding conflicting instructions, or a
   job that needs separate permissions. Do not copy an org chart.
3. Themed rosters are an opt-in example and are not in a default stack. They ship only when the
   stack was made with `npx lararium my-stack --with-examples` (they then live in
   `agents/examples/`), or can be browsed in the upstream repository. Mention them only if the
   user asks for a themed team.

## Phase 5: Share the memory with your other apps (optional: when more than one tool should read it)

Claude Code, Codex and Gemini CLI already read your folder (Phase 0 pointed them at it). This phase
is for the apps that cannot: Claude Desktop, the Claude app, ChatGPT. It runs a small local server
over the same files. There is no database. The files stay the memory; the server only lets other
tools search them, read them and add to them.

Order matters. Everything is local first. Public HTTPS is the last, optional step, and nothing in
this phase needs it unless they want a cloud app.

1. Tell them plainly what this is and that they can skip it. The server offers four tools:
   `search`, `read`, `list` and `remember`. `remember` writes one card in `memory/` plus its index
   line, exactly the format the hooks and `memory/README.md` use, so a fact saved from any app is
   a plain file every other agent reads. Check `node --version` is 18 or newer; if not, say so and
   stop here.
2. Start the server. It runs from the stack folder, serves `memory/`, and listens only on this
   machine. Run `npx lararium serve` (one short command; say what it does first). Leave it running:
   if the assistant cannot keep a process alive, ask the user to open a second terminal for it. On
   first start it creates two private tokens, a read token and a write token, in a file only the
   user can read, and prints where that file is. Never print the tokens into the chat or into any
   file in the stack. The server prints them only when the user asks: `npx lararium serve
   --print-tokens`.
3. Add it to each tool they use. Use stdio where the tool launches the server itself; no token and
   no network are involved.
   - **Claude Desktop:** open Settings, Developer, Edit Config. Add this to `mcpServers`, with the
     full path of their `memory/` folder, then quit and reopen the app:

     ```json
     "lararium-memory": {
       "command": "npx",
       "args": ["lararium", "serve", "--stdio", "--memory", "<full path to memory/>"]
     }
     ```

   - **Claude Code:** `claude mcp add lararium-memory -- npx lararium serve --stdio --memory <full path to memory/>`
   - **Codex:** `codex mcp add lararium-memory -- npx lararium serve --stdio --memory <full path to memory/>`

   Add `--read-only` after `--stdio` for any tool that should search but never write. Offer these
   one at a time and only for tools the user actually has.
4. Prove a round trip before going further. In one tool, ask it to remember a harmless fact ("save
   that my test fact is blue kayaks, use the remember tool"). Open `memory/` and read the new card
   back from disk, and confirm its line is at the top of `memory/MEMORY.md`. Then, in a different
   tool, ask "what do you remember about blue kayaks". It should answer from the card. If the second
   tool is Codex or another file-reading agent, no server is needed for that half: it reads the file.
   If either half fails, say so plainly and fix it before offering anything else. Delete the test
   card afterwards if the user does not want it kept.
5. Optional: search by meaning. Plain full-text search is the default and works without anything
   installed. If they want matches by meaning ("pricing" finding a card about "rates"), a local
   EmbeddingGemma 2 can rank cards too. It runs on their machine; nothing is sent anywhere.
   Install Ollama from ollama.com, then run `ollama pull embeddinggemma-2:270m` (a few hundred MB;
   use that exact tag, the untagged name is a different build that needs extra runtime support).
   If the pull answers "requires a newer version of Ollama", update Ollama and pull again; an older
   install cannot load this model.
   Restart the server with `--semantic`. If the model is missing or stops, search quietly falls
   back to full-text and says so in its answer. The server stores which model built the vectors and
   refuses to mix models; to switch, restart once with `--reindex`. The llama.cpp route is
   `--embed-backend llamacpp` against a `llama-server` serving `ggml-org/embeddinggemma-2-GGUF:BF16`
   with `--embeddings` (the server expects it on port 8080 unless `--embed-url` says otherwise).
6. Optional, last: reach it from a cloud app (the Claude app on the web or phone, ChatGPT). Those
   apps connect from the internet, so the server needs a public HTTPS address. Explain the cost of
   saying yes: anything that has the write token can add to their memory, and the tokens are the
   only lock. Then offer one of two tunnels, whichever they already use:
   - **Tailscale Funnel:** `tailscale funnel --bg 8787`. It prints an `https://` address on the
     user's own tailnet domain. Needs Tailscale installed, Funnel enabled for the tailnet in its
     admin console, and the tailnet's HTTPS certificates switched on.
   - **Cloudflare Tunnel:** `cloudflared tunnel --url http://127.0.0.1:8787` prints a temporary
     `https://` address for a quick test; a named tunnel on their own domain keeps the address
     stable. Cloudflare's tunnel docs walk the named setup.

   Restart the server with that address: `npx lararium serve --public-url https://<their address>`.
   The server refuses requests with no token or a wrong one (401), and the read token cannot call
   `remember`. Then walk the app step below. Give each app the token tier it needs: the write token
   if it should save facts, the read token if it should only look.
7. Keep the tokens private. They live in the file step 2 named. If one leaks, run `npx lararium serve
   --rotate-tokens`, which signs every connected app out, and reconnect the ones they still use. If
   the memory folder holds anything they would not post publicly, keep the server on this machine
   and skip step 6.
8. Only when plain files and this server stop being enough (very large folders, many writers at
   once), the optional database index is described in `clocktower/README.md`. Do not set it up unless
   they ask; Phase 5 is complete without it.

### Where it is right now (checked 2026-10-28)

Cloud-app setup moves faster than this file. These are the facts as of the date above, with where
they came from. If a screen does not match, trust the app's own current help over this box and tell
the user what differs.

- **Claude app (claude.ai, desktop and phone):** add a custom connector under Settings, Connectors,
  using the `https://<address>/mcp` URL. Anthropic's connector authentication page lists three
  ways in: OAuth, a static credential (an organization Owner enters a bearer token once; documented
  as a beta for a limited set of organizations), or none. This server supports the first two: it
  answers the OAuth sign-in (the consent page asks for the read or write token and grants that tier),
  and it also accepts the token as a plain bearer header for organizations that have the static
  option. Sources: https://claude.com/docs/connectors/building/authentication and
  https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- **Claude Desktop, local server:** supported, and it is the stdio route in step 3. Source:
  https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
- **ChatGPT:** add the `https://<address>/mcp` URL as a custom connector (developer mode, in
  ChatGPT's settings; availability depends on plan and workspace). OpenAI's documented options are
  OAuth or no authentication. There is no static-bearer option, so the OAuth sign-in above is the
  only way in, and this server never offers an unauthenticated mode. Source:
  https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
- **ChatGPT desktop, local server:** not confirmed. OpenAI documents remote connectors; a public
  bug report shows a desktop app discovering a local server's tools without exposing them to
  chat. Do not promise it. Use step 6. Source: https://github.com/openai/codex/issues/38162

When an app asks you to sign in, check the address shown on the consent page is the app you are
connecting before you paste a token.

## Phase 6: The operating shape (optional: when instructions or builds outgrow a flat file)
Offer only what hurts today, one at a time, and skip the rest.
1. **Governance.** Their instruction file keeps growing or agents skip rules: walk
   `governance/README.md`. Write their own constitution from `governance/constitution.template.md`:
   it ships as examples, so keep an entry only if it is true of them, and cap it at five.
2. **Workspaces.** A project keeps coming up: `workspaces/README.md`. Create a workspace only for
   one that has earned it. Never scaffold folders in advance.
3. **Forge.** They hand builds to agents: `forge/README.md` and `forge/CONSTITUTION.md`.
4. **Ops guards.** Their machine fills its disk or holds unpushed work: `docs/ops-guards.md`.
   Doctrine only; offer to write the scripts with them.

---

## Closing
As your **last act**, confirm `STACK_VERSION` is at the root of the user's stack, unchanged. It is a
one-line file naming the template version they just installed from, and the scaffolder and the
template both ship it already. It is what the upgrade interview and the update checker read to know
which changelog deltas apply, so a stack without it reads as v1: if it is missing, copy it from the
template. Then end the interview with a short checklist of what is done and what the
user still owns (optional hooks, infra to stand up), and get out of the way. The system is theirs now.
