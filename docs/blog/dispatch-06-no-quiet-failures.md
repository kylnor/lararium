---
title: "No Quiet Failures"
slug: no-quiet-failures
lane: dispatch
version: v2.13
date: 2026-07-21
description: My stack's memory said a thing did not exist. It did. The search had not failed loudly, it had failed silently and reported success. That bug has a name and a cure.
status: draft
---

# No Quiet Failures

I asked my stack whether we had already built a certain tool. It said no. It was wrong. The thing had shipped weeks earlier and was sitting in the exact store I was searching. The search returned nothing, and I nearly rebuilt a thing I already owned.

The near miss is not the story. Why it returned nothing is.

## The anatomy of a lie

The search needed to turn my query into a vector, which meant calling an embedding service. That service was down. The call failed. The error got caught, logged to a console the transport swallowed, and resolved to null. The lookup saw the null, returned an empty list, and did not throw. The tool still reported that corpus as searched.

So it said: I looked everywhere, there is nothing. What it meant was: I could not look at all. A broken search and an empty search produced the identical answer, delivered with identical confidence.

## The one law

> A working state and a broken state must never produce the same observable.

Every quiet failure is that shape. A dead watcher looks like a quiet day: no new rows either way. A stale registration entry looks like a correct one: both just sit there. A health check says "ok" because the timer fired, not because the work happened. A loud failure pages you. A quiet one makes you slowly, confidently wrong and never sends the bill.

## Five rules

- **Errors never become empty successes.** A caught error re-throws, surfaces in a field the caller sees, or trips a counter. A log line on a swallowed transport is a deletion with extra steps.
- **Partial failure names which half.** "Empty because nothing matched" and "empty because I could not run" are different sentences. The fix above was one new field: corpora that were asked for but could not be searched now show as degraded, not as a clean zero.
- **Producers heartbeat on success**, including the runs that found nothing, and anything with no freshness contract gets listed so it cannot hide.
- **Every critical capability gets an outside probe.** Self-reported health is worthless the moment the thing breaks. Query a known document by a synonym it does not contain and assert it comes back. If it does not, the search is down, whatever the health endpoint claims.
- **The map matches the territory.** Every name in a registration list must resolve to a real thing, checked at startup, not assumed.

## It ate its own dogfood

I pointed that last check at my own registration list. It instantly flagged six entries pointing at deleted tools. Then I turned it on this template and found the tool docs advertising fourteen tools that no longer exist. The empty cathedral was quietly lying to everyone who cloned it. This release is that fix.

## The discipline

Trust nothing that cannot fail loudly. Build the visible difference between working and broken, and put something independent in the room to watch for it.

Your stack will lie to you eventually. The only question is whether it lies quietly.
