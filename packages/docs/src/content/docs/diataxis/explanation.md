---
title: Explanation
description: Understanding-oriented documentation that illuminates and discusses.
---

Explanation answers the question: **"Can you tell me about …?"** It is written for a reader who wants to understand — not to do something right now, but to think clearly about a topic.

> "Explanation is the documentation you can read in the bath."
> — diataxis.fr

## What explanation is

The reader is stepping back. They want context, background, the reasoning behind decisions, the trade-offs that were considered, the alternatives that were rejected. They are not following a workflow — they are building a mental model.

Explanation takes a wider, higher view than other documentation types. It connects topics, discusses history, explores multiple perspectives, and admits uncertainty where it exists.

## What explanation is not

- A tutorial — it does not guide the reader through a task
- A how-to guide — it does not solve a specific problem
- A reference page — it does not provide a factual inventory of the system

## Principles

**Discuss, do not instruct.** Explanation weighs alternatives and explores context. It is not a list of steps.

**Provide context and history.** Why was this decision made? What problem was it solving? What alternatives were considered?

**Make connections.** Show how this topic relates to others in the system. Explanation is where the big picture lives.

**Admit perspectives and trade-offs.** Real design involves competing concerns. Explanation is the right place to discuss them honestly.

**Keep tight boundaries.** It is easy for explanation to absorb instructional or reference content. Resist the pull — link out instead.

## Writing checklist

- [ ] Does it explore *why* rather than *how*?
- [ ] Does it discuss context, history, or alternatives?
- [ ] Could the reader understand it without following any steps?
- [ ] Have instructions and factual inventories been removed or linked out?
- [ ] Does it help the reader build a mental model of the system?

## In this project

The ADRs in `docs/decisions/` are the primary explanation content in this project. Each one discusses:

- The context that made a decision necessary
- The alternatives that were considered
- The reasoning behind the choice
- The consequences the team accepted

`docs/balanced-coupling-analysis.md` and `docs/postmortems/` are also explanation — they discuss trade-offs and incidents rather than instructing the reader.
