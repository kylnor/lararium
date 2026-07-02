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

## The two surfaces that leak hardest

- **Hooks.** Production hooks are soaked in your infrastructure: database hosts, table names,
  persona injection, project slugs. Never scrub production hook code for sharing; write minimal
  clean-room reference implementations instead (see `hooks/reference/`). Smaller surface, nothing
  to miss.
- **Skills.** A skill is a prompt, and prompts absorb your life: client names, absolute paths,
  dollar amounts, tool tokens. Every skill gets all three passes before it ships. Cut a
  personal step entirely rather than genericizing it awkwardly.

## Verify
Do a final full-text sweep for the owner's name, the assistant's name, and any client names before
you publish or hand it over. The cheapest leak to catch is the one you grep for.

## Going public (a higher bar than gifting)

Handing a scrubbed repo to a trusted peer tolerates seams; publishing does not. Before flipping a
template repo public:
- [ ] Re-run all three passes on the *current* tree, not the tree as you remember it.
- [ ] Have a second reviewer (a dispatched adversarial agent counts) sweep specifically for identity
      seams: paths containing usernames, example values that are real values, "generic" names that
      are actually your clients'.
- [ ] Check the commit history, issue text, and repo description, not just the files.
- [ ] A license file. Public without a license is not shareable, it is just visible.
