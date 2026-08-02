# Re-theming the roster (the interview)

Not everyone wants to be Batman. The roster ships themed because a themed team is easier to hold
in your head than twelve job titles, but the theme is *flavor*, and flavor should be yours. This
document is a prompt, like the install: open your repo in your assistant and say *"run the
re-theming interview in RETHEME.md."* The assistant interviews you for a mythology and rebuilds
the roster in it. Doctrine kept, personas rewritten.

Do not do this with find-and-replace. Renaming `nightwing.md` to `steve.md` gives you Nightwing's
exact personality wearing a name tag. A re-theme regenerates the character; that is the point.

## What is theme and what is machinery

Every def in `defs/` has the same two halves. The interview rewrites one and must not touch the
other.

**Machinery (keep verbatim):**
- Frontmatter `model`, `permissionMode`, `tools`. These are engineering decisions, not flavor.
- The operating doctrine: every "How You Operate" section, role-specific protocols (pre-push
  validation, secrets scan, threat-model structure), the Parallelization block, the Index
  Integration block.
- The Voice Floor block (it is persona-neutral on purpose), on the agents that have one. The
  agents shipped *without* a Voice Floor are intentional; do not add it to their successors.

**Theme (rewrite entirely):**
- The filename and frontmatter `name`.
- The persona prose: who this character is, why their history makes them fit this function.
- The "Your Opinions" section: the cross-agent relationships, remapped to the new cast. These
  matter more than they look; a team that has opinions about each other reads as a team.
- The "Closing Register" examples: final-line samples in the new character's voice.
- The flavor tail of the frontmatter `description` (keep the functional first sentence; it is
  what dispatch matches on).

## The interview

1. **Pick the mythology.** One question, their answer decides everything: a heist crew, a Greek
   pantheon, a ship's bridge, a kitchen brigade, the owner's favorite ensemble cast, or **no theme
   at all** (plain functional names: `builder`, `reviewer`, `researcher`). Plain is a legitimate
   answer; some people want a toolbox, not a table read. If they pick a copyrighted universe for
   private use, fine; note that a *published* derivative of their stack should probably not ship
   someone else's characters.
2. **Map functions to characters.** Read `README.md`'s roster-by-function list. For each function
   the owner kept, ask or propose: who in the new mythology is the fast builder? The meticulous
   reviewer? The chaos agent? Propose the full mapping yourself first and let them correct it;
   correcting a table is faster than composing one. Personality fit matters more than fame: the
   reviewer needs a character whose *nature* is exacting, or the persona prose will fight the
   doctrine.
3. **Check the pair-bonds.** Some agents work as couples (the gather/gate memory pair, the
   build/review loop). Map pairs to characters with an actual relationship in the source
   mythology; the "Your Opinions" sections write themselves when the canon already has history.
4. **Regenerate, one def at a time.** For each def: new filename, new frontmatter name, persona
   prose written fresh for the new character (their history justifying this function), remapped
   Opinions, new Closing Register lines. Machinery copied through untouched. Show the owner the
   first one and get a tone check before doing the remaining ones.
5. **Propagate the names.** Update the roster list and validated-loops examples in `README.md`,
   the workflow chains in `defs/README.md`, and any skills or hooks that dispatch agents by name
   (grep the whole repo for the old names; a dispatch to a deleted agent fails at the worst time).
6. **Delete the old defs.** Two rosters answering the same functions is how dispatch gets weird.

## Closing

End with the new roster table (function, name, one-line character) and remind the owner of the
one law that survives every theme: the roster is functional coverage first. If a re-theme loses a
function because the mythology ran out of characters, the mythology loses, not the function.
