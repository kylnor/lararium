---
title: "Who Gets to Say It's Done"
slug: the-feature-list
lane: dispatch
version: v2.9
date: 2026-07-12
description: Your assistant is the worst possible judge of whether its own work is finished, and it is also the one you keep asking. This release takes that decision away from it and hands it to a script.
status: draft
---

# Who Gets to Say It's Done

Here is a conversation you have had. You ask your assistant to build a thing. A while later it comes back and says, cheerfully, that the thing is built. You look closer. The endpoint is there but it returns the wrong shape, or the tests it wrote all mock the one part that was actually broken, or it "handled the edge case" by writing a comment that says it handled the edge case. It was not lying. It genuinely believed it was done.

That belief is the problem. A language model asked to grade its own homework gives itself an A, every time, because the same process that wrote the code decides whether the code is good. It is the least qualified judge in the building and it is the one you keep putting on the stand.

## "Looks correct" is not a status

The failure has a shape. Code gets written. It parses. The static check is quiet. A unit test passes because its mocks were built to pass. So the assistant declares victory, and the declaration skips the only layer that mattered: does the thing actually do what it was supposed to, end to end, when you run it for real. Nobody ran it for real. "Should work" got promoted to "works" somewhere between two sentences and no one noticed.

You cannot fix this with a better prompt or a smarter model. Overconfidence is not a bug in one model, it is what self-evaluation is. You fix it by moving the decision out of the model's hands entirely.

## Hand the verdict to something that cannot flatter you

This release adds one primitive: a feature list that a script owns, not the assistant.

It is a file, `feature_list.json`, that lives at the root of a repo. Every feature in it carries exactly three things: a one-line description of the behavior, a verification command that actually runs, and a state. And there is one rule that makes the whole thing work: **a feature only reaches "passing" when its verification command exits zero, and a script writes that transition, never the assistant.**

The assistant can ask for a feature to be verified. It cannot mark one done. It does not have the pen. A green exit code has the pen. That single move, taking the "done" stamp away from the thing that always stamps yes, is the entire idea, and it is worth more than it looks.

There is a companion script, `scripts/verify-features.mjs`, that runs the commands, flips the states, and prints the board. Ask it for a report and you get, in one screen, exactly what is proven and what is only claimed. A fresh session opens knowing where the real edge is. A branch does not merge with anything red.

## The tell that it works

The first time we ran this on a live repo, a real one carrying real revenue, it went down the feature list turning things green, and then it turned one red. Not because the script was wrong. Because the feature was actually broken, a genuine bug sitting in shipped code that every previous "it's done" had walked straight past. The board found it in the time it took to run the tests, because for once the answer was allowed to be no.

That is the thing about taking away the flattery. The list stops being a place where work goes to be congratulated and starts being a place where it goes to be checked. Six honest features, one of them red, beat eleven green ones that were green because nobody looked.

## What ships

- **A rule**, in the operating doc: the feature list doctrine, state is machine-owned, never fabricate a verification, one feature active at a time.
- **A skill**, `/feature-list`, that scaffolds both files into any repo, grounded in that repo's real test suite. It refuses to point a command at a test that does not exist.
- **The verifier itself**, ready to copy in. It is language-agnostic; it only reads the file and runs your commands, so it works whether your tests are Node, Python, or a pile of shell scripts.

Opt-in, like everything else. Copy it into the repos where "is it actually done" is a question you are tired of guessing at. Which, if you are honest, is most of them.
