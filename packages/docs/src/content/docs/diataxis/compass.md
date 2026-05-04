---
title: The compass
description: A decision tool for choosing the right Diátaxis documentation type.
---

The compass is a **decision tool**. When you are not sure which documentation type a piece of content belongs to, two questions resolve it.

## The two questions

**1. Is this content about doing, or about knowing?**

- Doing → practical (tutorial or how-to guide)
- Knowing → theoretical (reference or explanation)

**2. Is the reader acquiring something new, or applying what they already have?**

- Acquiring → learning-oriented (tutorial or explanation)
- Applying → task-oriented (how-to guide or reference)

## The truth table

| | Practical (doing) | Theoretical (knowing) |
| --- | --- | --- |
| **Acquisition (learning)** | Tutorial | Explanation |
| **Application (using)** | How-to guide | Reference |

The four combinations produce exactly the four Diátaxis types. If content does not fit cleanly into one cell, it is almost certainly trying to be two things at once — which is the most common documentation problem.

## Using it as a course-correction tool

The compass is most useful when something feels wrong about an existing page. Ask:

- Does this page keep wanting to explain things but it is supposed to be a how-to guide? → Extract the explanation into a separate page.
- Does this reference entry keep wanting to tell the reader what to do? → Split off a how-to guide.
- Does this tutorial keep stopping to describe options and alternatives? → Those belong in reference.

The names matter less than the distinctions. The compass works at any scale — a single paragraph, a section, or an entire document.

## Applied to doc-agent

| Content | Practical / Theoretical | Acquisition / Application | Type |
| --- | --- | --- | --- |
| `diataxis/tutorials` first run | Practical | Acquisition | Tutorial |
| `diataxis/how-to-guides` task recipes | Practical | Application | How-to guide |
| `diataxis/reference` contract tables | Theoretical | Application | Reference |
| `diataxis/explanation` architecture page | Theoretical | Acquisition | Explanation |
| Balanced coupling analysis | Theoretical | Acquisition | Explanation |
