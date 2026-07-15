# The patrol (the Judge's second trigger)

The Judge (`agents/defs/harvey.md`) has two triggers, one capability:

- **Gate:** synchronous. A sub-agent returns a deliverable; dispatch Harvey on it *before* you
  trust, merge, or act on it. This is just a dispatch; no machinery needed.
- **Patrol:** ambient. A daily scheduled sweep over everything *already claimed done* (your
  heartbeat file's ship-claims, recently completed tasks), re-proving claims against ground truth
  and flagging "this says done, the receipt says otherwise."

`patrol.sh` in this directory is the patrol, extracted from a running system. It is a template,
not a drop-in: the `ADAPT:` lines mark every seam where it touches that system's plumbing (task
store, review queue, freshness table). Adapt them to yours before scheduling it.

## The four disciplines the script encodes (keep these even if you rewrite everything else)

1. **Salience gate, or it dies.** An always-on "actually, that's not done" agent that cries wolf
   gets muted, and a muted monitor is worse than none. Max 3 findings per run, receipt-backed
   only; a claim that merely *could not be checked* stays in the report and never files. Zero
   findings is a valid night.
2. **Findings go to a persistent queue, never a chat ping.** A push notification is a scroll;
   backlog dies at the bottom of it. File findings where they hold state until acted on.
3. **Dedupe against the queue itself.** The run reads its own open findings first and never
   re-files one. No shadow state file to drift.
4. **Heartbeat on every successful run, including "found nothing", and an off-switch that stamps
   itself as intentional.** "Ran, found nothing" must be distinguishable from "dead", and
   "deliberately off" must not page as death.

## Scheduling

Daily, early, before your morning review surface compiles, so findings are sitting in the queue
when you look. macOS: launchd plist calling the script. Linux: cron/systemd timer. Headless
assistant runs under a scheduler have no interactive login; the script pulls an API key from your
env file and fails loud if missing, never silently no-ops.
