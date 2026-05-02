---
title: Reference
description: Information-oriented documentation that describes the machinery accurately.
---

Reference is the **map of the system**. It describes what exists: its structure, its options, its behaviours, its limits. The reader consults it while they work, not to learn.

> "Reference material is like a map — it describes the territory in a consistent, predictable form."
> — diataxis.fr

## What reference is

The reader is working. They need a specific fact: what does this parameter accept? what does this error mean? what are the valid values here? Reference answers those questions directly, consistently, and without opinion.

Reference material mirrors the structure of the system itself. If the system has three services, the reference has three sections. If a function has five parameters, the reference describes all five.

## What reference is not

- A tutorial — it does not guide the reader through a task
- A how-to guide — it does not direct the reader toward a goal
- An explanation — it does not discuss trade-offs or history

## Principles

**Describe, do not instruct.** Say what something *is*, not what to *do* with it. Instruction belongs in how-to guides.

**Be consistent.** Use the same structure for every entry of the same kind. Predictability lets the reader find what they need without reading.

**Mirror the system's structure.** Organise reference around what the system exposes — services, commands, configuration keys, error types — not around what the user wants to accomplish.

**Include examples sparingly.** A short example can clarify an otherwise abstract description. Keep it illustrative, not instructional.

**State limits and warnings.** The reader needs to know what does not work as much as what does.

## Writing checklist

- [ ] Does each entry describe what something *is*, not what to *do* with it?
- [ ] Is the structure consistent across all entries of the same type?
- [ ] Does the organisation follow the system's own structure?
- [ ] Have opinions, caveats, and explanatory asides been removed or linked out?
- [ ] Are limits, edge cases, and warnings explicitly stated?

## In this project

Reference pages for doc-agent might include:

- **Agent payload schema** — all fields, types, and defaults for `doc-freshness`
- **Result schema** — the shape of the structured output (`files`, `summary`)
- **`UrlCheckError`** — fields, when it is thrown, what `cause` contains
- **Skill arguments** — what `check-staleness` accepts via `args`
- **Configuration** — all keys in `biome.jsonc`, `tsconfig.json`, and `package.json` scripts

The ADRs in this project are *not* reference — they are explanation. `CLAUDE.md` leans closest to reference.
