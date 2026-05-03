---
title: "ADR-017: GitHub Actions freshness annotations"
---

# ADR-017: GitHub Actions freshness annotations

## Status

Accepted

## Date

2026-05-03

## Context

Phase 5 adds feedback channels after generated Starlight reports are committed and published.
GitHub issues and PR comments are useful, but they create durable repository objects and need a
clear deduplication policy.

The freshness workflow already has a structured `/tmp/freshness-result.json` artifact after the
Flue result extraction step. That result contains reviewed files with deterministic `status`,
`priority`, `issues`, and source file paths.

## Decision

Emit GitHub Actions annotations from the structured freshness result before generating and
committing Starlight pages.

The annotation policy is:

- `fresh` documents produce no annotation
- `critical` documents produce `::error`
- all other stale or warning documents produce `::warning`

The implementation uses a tested formatter in
`agents/doc-freshness/src/GithubActionsAnnotations.ts` and a small boundary script,
`agents/doc-freshness/scripts/emit-github-annotations.ts`, which decodes the freshness JSON through
Effect Schema and prints GitHub workflow commands.

## Non-Goals

- Do not create GitHub issues in this slice.
- Do not create or update PR comments in this slice.
- Do not make the annotation script re-score freshness.
- Do not parse JSON with raw `JSON.parse`; keep JSON decoding at the script boundary through Effect
  Schema.

## Alternatives Considered

### Create GitHub issues for critical docs

- Pros: durable tracking outside a workflow run.
- Cons: needs deduplication, close/reopen behavior, labels, and ownership policy.
- Deferred.

### Comment on pull requests

- Pros: useful for PR-triggered freshness checks.
- Cons: the current MVP runs on schedule and manual dispatch, where PR context is absent.
- Deferred.

### Emit GitHub Actions annotations

- Pros: immediate CI feedback, no extra repository objects, works for schedule and manual dispatch.
- Cons: annotations live with the workflow run rather than as long-lived backlog items.
- Accepted.

## Implementation Plan

1. Add `agents/doc-freshness/src/GithubActionsAnnotations.ts`:
   - decode the relevant freshness result shape with Effect Schema
   - map reviewed files to tagged annotation domain values
   - escape GitHub workflow command data and properties
2. Add `agents/doc-freshness/src/__tests__/GithubActionsAnnotations.test.ts`.
3. Add `agents/doc-freshness/scripts/emit-github-annotations.ts`.
4. Call the script from `.github/workflows/doc-freshness.yml` after `/tmp/freshness-result.json`
   is created.

## Verification

- [x] `bun test agents/doc-freshness/src/__tests__/GithubActionsAnnotations.test.ts` passes.
- [x] `bun run --cwd agents/doc-freshness typecheck` passes.
- [x] `bun run --cwd agents/doc-freshness test:all` passes.
- [x] `.github/workflows/doc-freshness.yml` parses as valid YAML.
- [x] `bun run --cwd packages/docs build` passes with ADR-017 present.
- [x] `emit-github-annotations.ts` smoke test emits the expected GitHub Actions command.

## Consequences

- Freshness issues are visible directly in the workflow UI.
- Critical freshness issues show as error annotations before the final freshness gate fails.
- The next feedback slice can add durable GitHub issues with a cleaner policy because the
  annotation mapping is already isolated and tested.
