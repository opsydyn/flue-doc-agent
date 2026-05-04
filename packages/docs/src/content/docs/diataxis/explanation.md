---
title: Explanation — how this repo uses Flue
description: Why doc-agent is organised around Flue, Effect, Varlock, Starlight, and a deterministic freshness gate.
---

This page is for the moment after the commands work and the payload shapes make sense, but before
the architecture feels obvious.

The short version is that this repository uses **Flue** as the agent harness, **Effect** as the
typed application core, **Varlock** as the environment contract boundary, and **Starlight** as both
the documentation site and the content tree the agent audits.

## Flue provides the orchestration surface

The Flue handler in `agents/doc-freshness/.flue/agents/doc-freshness.ts` is intentionally thin.
It does three things well:

- selects the runtime shape (`flue run`, `flue dev`, or webhook)
- initialises the agent runtime and its tools
- bridges from Flue's `async` boundary into the typed Effect services underneath

That keeps the agent feeling like Flue — skills, `AGENTS.md`, custom tools, webhook sessions —
without forcing the entire codebase to become prompt orchestration. The lower layers remain ordinary,
testable application code.

This follows the intent captured in
[`ADR-002`](/flue-doc-agent/decisions/adr-002-flue-framework/),
[`ADR-003`](/flue-doc-agent/decisions/adr-003-effect-as-core-language/), and
[`ADR-005`](/flue-doc-agent/decisions/adr-005-valibot-for-flue-schemas/).

## Effect owns the deterministic core

The most important architectural choice in this repo is that the **CI gate is deterministic by
default**.

`doc-freshness` does contain a full agentic skill path, but the ordinary `check-staleness` mode runs
through the deterministic Effect pipeline first. That is deliberate.

Why?

- CI needs repeatable pass/fail behaviour
- stale-doc scoring should not drift with prompt variation
- link checking, history lookups, and evidence collation are easier to test as typed services
- the agentic path is still valuable for autonomous review, but it is a poor foundation for a hard gate

That trade-off is the heart of
[`ADR-015`](/flue-doc-agent/decisions/adr-015-deterministic-freshness-review-tool/) and the later
AI advisory work in
[`ADR-020`](/flue-doc-agent/decisions/adr-020-ai-advisory-freshness-layer/).

## Custom tools keep the agent grounded

The custom Flue tools in the handler are not there to add sparkle. They exist to reduce ambiguity.

Instead of asking the model to "figure it out" from raw shell access alone, the repo gives it small,
typed capabilities with narrow contracts:

- `list-docs` for the audit scope
- `read-doc` for parsed Markdown evidence
- `github-history` for commit timestamps
- `review-freshness` for deterministic status assignment
- `check-url` for bounded external link validation
- `fetch-analytics` for page-view context

This is why the agent can still behave autonomously while staying tied to concrete evidence.

## Varlock makes the environment explicit

The repo does not treat environment variables as a background assumption. It treats them as a
contract.

That is why the developer-facing commands are written as `varlock run -- ...` and why the docs keep
pointing back to `.env.schema` and `.env.example`.

The result is less glamorous than magical implicit config, but much easier to debug in local runs,
GitHub Actions, and generated report scripts. That rationale is recorded in
[`ADR-019`](/flue-doc-agent/decisions/adr-019-varlock-effect-app-config/).

## Starlight is both product and test subject

The documentation site is not adjacent to the agent; it is part of the system the agent exists to
audit.

That creates a useful loop:

- Starlight gives the repo a structured docs collection
- the agent reads those Markdown files through typed tools
- analytics and generated reports flow back into the same docs site
- Diátaxis keeps the human-facing documentation clear while the agent watches for drift

In other words, the documentation is not just an output of the project. It is one of the project's
primary inputs.

## Why this Diátaxis section matters

The four pages in this section all cover the same subject, but they do different jobs:

- the tutorial gets a first run over the line
- the how-to guide supports repeated tasks
- the reference page answers exact questions during work
- this page explains the design pressure underneath those choices

That separation is not pedantry. It is the reason the docs can be both easier to use and easier for
`doc-freshness` to audit for drift.

`docs/balanced-coupling-analysis.md` and `docs/postmortems/` are also explanation — they discuss trade-offs and incidents rather than instructing the reader.
