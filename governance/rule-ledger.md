# Rule ledger

The evidence behind the rules. The always-loaded file carries one line per rule and an id; the
story lives here, so it is paid for only when someone looks it up.

## Entry shape

```
## rule-id
- rule: the instruction, as written in the always-loaded file
- governs: the system or habit it is about
- born: date, and the incident in one or two lines
- expires: date (default one year out)
- renewals: date, and the one instance where it changed an outcome
- exit: none yet | demoted to <file> | gated by <gate in gates.md> | buried
```

## Entries

Empty. Add an entry in the same commit that adds the rule.

## Example (fenced, invented)

```
## confirm-before-delete
- rule: Name the exact files before deleting anything, then wait for a yes.
- governs: file cleanup
- born: 2026-03-02, an agent removed a folder of drafts while "tidying" a build directory.
- expires: 2027-03-02
- renewals: none yet
- exit: none yet
```
