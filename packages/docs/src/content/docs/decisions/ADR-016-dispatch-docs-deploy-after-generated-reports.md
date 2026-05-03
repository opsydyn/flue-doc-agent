---
title: "ADR-016: Dispatch docs deploy after generated reports"
---

# ADR-016: Dispatch docs deploy after generated reports

## Status

Accepted

## Date

2026-05-03

## Context

Phase 5 of the freshness roadmap makes the generated Starlight Markdown reports durable by
committing them to Git, then publishing them through the docs site.

`.github/workflows/doc-freshness.yml` already writes:

- `packages/docs/src/content/docs/analytics/pageviews.md`
- `packages/docs/src/content/docs/analytics/freshness.md`

and commits those files when they change. The separate docs deployment workflow,
`.github/workflows/deploy-docs.yml`, deploys on `push` events that touch `packages/docs/**`.

GitHub Actions does not create normal recursive workflow runs from events caused by the repository
`GITHUB_TOKEN`, except for explicit `workflow_dispatch` and `repository_dispatch` events. GitHub
documents this behavior in
[Triggering a workflow](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow).
That means a generated report commit pushed by `doc-freshness.yml` will not automatically trigger
the existing docs deploy workflow via its `push` trigger.

## Decision

Keep `deploy-docs.yml` as the single docs publishing workflow, but explicitly dispatch it from
`doc-freshness.yml` after generated report commits.

`doc-freshness.yml` now:

1. commits generated analytics Markdown when `packages/docs/src/content/docs/analytics` changes
2. records whether a commit was pushed through the `commit-reports` step output
3. calls `gh workflow run deploy-docs.yml --ref main` only when a generated report commit was pushed
4. applies the freshness gate after the dispatch so critical reports are still committed and queued
   for publication

The job grants `actions: write` so the repository token can dispatch the deployment workflow, and
keeps `contents: write` for committing generated reports.

## Non-Goals

- Do not merge the docs deploy jobs into `doc-freshness.yml`.
- Do not introduce a personal access token or GitHub App token for this slice.
- Do not dispatch the docs deploy workflow when generated reports are unchanged.
- Do not add PR comments, issue creation, or check annotations yet.

## Alternatives Considered

### Rely on the generated commit's `push` event

- Pros: no extra workflow step.
- Cons: does not work with commits pushed by `GITHUB_TOKEN`.
- Rejected.

### Deploy Pages directly from `doc-freshness.yml`

- Pros: no second workflow dispatch.
- Cons: duplicates the docs deployment pipeline and splits publishing behavior across workflows.
- Rejected for this slice.

### Use a PAT or GitHub App token for the generated commit

- Pros: the generated commit could trigger the existing `push` workflow naturally.
- Cons: adds another secret and a broader operational surface than the MVP needs.
- Rejected for now.

### Dispatch the existing docs deploy workflow

- Pros: preserves one deployment workflow while making generated report publication explicit.
- Cons: requires `actions: write` permission on the freshness job.
- Accepted.

## Implementation Plan

1. Update `.github/workflows/doc-freshness.yml`:
   - add `actions: write` permission to `check-freshness`
   - add `id: commit-reports` to the generated report commit step
   - write `committed=true` or `committed=false` to `$GITHUB_OUTPUT`
   - add a conditional `Dispatch docs deploy` step using `gh workflow run deploy-docs.yml --ref main`
2. Keep `.github/workflows/deploy-docs.yml` unchanged so it remains the publishing entry point.
3. Keep generated report artifacts under `packages/docs/src/content/docs/analytics`.

## Verification

- [x] `.github/workflows/doc-freshness.yml` grants `actions: write` and `contents: write`.
- [x] The commit step emits `steps.commit-reports.outputs.committed`.
- [x] The docs deploy dispatch runs only when `committed == 'true'`.
- [x] `.github/workflows/doc-freshness.yml` parses as valid YAML.
- [x] `bun run --cwd packages/docs build` passes with generated analytics pages present.
- [x] Markdown lint was attempted; the repo-level run still fails on existing Starlight
  frontmatter/H1 conventions across prior docs, not on this workflow change.

## Consequences

- Generated freshness reports keep a Git history.
- The existing docs deployment workflow remains the only publishing workflow.
- A freshness run with critical findings can still commit and dispatch the public report before the
  freshness gate fails the job.
- Future feedback features can build on this by adding issue creation, PR comments, or check
  annotations without changing the report publication path.
