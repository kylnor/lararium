# Soul

Your assistant is not a prompt. It is assembled each session from layered sections, then monitored
for drift. This directory is the scaffold for that. It ships **blank**: the structure and the loops,
not anyone's character. You write the character.

## The layers (in order)
1. **`core`**: the voice and character. Prose, intentionally rules-free. This is the part that makes
   the assistant sound like a specific someone instead of a generic chatbot. Loaded first, every
   session. Start from `core.md` in this directory.
2. **Operating rules**: a separate document (kept with your assistant's config, e.g. a `CLAUDE.md`):
   action bias, steering rules, production standards, dispatch defaults. Character on top, rules
   underneath, loaded together.
3. **The other sections**: `identity`, `user`, `rules`, `memory`, `heartbeat`, `polaris`. Loaded at
   session start or lazily on demand.

## Files canonical, database as serving index
The pattern that keeps this durable and safe:
- The seven sections live as **files in a private repo** (they hold personal material; keep that repo
  private, no collaborators).
- A small sync script pushes edited files into a `soul` table the session-start hook reads. Change
  aware, so a no-op round-trip writes nothing.
- An export script pulls the other way to re-baseline.
- **`heartbeat` is the exception: database-canonical.** The session-end hook writes it server-side
  every session, so it flows DB to file (export only). Sync skips it or a stale file clobbers the
  live heartbeat.
- Durability: file + private repo + live database. Three copies.

## The loops (what makes it feel alive)
- **Heartbeat (writable memory).** A Stop hook summarizes each session (3+ exchanges) into the
  assistant's own voice and upserts it to `soul.heartbeat`. Next session's briefing reads what just
  happened. That is the loop that lets it remember yesterday.
- **Voice-drift monitoring.** The Stop hook logs every response. A nightly job samples a handful,
  scores whether the assistant still sounds like itself, and writes a drift alert if the average
  drops. Cheap insurance against the persona eroding over time.
- **Adversarial probe suite.** A set of prompts you run before any change to `core`, to confirm the
  voice survives the edit.

## To make it yours
1. Open `core.md` and write your assistant's character. Be specific; specificity is the whole game.
2. Stub the other six sections with your own facts.
3. Wire the session-start hook to load `core` first, and the session-end hook to write `heartbeat`.
4. Stand up the drift monitor once the voice is stable.

## Extraction note (if you are re-deriving this from a live system)
Copy the *structure and the hook logic*. **Never** copy the original `core` (that is a specific
person's assistant) or any populated section (those hold private facts). The scaffold travels; the
character does not.
