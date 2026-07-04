---
title: "The Skills, and Slash Commands for a Life"
slug: the-skills-and-the-slash-commands
order: 6
description: A skill is a reusable prompt that becomes a command. The lifecycle loop that keeps nothing lost between one conversation and the next.
status: draft
---

# The Skills, and Slash Commands for a Life

You have typed the same multi-step instruction to your assistant three times this week. End this cleanly: write down where we are, save the state, commit what changed. You type it out longhand every time, slightly differently, and sometimes you forget a step. That repeated instruction is not a chore to tolerate. It is a skill waiting to be named.

A skill is a reusable prompt that becomes a slash command. In the reference setup it is a single markdown file: frontmatter that carries a name and a description, and a body that is the instruction set the assistant follows when the skill fires. Type `/end` and the assistant runs the end skill as a prompt. That is the entire mechanism. There is no framework, no plugin API. It is a prompt you saved, given a name.

## The description does double duty

The frontmatter description is not documentation. It names the command, and it is also the auto-trigger heuristic. When the assistant sees a request that matches the phrasing in the description, it can fire the skill without you typing the slash command at all. Say "wrap up for the night" and the end skill can trigger on its own, if its description lists that phrase.

So you write descriptions that name the real trigger phrases, the exact words you would actually say, not a tidy summary. The summary reads better and triggers worse. The list of phrases is what the matcher matches against, and a skill that never auto-triggers is a skill you have to remember to invoke, which is most of the value gone.

## The lifecycle loop this set implements

The skills Lararium ships wrap the working memory of a session so nothing is lost between one conversation and the next.

- **`/end`** is session shutdown. It writes a status file, ends the session in your index with a summary, captures the durable knowledge from the session, rates the session against a rubric, updates your project tasks, and commits and pushes what you touched. One command instead of ten things you would half-remember to do.
- **`/handoff`** is the mid-session checkpoint. It writes the durable part of the current thread to a file the next session reads automatically, so you can clear a heavy context and resume clean. Two keystrokes instead of scrolling a transcript.
- **`/sessions`** is browse and resume. It lists your recent sessions from the index with real titles and summaries, not the raw picker, and hands back a resume command.
- **`/evolve`** is the nightly self-improvement pass. It rates the day's strategies, refreshes the playbook, closes finished experiments, and proposes rule promotions from mistakes that keep recurring.
- **`/muninn`** is the memory-curation gate. It triages staged knowledge into the live brain, promote, reject, or queue, then tidies the knowledge layer.
- **`/upgrade`** pulls the latest template and applies what is new, applying the documentation deltas directly and interviewing you only for the structural ones. This is the skill the update-check hook points you at.

Read the set as a shape and it is coherent: `/end` and `/handoff` write, `/sessions` reads, `/evolve` and `/muninn` are the two maintenance loops that keep the strategy and knowledge layers from rotting, and `/upgrade` keeps the stack itself current. Together they are the rhythm of a life run this way, encoded so you stop performing it by hand.

## The law: scrub before you share

A skill is a prompt, and prompts absorb specifics. The moment a skill touches your real life it starts accreting client names, absolute paths, hostnames, dollar amounts, and the name of your assistant. All of that is fine while the skill stays private. It is a leak the instant you hand the skill to someone else.

So before you share any skill, you run the same scrub the rest of the template went through: secrets, then data, then identity. The cheapest leak to catch is the one you grep for, and the reason Lararium can ship a genericized version of a working skill set at all is that every one of them was scrubbed on the way out. Inherit that habit along with the skills.

## Do not rewrite what already exists

One more piece of discipline, because it is the difference between a maintainable skill tree and a swamp. There are public skill collections worth installing rather than reimplementing, mature sets for engineering discipline like brainstorming, test-driven development, systematic debugging, and git worktrees. Point at them, install them, use them. Do not copy their skills into your own tree and call them yours: they have their own licenses and upstreams, and republishing them strands you off the update path. Install from source, and keep your own tree for the skills that are actually yours.

## How to write your own

The skills you did not inherit are the ones you build, and the recipe is short.

Start from a task you repeat: if you have typed the same multi-step instruction three times, it is a skill. Write the steps as instructions to the assistant, second person and imperative, "find the session id, then end it with a summary," not "the session is ended." Add the real trigger phrases to the description. Keep it short and load-bearing, because a skill is injected as a prompt every time it fires and padding is context you pay for on every run. And iterate when it misfires: if it triggers when you did not mean it, tighten the description; if it does the wrong thing, fix the ambiguous step. Skills are prompts, and they improve the way prompts do.

Next, and last, in the series: setting the whole thing up, in order, in an afternoon.
