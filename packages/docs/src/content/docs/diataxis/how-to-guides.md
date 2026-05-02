---
title: How-to guides
description: Problem-oriented documentation that directs a competent user to a result.
---

A how-to guide answers the question: **"How do I …?"** It is written for a reader who already has context and a specific goal. They do not need teaching — they need directions.

## What a how-to guide is

The reader is competent. They have a problem to solve right now. A how-to guide gives them the steps to reach their goal without detour.

Unlike a tutorial, the guide does not need to hold the reader's hand or explain what each step means. It assumes they can judge whether a step is correct and adapt it to their situation.

## What a how-to guide is not

- A tutorial — it does not teach; it directs
- A reference page — it does not describe every option, only the path to the goal
- An explanation — it does not discuss design reasoning

## Principles

**Name the goal, not the tool.** The title should express the reader's objective: "Add a new agent" not "Using the `flue init` command."

**Start and finish at sensible boundaries.** The guide does not need to cover the whole system — just the slice that solves the problem. Assume the reader can handle context before and after.

**Stay focused.** No digressions. If an explanation is tempting, link to it instead.

**Acknowledge real-world variation.** Unlike a tutorial, a how-to guide can acknowledge that the reader's situation may differ slightly and offer lightweight branching guidance.

**Sequence for the reader's workflow.** Order steps the way a person actually thinks and works, not the way the system is internally structured.

## Writing checklist

- [ ] Does the title start with "How to …" or a verb phrase?
- [ ] Does it assume the reader is already competent?
- [ ] Is every step oriented toward the goal, not toward explaining the system?
- [ ] Have you avoided teaching things the reader already knows?
- [ ] Can someone follow it without reading anything else first?

## In this project

How-to guides for doc-agent might include:
- How to add a new agent to the monorepo
- How to write a custom tool for a Flue agent
- How to run the doc-freshness agent in GitHub Actions
- How to configure the staleness threshold
