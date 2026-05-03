---
title: "ADR-018: Deduped critical freshness issues"
---

# ADR-018: Deduped critical freshness issues

## Status

Accepted

## Date

2026-05-03

## Context

ADR-017 added GitHub Actions annotations for immediate workflow feedback. Phase 5 also calls for
durable feedback once report history and publication are stable.

Critical freshness findings are the only findings that fail the workflow. They should be visible
outside a single Actions run so maintainers can track remediation over time. Lower-priority stale
or warning findings already appear in the generated Starlight report and workflow annotations.

## Decision

Create or update one open GitHub issue per critical stale document.

The issue sync policy is:

- only files with `priority: "critical"` are synced to issues
- issue titles are deterministic: `Critical doc freshness: <path>`
- issue bodies include a hidden marker: `<!-- doc-freshness:<path> -->`
- existing open issues are matched by marker first, with title as a fallback
- matching issues are updated only when the generated title or body changes
- non-critical findings do not create issues

The pure planner lives in `agents/doc-freshness/src/GithubFreshnessIssues.ts`. The side-effecting
boundary lives in `agents/doc-freshness/scripts/sync-github-freshness-issues.ts`, which decodes the
freshness result through Effect Schema and uses Octokit to list, create, and update issues.

The workflow grants `issues: write` and runs the sync step after report commit/deploy dispatch but
before the freshness gate. The step is `continue-on-error: true` so issue API failures do not
prevent report publication or hide the final freshness gate result.

## Non-Goals

- Do not create issues for low-priority stale documents or warnings.
- Do not auto-close issues yet when a document becomes fresh.
- Do not add labels in this slice; missing repository labels would create another failure mode.
- Do not use raw JSON parsing in the issue sync script.

## Alternatives Considered

### Create issues for all stale and warning docs

- Pros: complete backlog visibility.
- Cons: noisy for MVP and duplicates the generated Starlight report.
- Rejected.

### Use labels for dedupe

- Pros: easier issue filtering.
- Cons: requires label bootstrapping or failure handling for missing labels.
- Deferred.

### Use hidden body markers for dedupe

- Pros: stable across title edits, no repository setup required, easy to test.
- Cons: issue body format becomes part of the contract.
- Accepted.

## Implementation Plan

1. Add `agents/doc-freshness/src/GithubFreshnessIssues.ts`.
2. Add `agents/doc-freshness/src/__tests__/GithubFreshnessIssues.test.ts`.
3. Add `agents/doc-freshness/scripts/sync-github-freshness-issues.ts`.
4. Update `.github/workflows/doc-freshness.yml`:
   - grant `issues: write`
   - run the sync script before `Apply freshness gate`
   - keep the sync step non-blocking

## Verification

- [x] `bun test agents/doc-freshness/src/__tests__/GithubFreshnessIssues.test.ts` passes.
- [x] `bun run --cwd agents/doc-freshness typecheck` passes.
- [x] `bun run --cwd agents/doc-freshness test:all` passes.
- [x] Targeted Biome/linteffect lint passes for the new issue sync files.
- [x] `.github/workflows/doc-freshness.yml` parses as valid YAML.
- [x] `bun run --cwd packages/docs build` passes with ADR-018 present.

## Consequences

- Critical freshness findings now have durable GitHub issue tracking.
- The generated Starlight report remains the full source of truth for all findings.
- Future slices can add auto-close behavior, labels, assignees, or milestone routing without
  changing freshness scoring.
