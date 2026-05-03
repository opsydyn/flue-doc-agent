---
title: "ADR-014: Typed Markdown pipeline for freshness evidence and reports"
---

# ADR-014: Typed Markdown pipeline for freshness evidence and reports

## Status

Accepted

## Date

2026-05-03

## Context

ADR-013 moved commit history out of prompt-driven shell commands and into a typed
`github-history` Flue tool. The next weak boundary is Markdown handling:

- The skill still asks the model to infer links and code references from Markdown text.
- Generated report helpers are `.mjs` files with loose JSON parsing and untyped inputs.
- Starlight docs are Markdown/MDX content collections, so the durable artifact should stay
  Markdown, but parsing and report generation need stronger contracts.
- The roadmap calls out `gray-matter` and Bun-run TypeScript scripts for this slice.

## Decision

Use `gray-matter` inside a typed `read-doc` Flue tool to parse Starlight Markdown files. Convert
the generated-report helper scripts from `.mjs` to `.ts` and run them with Bun in GitHub Actions.

The `read-doc` tool returns schema-encoded JSON with:

- `path`
- `frontmatter`
- `body`
- `internalLinks`
- `externalLinks`
- `codeReferences`

The Flue agent uses this parsed evidence for link checks and source-reference history checks. The
LLM remains responsible for judgement and report synthesis, but it should not manually parse raw
frontmatter or discover links from unstructured text when a deterministic tool can do that.

## Non-Goals

- Do not write freshness metadata into every source doc in this slice.
- Do not replace Starlight content collections.
- Do not add a local pure-JS git fallback.
- Do not remove Flue result extraction yet; only type the helper script.
- Do not make `gray-matter` responsible for route-to-source mapping.

## Alternatives Considered

### Continue manual Markdown parsing in the prompt

- Pros: no dependency.
- Cons: inconsistent extraction, high token use, no repeatable contract.
- Rejected.

### Use Starlight/Astro content collection internals

- Pros: aligns with the rendered site.
- Cons: harder to call from the Flue tool runtime; more coupling to Astro build internals.
- Deferred.

### Use `gray-matter`

- Pros: stable, small, directly parses frontmatter/body, common in Markdown tooling.
- Cons: link and reference extraction still needs local deterministic regexes.
- Accepted.

## Implementation Plan

1. Add `gray-matter` to `agents/doc-freshness` dependencies.
2. Add a `read-doc` Flue tool in `agents/doc-freshness/.flue/agents/doc-freshness.ts`.
3. Update `check-staleness/SKILL.md` to call `read-doc` for each markdown file.
4. Convert:
   - `agents/doc-freshness/scripts/extract-flue-json.mjs` to `.ts`
   - `agents/doc-freshness/scripts/write-starlight-reports.mjs` to `.ts`
5. Update `.github/workflows/doc-freshness.yml` to invoke the scripts with `bun`.
6. Keep the freshness result schema unchanged.

## Verification

- [x] `doc-freshness.ts` includes `read-doc` in the Flue tool list.
- [x] The staleness skill uses `read-doc` for Markdown evidence.
- [x] The workflow invokes TypeScript helper scripts with Bun.
- [x] No `.mjs` helper scripts remain in `agents/doc-freshness/scripts`.
- [x] `bun run --cwd agents/doc-freshness typecheck` passes.
- [x] Biome lint passes for changed TypeScript files.
- [x] `bun run --cwd packages/docs build` passes.

## Consequences

- `gray-matter` becomes a runtime dependency of the doc-freshness agent.
- Markdown evidence is more deterministic and easier for future agents to extend.
- The helper scripts can now be moved toward schema-checked inputs without another runtime switch.
- The remaining extraction script is still a compatibility layer for Flue CLI mixed output; it can
  be removed later if Flue exposes a clean structured result path.
