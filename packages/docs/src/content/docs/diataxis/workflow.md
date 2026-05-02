---
title: Workflow
description: How to apply Diátaxis iteratively without overhauling everything at once.
---

Diátaxis is not a migration plan. It is a **continuous, bottom-up practice** applied one small piece at a time.

> "Diátaxis changes the structure of your documentation from the inside."
> — diataxis.fr

## The core loop

1. **Pick something small** — one paragraph, one section, one page.
2. **Assess it** — which Diátaxis type should this be? Is it that type right now?
3. **Make one improvement** — split mixed content, sharpen the focus, remove the instruction that crept into a reference entry.
4. **Publish it** — do not wait for a larger initiative. Ship the improvement now.

Repeat. The structure of the documentation improves organically without requiring a top-down overhaul.

## What to avoid

**Empty scaffolding.** Do not create a `tutorials/`, `how-to-guides/`, `reference/`, and `explanation/` directory structure and leave them empty. Structure follows content, not the other way around. Add sections when you have content to put in them.

**Big-bang rewrites.** Attempting to classify and rewrite all documentation at once fails — it is too large to finish and too disruptive to publish incrementally.

**Perfection over progress.** A page that is 80% correctly typed and published is more useful than a perfect page that is still in draft.

## Signals that something is wrong

These patterns usually indicate mixed types:

- A how-to guide that keeps stopping to explain why — extract an explanation page and link to it.
- A reference entry with step-by-step instructions buried in it — move them to a how-to guide.
- A tutorial that lists all the configuration options — that is reference material; link out.
- An explanation page that concludes with action steps — those belong in a how-to guide.

## In this project

The doc-freshness agent can apply Diátaxis mechanically: it scans documentation for these mixed-type signals and flags them as staleness issues. A doc that has drifted from its intended type is a form of decay — it may still be accurate but it has become less useful.

The ADRs in this project were written as explanation from the start. As the project grows, how-to guides (running the agent, adding new agents) and reference (payload schema, service API) should be added without disturbing the explanation content already present.
