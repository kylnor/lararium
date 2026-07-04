---
title: "The Brain, and the Sphere Method"
slug: the-brain-and-the-sphere-method
order: 1
description: Your AI forgets you every morning. The fix is just markdown, and a way of cutting up your life.
status: draft
---

# The Brain, and the Sphere Method

Your AI assistant forgets you every morning. You explain your project, your people, your constraints, and the next day you explain them again. The context window is not memory. It is a whiteboard someone wipes at midnight.

The brain is the fix, and it is almost embarrassingly low-tech: a folder of markdown files, organized by a small set of laws, that you and your assistant both read and write. No database required to start. No infrastructure. A text editor and a decision about how to cut up your life.

That decision is the sphere method, and it is the most stealable idea in the whole system. You can adopt it this afternoon without touching anything else Lararium ships.

## Files are canonical. The database is an index on top.

Start with the one principle that makes the rest coherent. The files are the truth. If a database ever sits over them, it is an index, the way a library catalog is an index of the books. Burn the catalog and the books are fine. Burn the books and the catalog is a list of ghosts.

This matters because it keeps the brain **human-navigable.** You can open it, read it, edit it by hand, and hand it to a friend. It is not trapped inside a tool. It outlives whatever tool you use this year.

And it draws a hard line about what belongs inside:

> The test for any file: would you want to read this? If it is raw data, it belongs in the corpus, not the brain. If it is something you *learned* from the data, it is a card.

Your emails, your messages, your calendar, the raw firehose of your life: those stay in the index, the cold store. The brain never copies them. A card *points at* them. The brain is the synthesis layer, the distilled and durable and navigable part. The stuff you would actually open and read.

## Spheres are the scope boundary

Here is the problem the sphere method solves. If you pour your whole life into one context, every answer gets worse. Ask about a work deadline and the model is also chewing on your side project, your family, your server config. Relevance drops. The model reaches for the wrong thing because everything is equally present and nothing is scoped.

So you partition. The brain is cut into **spheres**, the large domains of a life:

- **ventures**: your bets, side projects, the entrepreneurial work.
- **work**: the day job.
- **personal**: family, health, finances.
- **infrastructure**: the system itself, the assistant, the tooling.

Rename them to fit your life. The point is the partition, not those four exact words. The payoff is **scoped loading**: when you work on a venture, you load the venture sphere, not all of you. The assistant arrives focused instead of flooded.

One file sits above the spheres and is read every session no matter what: `now.md`, the cross-cutting heartbeat. What is hot this week, anywhere. It is the answer to "where are we?" that a fresh session needs before it can be useful.

## The recursive shape

Inside a sphere, wherever a thing has a real world of its own, it gets the same shape:

```
CONTEXT.md     # what this is, who is in it, current focus
people/        # cards on the people in this scope
orgs/          # companies, clients, entities
projects/      # what you know about projects (not the code; code stays in git)
reference/     # constraints and knowledge to internalize, scoped here
```

A sphere uses this shape. A big venture *inside* a sphere uses the same shape. That is the recursion, and it is what lets the brain grow without ever being redesigned. You learned the pattern once; it applies at every level.

The discipline is to apply it **only where it is populated.** A health scope does not need an `orgs/` folder. You do not have corporate health entities. Never force an empty folder into existence because the template has a slot for it.

## The laws

The sphere method has a rulebook, and it is short enough to memorize. These are the laws a person follows editing the brain by hand, which are exactly the laws an agent enforces on a schedule. The same rules, written once.

1. **Card until it earns a folder.** A thing starts as a single file, `myproject.md`. When it grows its own cast and its own concerns, promote it to a folder with the full shape. Promotion takes thirty seconds. Do it when earned, not one folder sooner.
2. **Never pre-build empty folders.** A card costs nothing. Empty folders are how trees die.
3. **Shared lives once.** Someone who spans a sphere lives at the sphere level with a `_` prefix, `ventures/_people/`, which sorts to the top. Scoped to one venture, they live inside it. Never copy a card into two places. Link instead.
4. **Depth cap: three folder levels, then files.** Want a fourth folder? That fourth thing is a card, not a folder.
5. **Frontmatter on every file**, so an index can ingest it later with no new schema: `name`, `description`, `type`, `status`, `updated`.
6. **Wikilinks between cards.** A cheap graph, no tooling. A link to a card that does not exist yet is fine. It marks something worth writing.
7. **Reference is not working material.** `reference/` holds constraints to internalize: voice, conventions, canon. Working material is input to process. Keep them structurally separate. Mixing them in one blob degrades every answer that reads it.
8. **The card points at the work; it does not eat it.** A project card holds status, decisions, the cast, and a pointer to where the real work lives. The brain is what you know about the thing. The workspace is the thing.

Read law one and law two together, because they are the soul of the method. **Structure is earned, never pre-built.** You do not sit down and architect a beautiful empty tree of your life and then fail to fill it. You start with one card, and you let it grow a folder the day it actually needs one. A brain built this way is always exactly as complex as your life currently is, and never more.

## The rot, and who hunts it

A knowledge store decays. Left alone, it grows empty folders, duplicate cards for the same person in three scopes, frontmatter that says `updated: last March` on something you touched today, cards that quietly contradict a newer decision, dead links, and a `now.md` still claiming a project is hot that has not moved in weeks.

So the brain has two jobs that keep it alive. A **gardener** pulls new signal out of the cold corpora and turns it into cards, generous on intake. A **curator** polices structure against the laws above, generating nothing, only keeping it clean. In Lararium both can be run by an agent on a schedule, because the laws are written down and enforceable. But you can be the curator yourself with nothing but this list and ten minutes. The rules do not require the automation. The automation just runs the rules you would run anyway.

## Try it today

You do not need the rest of Lararium to start. Make a folder. Make four sphere folders inside it, named for your life. Write a `now.md` with the two or three things that are actually hot right now. Then, the next time you would have re-explained your project to your assistant, write a card instead, and point the assistant at the sphere.

That is the entire on-ramp. A folder, four spheres, and the discipline to write it down once instead of saying it twice. The database, the soul, the agents, the hooks: those come later, when the file layer has proven itself and you want more. The brain earns all of them by being useful first, on day one, as nothing but markdown.

Next in the series: the soul, and why your assistant sounds like everyone else's.
