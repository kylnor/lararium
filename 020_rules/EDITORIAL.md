# Editorial constitution (template)

The numbered law for every surface where your assistant synthesizes prose from your data:
knowledge cards, diaries, morning reports, digests, briefings, audit reports. One versioned
document; every synthesis prompt cites it at its head ("Editorial Constitution v1"); a
reviewer or auditor flags violations by rule number. Drift stops being a vibe and becomes
"this output violates E3."

Why a constitution instead of better prompts: a system grows synthesis surfaces faster than
you can tune them, and the same drift (inflation, padding, summarizing summaries) reappears
in each new prompt. Numbered rules in one home make the fix propagate: patch the rule, bump
the version, every citing prompt inherits. The changelog becomes a record of real failure
modes caught and encoded, which is the same compounding move as the miss-capture protocol,
pointed at generated prose.

Customize the rules to your taste. These ten are proven defaults; the numbering scheme and
the citation discipline are the part to keep.

## The rules (v1 defaults)

- **E1. Receipts or silence.** Every factual claim traces to a source (a row, file,
  message, transcript, commit). A claim that cannot be traced is labeled an inference
  or cut.
- **E2. No synthesis of synthesis.** Briefings, digests, audit reports, and other
  generated summaries are excluded from synthesis INPUT. Summarizing your own summaries
  compounds drift. Point at them; never re-digest them.
- **E3. Anti-inflation.** One source item produces at most one output line. A single task,
  reminder, or note is never promoted to a "theme," a "pattern," or an abstraction.
- **E4. Themes need three.** A claimed pattern requires at least 3 independent sources
  converging. Fewer than 3 = report the items individually.
- **E5. Empty is correct.** Every section is optional. A quiet week produces a short
  report. Never pad to fill a template; "no change" is a complete answer.
- **E6. Surface contradictions, never resolve them silently.** When sources conflict, show
  both with their receipts and name the tension. Superseding is an explicit, dated act.
- **E7. Epistemic labels.** Conclusions carry their status: firm finding (receipts),
  inference (reasoned, marked as such), or open question. Facts and inferences never share
  a voice. No false-precision scores on advisory output.
- **E8. Voice floors.** Whatever writing tells you have banned (banned words, banned
  punctuation, banned openers) apply to every synthesis surface, not just chat. Persona
  register where the surface carries your assistant's voice; neutral register where it
  does not.
- **E9. Scope honesty.** A bounded scan states its bounds ("3 of 12 inboxes", "first 2000
  rows"), never a global claim from a sample. Unscanned areas are named, not omitted.
- **E10. Fix the law, not the symptom.** Recurring drift gets a rule here (version bump +
  changelog line), and prompts inherit. A drift fixed in one prompt reappears in the next
  surface.

## Wiring it

1. Keep this file versioned in your stack (this folder is its home).
2. Every synthesis prompt cites the version at its head and the 3-4 rules that bite
   hardest for that surface.
3. When a reviewer, auditor, or you catch drift, name the rule number. If no rule covers
   it, that is an E10 event: write the rule, bump the version.
4. Optional but compounding: a scheduled auditor that samples recent synthesis output and
   files violations by rule number (the gate-before-patrol law from OPERATING.md applies:
   schedule the auditor with the producers, or don't trust the pile).

## Changelog

- v1: initial ten rules. Provenance: distilled from a working private system's standing
  law plus the editorial-policy pattern in Nate B. Jones's OB1 (anti-inflation,
  themes-need-three, surface-don't-resolve).
