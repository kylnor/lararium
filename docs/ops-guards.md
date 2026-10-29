# Ops guards

Optional doctrine, no code shipped. Two failures that agent-heavy machines hit sooner than most,
and the shape of the guard for each. Write the scripts yourself, in whatever language you trust,
and register them in `governance/gates.md` once you have watched them fire.

## 1. The disk-full watchdog

**The failure.** Agents write logs, caches, build output and transcripts all day. A full disk
does not announce itself: tools fail in odd ways, a write that "succeeded" leaves an empty file,
and a restore step that copies over a good file with a blank one is worse than no restore.

**The guard.**

- A timer (cron or a systemd user timer) checks free space on the disks that matter every few
  minutes. Warn at about 15 percent free, alert loudly at 5.
- When it alerts, it names the five largest directories under the usual suspects (build caches,
  logs, scratch, package caches) so the response is a decision and not a hunt.
- It never deletes anything itself. Cleanup that runs unattended eventually deletes something
  you wanted.
- Make any backup-and-restore pair atomic: write to a temporary file, check it, then rename into
  place. A restore that can run on a full disk must not truncate the target first.

**Prove it.** Point the check at a tiny test filesystem or lower the threshold temporarily and
see the alert arrive where you will actually read it.

## 2. The unpushed-work exposure report

**The failure.** Work that exists in one place only. Agents commit to branches, branches stay
local, a disk dies or a folder is cleaned, and the work goes with it. The same goes for edits
nobody committed.

**The guard.** A daily report over every git repository you work in, listing, per repo:

- uncommitted changes (modified and untracked files, counted)
- branches with commits that no remote has (`git log --branches --not --remotes`)
- stashes
- worktrees that hold either of the above

Print one line per repo that has exposure and nothing for repos that are clean, so the report is
short enough to read. Deliver it where you will see it (a file your session-start hook reads is a
good start). The report only reads; pushing stays your decision.

**Prove it.** Make a throwaway repo with one unpushed commit, run the report and confirm it
names that repo and no other.
