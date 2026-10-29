# The eviction rule

Edit this until it is true of you. The numbers below (900 tokens, five entries, one year) are
starting points, not laws.

## Why

Rules enter the always-loaded file whenever something goes wrong. There is no step in that loop
where a rule leaves. The file grows until the agent stops weighting it, and then every rule in
it is weaker, including the ones that matter.

## 1. The default is inverted

A rule persists unless someone kills it. Killing takes initiative and initiative loses to
inertia. So invert it: **a rule dies unless someone renews it.** Renewal is the action that costs
effort. Deletion is what happens when nobody acts.

Three things trigger a rule's death, in order of usefulness:

- **Budget breach.** The always-loaded file has a cap. When a new rule wants in and the file is
  at the cap, something has to lose. This needs no calendar and does most of the work.
- **Subject retirement.** Tag each rule with what it governs. When that system is retired, bury
  every rule tagged to it in the same commit.
- **Calendar.** A one-year term as a backstop for quiet stretches. Shorter terms create a review
  queue, and a standing queue gets rubber-stamped.

A rule with no expiry date and no `governs` tag is not a rule yet.

## 2. Three exits, only one is deletion

- **Demote.** Still true but rarely needed. Move it to a reference file that loads when the work
  touches it. Keeps the knowledge, returns the tokens. Procedures usually take this exit.
- **Gate.** A machine can enforce it: a hook, a lint rule, a permission entry, a CI check. Then
  **delete the prose.** A gate plus a vow is a vow with extra steps. Prohibitions ("never do X")
  usually take this exit, because a prohibition is a pattern match.
- **Bury.** No longer true, or never fired. Move it to `graveyard.md`. Nothing loads that file;
  it exists so the history stays readable.

Straight deletion with no record is only for rules that were never acted on.

## 3. Sacred rules split in two

Some rules are not mistakes when broken, they are damage: a credential committed to a repo, a
fabricated number in published copy. Sacred does not mean exempt from this process.

- **Gated law:** sacred and mechanizable. Most sacred rules are `never do X`, the easiest shape
  to gate. They get a gate, then the prose goes.
- **Constitution:** sacred and ungatable. The failure lives in generated prose, not in a tool
  call, so no hook can intercept it. These stay in the always-loaded file for good.

A gate counts only once it is **proven and registered**: you watched it reject a known-bad
input, and it is listed in `gates.md` with the command that re-proves it. A gate that was
installed but never fired is worse than the vow it replaced, because it deletes the sentence and
the enforcement in one move while looking like progress. (Typical way this happens: a pre-commit
hook that git is not configured to run. See `gates.md`.)

The constitution is **capped at five entries**, counted, not budgeted. A sixth means evicting one.
An uncapped sacred tier is just the old file with a better name.

## 4. The renewal test

To renew a rule at expiry, name **one specific instance in the expiring window where this rule
changed an outcome**: a commit, a conversation, a miss it prevented, a ledger entry. "It still
seems right" does not count. No instance means the rule did not fire, and an unfired rule is
unnecessary or unenforced. Both point to the same exit: demote it.

## 5. The budget is the forcing function

Renewal gets rubber-stamped when it is free, so give the always-loaded file a hard cap. Pick a
token count, measure it with a script (four characters per token is close enough), and have the
check fail a commit that goes over. Under a cap, adding rule N+1 means choosing which rule to
evict, and triage stops being optional.

## 6. Evidence never lives next to the instruction

Provenance (the date, the incident, the quote) is worth keeping and is several times longer than
the instruction it justifies. Keep the instruction in the always-loaded file, one line, with a
rule id. Keep the story in `rule-ledger.md` under that id.

## What this does not solve

- Reference files can rot too. Demotion moves weight, it does not delete it.
- The renewal test relies on recall. It is a forcing question, not a measurement.
- Expiry dates are a guess. If good rules start dying, the term is wrong, not the mechanism.
