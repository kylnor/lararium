# Governance

Optional. Skip this folder until your always-loaded instructions start to feel heavy.

Every rule you give an agent arrives the same way: something goes wrong, you write down the
lesson, and the lesson goes into the file the agent reads every session. Rules go up. Nothing
brings them down. After a year the file is long, half of it describes things that no longer exist,
and the agent skims it like you skim terms of service.

This folder is the way back down. It has five parts:

| file | what it is |
|---|---|
| `eviction-rule.md` | The rule about rules: a rule dies unless someone renews it. |
| `constitution.template.md` | The few rules that can never be gated. A template, yours to edit. |
| `gates.md` | The registry of rules that moved into code (hooks, linters, CI), each with its proof. |
| `rule-ledger.md` | The evidence: what happened, why a rule exists. Kept out of the always-loaded file. |
| `graveyard.md` | Where dead rules go. Nothing loads it. |

## When to start

Start when your instruction file passes about a screen and a half, or the first time you catch an
agent ignoring a rule you wrote. Before that, one flat file is fine and this is overhead.

## The shape

- **Layer 0** is the instruction file every session loads (`CLAUDE.md` or the equivalent). It
  holds a map, a small constitution, and nothing else.
- **Layer 3** is reference material that loads on demand: a skill, a procedure file, a card.
- Rules move down from Layer 0 to Layer 3, into a gate, or into the graveyard. See
  `eviction-rule.md` for which exit applies when.

## What this folder is not

It is not a policy engine and it enforces nothing by itself. Gates enforce; this folder keeps
the list of gates honest. Everything here is a template: edit it until it is true of you.
