# Depersonalization checklist

This template was extracted from a live private system. Before it left, it went through three
passes. If you are re-deriving this template from your own running system to hand to someone else,
run the same three. A miss here leaks your real life.

## Pass 1: Secrets
- [ ] No `.env`, no tokens, no API keys anywhere in the tree (grep for `TOKEN`, `SECRET`, `KEY`, `sk-`).
- [ ] No connection strings, no database URLs, no host IPs.
- [ ] No pointers to private repos that hold sensitive material (the soul repo, any
      family/health/finances repo). Names of those repos are themselves a leak.
- [ ] `.gitignore` covers local-only working dirs before the first commit.

## Pass 2: Data
- [ ] No real cards. Every person, org, project, client, and venture is removed or replaced with a
      clearly-fake example (`example-project.md`, `jane-doe.md`).
- [ ] No corpus references: no real email counts, no message logs, no transcript pointers.
- [ ] `now.md` is a template, not a live heartbeat.
- [ ] No commit history carrying the above (squash or start the giftable repo fresh).

## Pass 3: Identity
- [ ] The owner's name is genericized to a neutral placeholder.
- [ ] The assistant's persona is blanked. `soul/core.md` is a scaffold prompting the recipient to
      write their own, not the original character.
- [ ] Voice/convention rules that are personal preference (banned punctuation, tone) are marked
      optional, not presented as law.

## Verify
Do a final full-text sweep for the owner's name, the assistant's name, and any client names before
you publish or hand it over. The cheapest leak to catch is the one you grep for.
