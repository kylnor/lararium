---
title: "The Lab, and Letting Your Agent Run a Stranger's Code"
slug: the-lab
lane: dispatch
version: v2.8
date: 2026-07-11
description: Your assistant is most useful when it can clone and run other people's code, which is exactly when it is most dangerous. So the stack now ships a box for it.
status: draft
---

# The Lab, and Letting Your Agent Run a Stranger's Code

Here is a thing you have probably done this week. You found a repo. Maybe someone linked it, maybe your agent did. It looked useful, so you cloned it and ran `npm install`, or you told your assistant to try it out. That took about four seconds and you did not think twice.

You should have. Not because that repo was hostile, but because you had no way of knowing, and you ran it anyway.

## The most useful thing your agent does is also the most dangerous

An agentic stack earns its keep the moment it can go get other people's work and use it. Clone the library, run the example, install the tool, read the code and tell you if it is any good. That reach is the whole point. It is also the single widest hole in the entire system, because the code it reaches for is written by people you have never met.

The danger is not the file you can see. It is everything you cannot. `npm install` does not install the fifty lines you skimmed; it pulls a dependency tree hundreds of packages deep that nobody has read, any one of which can run a script on the way in. A repo that looks clean at rest can phone home the first time you actually run it. And the subtlest one: an assistant *reading* a hostile file can be talked into running it, because a file that says the right words is an instruction to a language model, not just text on a screen.

So "I read it and it looked fine" is not safety. It is a vibe. Reading narrows the odds; it does not close them.

## The fix is a box, not a rule

You cannot rule your way out of this. "Be careful" is not a control. What actually works is boring and physical: give the untrusted code somewhere to run where it can do its worst and it does not matter.

That is the lab. It ships in the stack now, and it is one command:

```
lab https://github.com/someone/their-repo
```

That drops you into a throwaway container with their code in it, and four things are true of every single run:

- **Nothing of yours is in there.** No keys, no config, no assistant memory, no home directory. The code enters by a clone or a copy, never by mounting your disk. If it fully owns the box, there is nothing of yours in the box to take.
- **No network, by default.** It cannot phone home or exfiltrate, because it cannot reach the internet at all unless you explicitly turn the network on to watch what it does.
- **It is disposable.** You do not clean it, you delete it. Type `exit` and the box and everything that happened in it is gone.
- **It is de-fanged.** Even as the root user inside, it has had every privilege stripped, so it cannot escalate, and it has hard memory and process limits so a bomb cannot take your machine down with it.

If a poisoned repo detonates in there, the blast radius is a container you were going to throw away anyway. Your machine, your network, and your life never feel it.

## Your assistant does this for you

The command is for you. The reflex is for your assistant. Say `/in-the-lab` and it takes over: it spins the box, runs a read-only recon inside it, and comes back with what the code reaches for. Does it have an install hook? Does it grab the network, spawn a shell, evaluate strings at runtime, look obfuscated? How big is the dependency tree it wants to pull that nobody has read? You get a plain-language read before a single line runs on your actual machine.

The important discipline is what it will *not* do: it will not install or run the untrusted code on your host to figure out whether it is safe. That defeats the entire purpose. The box is where the code lives until you decide otherwise.

There is a deeper reason the assistant does its looking from inside the box, and it is the part most people miss. Sandboxing the code does nothing if the thing reading the code is not also sandboxed. A hostile repo does not need to execute to hurt you; it can simply talk your assistant into acting. So the assistant that investigates untrusted code goes in with nothing attached: no credentials, no memory, no reach. If the repo hijacks it, the hijacked thing is holding an empty bag.

## Do not trust us either

There is an obvious hypocrisy in a project that preaches "do not run strangers' code" and then tells you to install it with `npx lararium`, which is, precisely, running a stranger's code. We noticed. So here is the honest version.

The installer is about two hundred lines of standard-library code with zero dependencies. It downloads a release and unpacks it and runs `git init`. It executes none of the template's own code. You can read the whole thing in a couple of minutes before you run it, or you can skip it entirely and clone the repo by hand, at which point you have inspected everything before a single line executes.

And if you are the kind of person this whole tool is built for, here is the move that should make you smile: clone Lararium, and let the very first thing your new lab does be to audit Lararium itself.

```
lab https://github.com/kylnor/lararium
```

The tool's first job can be vetting its own supplier. We would rather you check than take our word for it. That is sort of the entire philosophy.

## Why this is the first dispatch

Lararium ships changes often, and from now on each one gets written up here, in plain language, the same day it ships. Not a changelog line. The thinking: what changed, why it exists, and what it is for.

This is the first. The lab exists because the most valuable thing you will ask your assistant to do is also the thing most likely to hurt you, and a good system does not solve that with a warning label. It solves it with a wall you can put between the work and your life, and then it hands you the wall along with everything else.

We give you the whole methodology, in the most agent-native form we can. And we give you the tools to distrust us while you take it. Both halves are the product.
