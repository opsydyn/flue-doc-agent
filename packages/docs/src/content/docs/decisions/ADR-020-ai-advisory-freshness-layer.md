---
title: "ADR-020: AI advisory layer for documentation freshness"
---

## Status

Accepted

## Date

2026-05-03

## Context

ADR-015 made freshness scoring deterministic, and the 2026-05-03 CI hardening moved the default
freshness run to an in-process Effect pipeline. That made the workflow stable: the gate no longer
depends on a model obeying Flue result extraction semantics, and the generated report can state that
the audit itself used zero model tokens.

The deterministic audit is intentionally conservative. It answers questions such as:

- Which markdown files exist?
- Which code paths are explicitly referenced by a document?
- Which referenced files changed after the document?
- Which links are broken or unreachable?
- Which documents cross the page-view threshold for critical priority?

Those facts are reproducible, but they are not always enough to guide a maintainer. A code file can
change without invalidating the prose. A stale candidate may need a one-line note, a full rewrite, or
no action at all. The workflow also now has room to use model calls safely because the gate remains
code-driven.

We want AI to improve the usefulness of the report without making the freshness gate brittle again.

## Decision

Add an AI advisory layer after the deterministic freshness pass.

The deterministic pipeline remains authoritative for:

- `fresh | warning | stale`
- `critical | medium | low`
- summary counts
- `shouldFail`
- GitHub Actions annotations
- the final CI gate

AI is advisory and may enrich stale/warning candidates with:

- semantic impact
- false-positive likelihood
- rationale
- affected sections
- suggested fixes
- top risks
- top next actions
- issue body drafts
- patch proposals
- a light-hearted project voice for PR comments
- implicit doc/code relationship suggestions

Every AI feature must record model provenance and token usage separately. The report must make it
clear which fields are deterministic and which fields are AI-authored.

## Advisory Types

### Semantic impact review

For each deterministic stale or warning candidate, the AI advisory layer should produce a validated
record with this shape:

```ts
type SemanticImpactReview = {
  readonly path: string
  readonly semanticImpact: "none" | "low" | "medium" | "high"
  readonly confidence: "low" | "medium" | "high"
  readonly staleClassification: "real-stale" | "needs-review" | "probably-harmless"
  readonly rationale: string
  readonly affectedSections: ReadonlyArray<string>
  readonly suggestedFixes: ReadonlyArray<string>
}
```

Definitions:

- `real-stale` — the doc is likely wrong or materially incomplete.
- `needs-review` — code changed and impact is plausible, but the model cannot prove the prose is
  wrong.
- `probably-harmless` — the referenced file changed, but the visible documentation claim is likely
  still valid.

The model may not change the deterministic `status`, `priority`, or `shouldFail` values. It can only
add advisory context.

### AI feature provenance

Every model-backed feature should append provenance like this:

```ts
type AiFeatureProvenance = {
  readonly feature:
    | "executive-summary"
    | "docs-librarian-pick"
    | "semantic-impact"
    | "implicit-relationships"
    | "issue-body"
    | "patch-proposal"
    | "pr-comment"
  readonly source: "openai" | "fallback"
  readonly provider: "openai" | "none"
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly itemCount: number
  readonly generatedAt: string
  readonly note?: string
}
```

The freshness page should eventually render a provenance table instead of a single inline sentence.

## Ranking and the Docs Librarian

Introduce a project-specific **Docs Librarian** persona for generated commentary. This is an
original house voice: calm, practical, scholarly, dryly funny, protective of documentation, and
lightly banana-adjacent. It must not imitate or name any copyrighted character, quote catchphrases,
or rely on another author's distinctive prose.

The Docs Librarian chooses exactly one top recommendation for high-touch output, such as a PR patch
proposal or PR comment. The choice should combine deterministic statistics with AI advisory
judgement.

### Ranking inputs

Use a transparent scoring model so the recommendation can be explained:

```ts
type AdvisoryRanking = {
  readonly path: string
  readonly deterministicPriority: "critical" | "medium" | "low"
  readonly pageViews30d: number
  readonly staleClassification: "real-stale" | "needs-review" | "probably-harmless"
  readonly semanticImpact: "none" | "low" | "medium" | "high"
  readonly confidence: "low" | "medium" | "high"
  readonly statsScore: number
  readonly aiImpactScore: number
  readonly finalScore: number
  readonly reason: string
}
```

Initial scoring proposal:

| Signal | Points |
| --- | ---: |
| deterministic `critical` | +40 |
| deterministic `medium` | +25 |
| deterministic `low` stale/warning | +10 |
| 30-day views, normalized among candidates | 0..25 |
| semantic impact `high` | +20 |
| semantic impact `medium` | +12 |
| semantic impact `low` | +5 |
| classification `real-stale` | +15 |
| classification `needs-review` | +6 |
| classification `probably-harmless` | -10 |
| confidence `high` | +8 |
| confidence `medium` | +4 |
| confidence `low` | +0 |

The report should show the top three risks and top three next actions. The Docs Librarian should
select the highest `finalScore` candidate for one focused recommendation.

## Report Additions

The freshness page should grow these sections:

1. **Executive Summary**
   - Gate status.
   - Top three risks.
   - Top three next actions.
   - One sentence for maintainers.
   - Trend versus previous run if available.

2. **AI Advisory Review**
   - Table of stale/warning candidates.
   - Deterministic status and priority.
   - AI classification.
   - Semantic impact.
   - Confidence.
   - Suggested fixes.

3. **Docs Librarian's Pick**
   - The top-ranked candidate.
   - Why it was chosen.
   - A short, light-hearted maintainer-facing note in the original Docs Librarian voice.

4. **AI Provenance**
   - One row per AI feature.
   - Model, provider, token counts, item counts, and timestamp.

## Issue Bodies

The issue sync step should remain deterministic about whether an issue exists, but AI may generate
better issue bodies for selected candidates.

Each AI issue body should include:

- why the document matters
- deterministic stale/warning evidence
- affected code files and commit dates
- AI semantic impact and confidence
- suggested owner/action
- links to source files and relevant commits when available
- provenance footer

Issue body generation must be idempotent. The hidden marker used by
`sync-github-freshness-issues.ts` remains deterministic and stable.

## Patch Proposals and PR Comments

Patch proposals are the highest-value next feature, but they must be non-blocking.

For high-confidence, high-impact candidates, AI may generate a patch proposal that:

- updates stale paragraphs
- adds missing references
- fixes broken internal links
- updates examples
- marks uncertain changes as TODO comments
- includes rationale and provenance

The workflow should not auto-merge AI patches. The safest initial form is a generated artifact or
markdown section. A later slice may open a draft PR.

If a draft PR is opened, the Docs Librarian should add one concise PR comment:

- name the selected top-ranked document
- explain why it was selected using stats plus advisory judgement
- summarize the proposed fix
- keep the tone light, practical, and protective of the docs
- avoid imitating any named fictional character or copyrighted voice

## Implicit Doc/Code Relationships

The current parser finds explicit path references. AI can help discover implicit relationships, such
as a document discussing `UrlChecker` without naming every source file.

This feature should be advisory and should not directly create stale evidence until confirmed by
code:

1. Generate candidate doc/code relationships from document text, headings, frontmatter, and code
   symbols.
2. Ask AI to explain why the relationship exists.
3. Validate candidate paths exist.
4. Fetch deterministic GitHub history for confirmed paths.
5. Mark relationships as `explicit` or `implicit-ai-suggested` in provenance.

Implicit relationships should start as report enrichment. They can become scoring inputs only after
we have tests and enough history to trust them.

## Trend Detection

Trend data should be computed before asking AI to summarize it.

Preferred implementation:

1. Commit a small machine-readable `freshness-snapshot.json` artifact under the analytics content
   directory or another generated-report location.
2. On each run, read the previous committed snapshot from Git history when available.
3. Compute deterministic deltas:
   - total stale count change
   - warning count change
   - critical count change
   - documents newly stale
   - documents resolved
   - page-view changes for attention items
4. Pass those deltas to the executive-summary prompt.

If no previous snapshot exists, the report should say trend is unavailable.

## Implementation Plan

### Slice 1: Advisory schemas and provenance

- Add domain types and schemas for semantic reviews, rankings, top risks, top actions, and AI
  provenance.
- Add tests for schema decoding and ranking calculations.
- Extend the generated freshness result or report-writer input with optional advisory data.
- Render a provenance table in the freshness page.

### Slice 2: Semantic impact review

- Add a script or service that receives deterministic stale/warning candidates.
- Call a non-reasoning model with a strict JSON schema.
- Use `gpt-4.1-mini` for semantic review by default.
- Retry or fall back to `needs-review` when the model output fails validation.
- Store token usage per run.

### Slice 3: Top risks, next actions, and librarian pick

- Implement deterministic ranking from statistics plus AI impact/confidence.
- Render top three risks and top three next actions.
- Select exactly one `Docs Librarian's Pick` from the highest-ranked candidate.
- Generate a short project-voice recommendation with provenance.

### Slice 4: AI issue body drafts

- Extend issue sync to optionally use AI-generated issue bodies.
- Keep issue creation/update decisions deterministic.
- Preserve stable hidden markers.
- Include evidence, affected code, suggested action, and provenance.

### Slice 5: Patch proposal artifacts

- Generate a patch proposal for the librarian pick when confidence is high and impact is medium or
  high.
- Start with markdown artifacts in the freshness report or GitHub workflow summary.
- Do not write to source docs automatically in this slice.

### Slice 6: Draft PR workflow

- Generate a draft PR recommendation only when the patch proposal validates cleanly.
- Do not open a PR automatically in the first implementation; keep the recommendation as a report
  artifact for human review or a later workflow step.
- Add one light-hearted Docs Librarian PR comment draft.
- Require human review before merge.
- Include provenance and model usage in the recommendation artifact.

### Slice 7: Implicit relationships

- Add an advisory implicit relationship generator.
- Validate paths and history deterministically.
- Render relationships separately from explicit evidence.
- Decide later whether implicit relationships can influence priority.

## Implementation Notes

Implemented on 2026-05-04 as a non-blocking advisory pipeline:

- `generate-ai-advisory.ts` reads the deterministic freshness JSON, calls `gpt-4.1-mini` for
  semantic impact and patch-proposal artifacts when `OPENAI_API_KEY` is available, and otherwise
  writes deterministic fallback advisory JSON.
- Issue body drafts are optional input to `sync-github-freshness-issues.ts`. The create/update/no-op
  decision still comes from deterministic critical freshness evidence and stable hidden markers.
- Patch proposals and draft PR recommendations are report/workflow-summary artifacts only. The
  workflow does not mutate documentation files, open PRs, or merge AI-authored text.
- Implicit relationships start with a deterministic low-confidence scanner over validated repository
  paths. They are rendered separately from explicit freshness evidence and do not affect priority,
  annotations, issue decisions, or `shouldFail`.
- `write-starlight-reports.ts` renders AI issue body drafts, patch proposal artifacts, draft PR
  recommendations, implicit relationships, and one provenance row per generated feature.

## Model Strategy

Use non-reasoning models until provider/session persistence behavior is better understood:

- `gpt-4.1-nano` for executive summaries and short comments.
- `gpt-4.1-mini` for semantic impact review and patch proposals.
- Avoid reasoning models in the CI path until the Responses API storage/reasoning-item issue is
  resolved.

## Consequences

Positive:

- The gate remains stable and auditable.
- Reports become more actionable.
- Maintainers get suggested fixes instead of raw stale evidence only.
- Token usage is transparent per AI feature.
- The project can experiment with AI value without reintroducing brittle CI failures.

Negative:

- More generated data to validate and render.
- More OpenAI cost, especially for semantic review and patches.
- More prompt/schema maintenance.
- AI advisory data may be wrong and must be labelled clearly.

## Verification

- Deterministic freshness tests still pass.
- Advisory schemas reject malformed model output.
- Ranking tests prove the top pick is reproducible for fixed inputs.
- A no-API-key run produces deterministic fallbacks.
- A model-backed run records token usage per feature.
- The freshness page clearly separates deterministic audit facts from AI advisory text.
- Issue sync remains idempotent.
- Patch proposal generation never auto-merges source doc changes.
