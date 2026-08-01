# AGENTS.md

Instructions for coding agents working in this repository.

## What this repo is

Lararium is a clone-and-run TEMPLATE for a personal agentic system. It ships empty on purpose:
structure, conventions, and doctrine, none of the original owner's data. Most agents reading this
file are here for one of two jobs, and they need opposite instincts:

1. **Installing it for a user** ("run the install interview"): follow `INSTALL.md`. Interview the
   user one question at a time and write THEIR files. Never invent a persona or fill spheres with
   placeholder content; empty is the shipped state, not a defect to fix.
2. **Contributing to the template itself**: everything below applies.

## Ground rules

- **No em-dashes or en-dashes in any prose file.** Hard house rule across the repo (docs, blog,
  skills, agent definitions). Use commas, colons, or periods.
- **Nothing personal ever enters this repo.** No real names, hostnames, absolute home paths,
  credentials, or the original owner's data. Before any commit that adds content, run the
  three-pass scrub in `SCRUB.md` (secrets, data, identity) and grep your additions for them.
- **The template stays empty.** Example content goes in doctrine files as fenced illustrations,
  never as pre-populated brain/soul/sphere files.
- **Docs are the product.** This repo is mostly markdown; treat doc edits with code-review care.
  Match the register of the file you are editing (the blog is literate and spare, the doctrine
  files are dry and structural).

## Release ritual (every version bump, same commit series)

1. Bump `STACK_VERSION` (format `vN.N`).
2. Add the matching entry to `CHANGELOG.md` (`## vN.N (YYYY-MM-DD): additive-doc | structural`).
   CI cuts the GitHub release from this entry when `STACK_VERSION` changes on main; a bump
   without a changelog entry fails the release workflow on purpose.
3. Write `docs/blog/dispatch-NN-<slug>.md` (tone template: `dispatch-01-the-lab.md`).
4. The site renders from this repo (`elorati-landing/lararium/blog/build.mjs` in the private
   site repo reads `docs/blog/`); if you cannot run it, say so rather than skipping silently.

## Verification

- `node --check` any `.mjs` you touch (`skills/defs/*/`, `npx/`).
- Runnable pieces keep zero dependencies unless their SKILL.md says otherwise; do not add
  packages to solve a string problem.
- Grep-verify the em-dash rule on changed files before committing: `grep -n "—\|–" <files>`
  must return nothing.
