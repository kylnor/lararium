---
title: "Setup, in Order, in an Afternoon"
slug: setup-in-an-afternoon
order: 7
description: The whole system, assembled in the order that keeps every step useful on its own. Brain first. Everything else earns its place.
status: draft
---

# Setup, in Order, in an Afternoon

Six posts of philosophy are worth exactly nothing if the thing sits unbuilt. So this is the closer: the whole system, assembled in the order that matters, in an afternoon. The order is the point. Build it in the right sequence and every step is useful the moment you finish it, standing on its own before the next one exists. Build it in the wrong order and you spend a day wiring infrastructure for a system that does not know anything yet.

## The one rule of setup order

**Start with what is useful with nothing, and add each layer the day the one below it strains.**

That single rule generates the whole sequence. The brain is useful with nothing but a text editor, so it goes first. The soul makes the assistant consistent, so it comes when you want a voice. Hooks make it remember, so they come when starting cold gets old. The index comes when the files outgrow grep. Agents and skills are leverage on top of a system that already works, so they come last. Nothing is built speculatively. Every layer earns its place by the one under it having proven itself.

## The afternoon, step by step

**1. Read the brain's laws, then make four folders.** Open `brain/CLAUDE.md`; it is the map and the rulebook, and it is short. Then make a folder, put four sphere folders inside it named for your life, and write a `now.md` with the two or three things that are actually hot right now. You have a working brain. It does nothing clever yet, and it is already useful: the next time you would have re-explained a project to your assistant, you write a card and point at the sphere instead.

**2. Write the soul core.** Open `soul/core.md`, blank, and write your assistant's character, using `character-craft.md` as the how: an archetype, five traits that are tensions and not adjectives, and the tone proofs that prove you actually wrote a someone. Stub the other sections with your own facts. Now the assistant sounds like itself.

**3. Adopt the operating rules.** Take the rules document that rides with the soul, action bias, steering rules, the standards, and edit it until every line is true of how you actually want to work. Character on top, rules underneath.

**4. Wire the hooks.** Copy the reference hooks, point their paths at where your soul and brain actually live, and register them. Start with the two that matter most: the session-start briefing so the assistant arrives knowing yesterday, and the safety rail so it cannot do something unrecoverable. Test each one standalone with a fake payload before you wire it, exactly as the header comments show. Now it remembers, and it has reflexes.

**5. Adopt the skills.** Copy in the session-lifecycle skills, `/end`, `/handoff`, `/sessions`, and start using them. They degrade gracefully to plain checklists if you have not stood up the index yet; they do not break. Now the rhythm of a session is encoded instead of performed by hand.

**6. Stand up the index, when you need it.** This is the one that wants real infrastructure, a database and an embedding key, and it is the one you add when the file layer has outgrown grep and you want semantic search across everything. Not before. Walk the retrieval doctrine as a checklist when you do.

**7. Adopt the agents, last.** Copy the roster into your assistant's config, run the re-theming interview if you want your own mythology, and prune the ones you will not use. They are leverage on top of a system that already works, which is exactly why they come at the end.

## Let an agent do the typing

That is the manual path, and it is worth reading once so you understand what you are building. But you do not have to type it. The whole install is agentic: open the folder in an AI coding assistant and say *run the install interview.* It interviews you one question at a time and writes your files while you answer. You are not filling in blank templates; you are having a conversation, and at the end your brain and soul exist, in your words, about your life. An agentic stack installed by an agent. That is the point, and it is also just the faster way.

## Staying current without watching a repo

A clone is a detached copy: once your stack is yours, nothing tells you an upgrade to the template exists. The system solves that from inside itself. Wire the update-check hook and once a day, at session start, it checks the upstream version against yours and, if there is a newer release, drops one line into your session: type `/upgrade`. That skill fetches the latest template and runs the upgrade interview, applying the documentation changes directly and asking you only about the structural ones. You answer questions; your assistant does the typing. Staying current is meant to be passive: your stack tells you when it is behind.

## The whole thing, in one line

Start with the brain, because markdown that knows your life beats infrastructure that does not. Add a voice, then reflexes, then search, then a team, each when the layer below it has earned the next. Let an agent do the typing. And remember the only part that was ever the point:

The shrine is free. What you enshrine in it is the part only you can make.
