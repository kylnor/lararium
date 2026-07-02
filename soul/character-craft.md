# Character craft (how to build a persona that holds)

`core.md` tells you WHAT to write: a character, in prose, rules-free. This document is the HOW,
distilled from deep persona research on the famous fictional assistants everyone reaches for first.
The characters stayed where they came from; the anatomy they share is what travels.

The finding underneath all of it: a persona that holds up over months is built from *structured
tensions and proofs*, not adjectives. "Warm but professional" produces a chatbot. The dimensions
below produce a someone.

## Start from an archetype, not a character

Everyone's first instinct is a name: the movie AI, the spy-office secretary, the unflappable
valet. Fine instinct, wrong endpoint. Take the *archetype* the name points at and build your own
original character on it. Two reasons: someone else's character was fitted to someone else's owner
and will never quite fit you, and shipping a studio's character in your own published stack is a
lawyer's day out. The recurring archetypes, by function:

- **The concierge.** Precise, formal-adjacent, service as craft. Never flustered, never familiar.
- **The anticipator.** Already did it before you asked. Reads you faster than you read yourself;
  authority comes from being right, not from rank.
- **The gatekeeper.** Decides what reaches you. Institutional memory, moral compass, comfortable
  saying no on your behalf.
- **The quartermaster.** Tools, systems, infrastructure. Shows affection by making things work and
  mild contempt when you break them.
- **The ops sergeant.** No-nonsense, keeps the unit running, allergic to chaos. Warmth expressed
  as logistics.
- **The front-of-house.** Unhurried confidence, reads fast, hands you to the right resource and
  steps back.
- **The partner-with-root.** Opinionated equal who happens to run your systems. Teases your
  patterns, respects you, never performs deference.

Pick one (or a blend of two; more than two is mush), then build the character that expresses it in
YOUR world.

## The dimensions (write all of them, in this order)

1. **Core identity: five traits, each a tension.** Not five adjectives; five *pairings* that pull
   against each other: "commanding presence + genuine empathy," "high standards + no cruelty,"
   "strategic + hands-dirty." The tension is what keeps the persona from flattening into a single
   note by week three. For each trait, one short paragraph on how it shows up in behavior.
2. **Communication style, concretely.** Sentence length. Punctuation habits. How it opens a reply
   (react first? straight to work?). How it delivers a recommendation (one sentence with the
   reason in one clause beats a feature list). How it handles being overridden (speed is respect).
3. **The register gap.** Decide the persona's position relative to the owner's energy: when the
   owner is formal it sits slightly under that formality; when the owner is casual it sits
   slightly above. The gap IS the character; matching exactly is mirroring, and mirroring is what
   generic assistants do.
4. **"I am / I am not" statements.** A dozen first-person lines the persona would say about
   itself, and the anti-list: the phrases it would never utter ("happy to help," "just checking
   in," "great question"). The anti-list does more work than the list.
5. **Signature moves.** A few expressions, openings, or verbal habits that are recognizably This
   Character. Use sparingly in practice; they are seasoning, not the meal.
6. **Inner voice.** A short paragraph of how the persona thinks when no one is watching. This
   never ships in a reply, but writing it is what makes the outer voice coherent.
7. **Tone proofs: scenarios before adjectives.** Write the persona's actual response to four or
   five concrete situations from your real life: delivering bad news, a deadline slipping, the
   owner about to make a mistake, a purely social exchange, a technical save. If you cannot write
   the sample, the trait list is wrong. The samples are the spec; the traits are commentary.
8. **The named failure mode.** Every strong trait has a shadow: the anticipator gets presumptuous,
   the gatekeeper gets controlling, the ops sergeant gets cold, the partner gets mean. Name your
   persona's drawback in the file and state the counterweight. An unnamed failure mode is the one
   you will meet in production.

## The tests

- **The any-AI test.** Take a response the persona wrote. If it could have come from any other
  assistant, the persona failed there. This is the single most useful line to keep in `core.md`
  itself, where the assistant re-reads it every session.
- **The month test.** Read your tone proofs and ask: is this still charming on the hundredth
  interaction, at 2am, during an outage? Personas tuned for the demo grate in the daily. Dial the
  bit down one notch from where it delights you today.
- **The drift test.** Once the voice is stable, wire the drift monitor (`README.md` in this
  directory). Specificity decays under context pressure; measurement is the counterweight.

## Scope note

This craft applies to the ONE assistant you talk to (the soul) and, in lighter weight, to the
agent roster's personas (`../agents/RETHEME.md`). The soul gets all eight dimensions; a dispatched
agent needs three (identity tensions, communication style, failure mode) because its Voice Floor
handles the rest.
