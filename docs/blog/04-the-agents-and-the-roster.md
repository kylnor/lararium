---
title: "The Agents, and the Team You Dispatch"
slug: the-agents-and-the-roster
order: 4
description: One assistant you talk to, a roster it dispatches. Functional coverage, the validated build loop, and a mythology that is yours to write.
status: draft
---

# The Agents, and the Team You Dispatch

There is a ceiling on what one assistant, in one conversation, can do well. It holds one context. It thinks in one voice. Ask it to build a feature and review its own work and you get a builder grading its own homework. The agents layer is how you break the ceiling: one assistant you talk to, and behind it a roster of specialists it dispatches, each with its own function, its own model, its own tools, and its own opinions about the work.

They are a team, not worker threads. That distinction is the whole design. A worker thread runs a task and returns. A team member has a job it owns, a standard it holds, and a relationship to the other members. Lararium ships the roster and, more importantly, the doctrine for using it well.

## Coverage is the thing, names are not

The template ships a themed roster, because a themed team is easier to hold in your head than twelve job titles. But the names do not matter. The **functional coverage** does. Whatever you call them, make sure you have one agent for each job:

- **Build.** A fast prototyper that ships working code now, a complex autonomous builder that owns a whole feature, and an architect that thinks before building on the hard problems.
- **Review and quality.** An adversarial code reviewer and deploy guardian, a QA agent that hunts edge cases and will not sign off easily, a fast silent pattern scanner, a long-horizon strategic reviewer.
- **Research and detective.** A deep researcher that returns knowledge instead of code, a debugger that traces data flows, a data-acquisition agent for scraping and APIs, a threat modeler.
- **Infra and monitoring.** An infrastructure agent and a drift-and-anomaly monitor.
- **Adversarial and chaos.** Chaos engineering, load and stress, red-team prototyping, exploratory edge-case testing.
- **Orchestration and memory.** The team lead, which is the assistant itself, a signal gatherer that writes to a staging area, a memory keeper that curates staging into the live brain, and a curator that enforces the brain's laws over the files.

You will not use all of them. Prune the ones you do not, and keep the doctrine.

## The loops worth copying

The roster is inert without the dispatch discipline. Three loops carry most of the value.

**Subagent-first dispatch.** The default is to dispatch, and to work inline only by exception. Dispatching preserves the main conversation's context, parallelizes the work, and moves faster. When in doubt, dispatch. The instinct to "just do it here" is the instinct that fills your main context with the transcript of a build and leaves no room to think.

**Build to a branch, then adversarial review, then merge.** This is the loop that catches what would otherwise ship. A complex build goes: the builder produces a branch and does not open a pull request, a reviewer does a genuinely adversarial pass and reports back in a fixed shape, blockers and watch-outs and confirmed-clean, you fix the blockers verbatim, and only then does it merge. The value is in the word adversarial. A reviewer told to "check this over" rubber-stamps. A reviewer told to break it finds the auth hole. On one real build this loop caught nine scope and permission holes that a friendly review would have waved through.

**Worktree isolation.** When two or more agents touch the same repo at once, each gets its own git worktree on its own branch. Never run parallel agents against one working tree; that is a merge collision waiting to happen.

And the rule that keeps the whole thing honest: **an agent's claim is signal, not truth.** When a review agent reports a bug, you trace the path or write the failing test before you fix anything. When a builder reports success, you verify it against ground truth. Agents are confident. Confidence is not correctness, and a system that treats agent output as fact will cheerfully act on a hallucinated file path.

## Bring your own gods, literally

The roster ships under one mythology, and the theme is flavor, and flavor should be yours. So the layer ships with a re-theming interview: open your repo, say *run the re-theming interview*, and the assistant interviews you for a mythology, a heist crew, a pantheon, a ship's bridge, a kitchen brigade, or no theme at all, plain functional names for people who want a toolbox and not a table read, and rebuilds the roster in it.

The one thing you do **not** do is find-and-replace the names. Renaming the builder file to a new name gives you the old character wearing a name tag. A re-theme regenerates the character, because a team that has real opinions about each other reads as a team, and those opinions have to be rewritten for the new cast, not relabeled. What stays verbatim through a re-theme is the machinery: the model choices, the tool sets, the operating doctrine. Those are engineering decisions, not costume. The costume changes; the discipline underneath does not.

This is the most literal reading of the Lararium promise. The gods in the shrine are the specialists you dispatch, and the pantheon is yours to name. What does not change, no matter what you call them, is the doctrine that makes a roster into a team instead of a list.

Next in the series: the hooks, the reflexes that make the whole thing feel alive.
