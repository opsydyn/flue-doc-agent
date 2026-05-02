---
title: Tutorials
description: Learning-oriented documentation that guides the reader through an experience.
---

A tutorial is a **guided experience** — the reader learns by doing under the guidance of the author. The goal is skill acquisition, not task completion.

> "A tutorial is not the place for explanation."
> — diataxis.fr

## What a tutorial is

The reader is a beginner. They do not yet know what they do not know. A tutorial takes them through a concrete, working experience that builds foundational confidence.

The author acts as a tutor: choosing the path, making all the decisions, and removing every obstacle. The reader follows instructions and — crucially — achieves something real at the end.

## What a tutorial is not

- A how-to guide — the reader has no prior goal; they are here to learn, not to solve a problem
- A reference page — it should not exhaustively describe options or edge cases
- An explanation — it should not stop to analyse design decisions

## Principles

**Do, then understand.** Action comes first. The reader should be *doing* from the very first step, not reading background theory.

**Deliver visible progress early.** Every meaningful checkpoint where something works builds trust and motivation.

**Show what correct looks like.** Use phrases like "the output should look like this" so readers know they are on track.

**Ignore alternatives.** Do not mention other ways to achieve the same result. Stay on the path. Link out for those who want more.

**Guarantee reliability.** Every step must work for every reader, every time. A tutorial that fails halfway teaches nothing except frustration.

## Writing checklist

- [ ] Does it start with an action, not background reading?
- [ ] Does the reader have something working within the first few steps?
- [ ] Is each step concrete and unambiguous?
- [ ] Have all explanatory asides been removed or moved to a linked explanation page?
- [ ] Does it end with the reader having built something real?

## In this project

A tutorial for doc-agent might walk a new user through running the `doc-freshness` agent against a small test repository for the first time — from cloning to seeing a freshness report in the terminal. It would not explain why Effect is used or what `UrlChecker` does internally.
