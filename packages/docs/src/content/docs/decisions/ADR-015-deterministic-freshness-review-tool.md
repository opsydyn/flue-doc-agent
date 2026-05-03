---
title: "ADR-015: Deterministic freshness review tool"
---

# ADR-015: Deterministic freshness review tool

## Status

Accepted

## Date

2026-05-03

## Context

ADR-013 moved Git history lookup into `github-history`, and ADR-014 moved Markdown parsing into
`read-doc`. Phase 4 of the roadmap keeps the agentic review layer but asks us to make scoring
deterministic where possible.

Before this decision, the `check-staleness` skill asked the LLM to:

- assign `fresh`, `warning`, or `stale`
- combine stale/warning evidence with page-view demand
- assign priority
- compute summary counts
- decide `shouldFail`

That is too much arithmetic and branching to leave in prompt text. The model should gather
evidence and explain remediation, but the scoring contract should be repeatable and testable.

## Decision

Add a `review-freshness` Flue tool backed by a tested `FreshnessReview` domain module.

The agent must pass structured evidence to the tool:

```ts
type FreshnessReviewInputFile = {
  path: string
  lastDocCommit: string
  staleReasons: ReadonlyArray<string>
  warningReasons: ReadonlyArray<string>
  pageViews30d?: number
}
```

The tool deterministically returns:

- reviewed files with `status`, optional `priority`, `issues`, `lastDocCommit`, and optional
  `pageViews30d`
- summary counts
- `shouldFail`

The agent remains responsible for collecting evidence and producing the human-readable markdown
report from the reviewed domain values.

## Non-Goals

- Do not make the deterministic tool fetch GitHub history, parse Markdown, or check URLs.
- Do not remove the LLM from remediation explanation and report synthesis.
- Do not change the public freshness result schema in this slice.
- Do not introduce GitHub check annotations or PR comments in this slice.

## Alternatives Considered

### Keep scoring in the skill prompt

- Pros: no code change.
- Cons: inconsistent scoring, duplicated rules, no unit tests.
- Rejected.

### Make the tool produce the full markdown report

- Pros: completely deterministic report formatting.
- Cons: removes the agentic synthesis layer too early; Phase 4 still wants the agent to produce the
  human-readable report and remediation queue.
- Rejected for this slice.

### Deterministic review tool plus agent-authored report

- Pros: stable scoring and failure gate; still lets the agent explain why the reviewed docs matter.
- Cons: adds another tool contract the skill must follow.
- Accepted.

## Implementation Plan

1. Add `agents/doc-freshness/src/FreshnessReview.ts`.
2. Add tests for fresh, warning, stale-low, and stale-critical outcomes.
3. Add `review-freshness` to `agents/doc-freshness/.flue/agents/doc-freshness.ts`.
4. Update `agents/doc-freshness/.agents/skills/check-staleness/SKILL.md`:
   - collect `staleReasons` and `warningReasons`
   - call `review-freshness` once
   - use the returned `files`, `summary`, and `shouldFail` as authoritative
   - produce the final markdown `report`
5. Update `agents/doc-freshness/AGENTS.md` so future agents do not score priority manually.

## Verification

- [x] `review-freshness` is listed in the Flue tool list.
- [x] `check-staleness/SKILL.md` instructs the agent to call `review-freshness`.
- [x] `AGENTS.md` tells the agent not to score priority manually.
- [x] `bun test agents/doc-freshness/src/__tests__/FreshnessReview.test.ts` passes.
- [x] `bun run --cwd agents/doc-freshness test:all` passes.
- [x] `bun run --cwd agents/doc-freshness typecheck` passes.
- [x] Biome lint passes for the changed TypeScript files.
- [x] `bun run --cwd packages/docs build` passes.

## Consequences

- Status and priority scoring are now deterministic and tested.
- `shouldFail` is derived from the reviewed summary instead of model arithmetic.
- The agent has a narrower role: collect evidence, call deterministic tools, and explain the
  reviewed results.
- Future changes to priority policy belong in `FreshnessReview` tests first.
