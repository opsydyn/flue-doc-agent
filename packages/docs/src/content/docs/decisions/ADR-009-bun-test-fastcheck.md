---
title: "ADR-009: Bun test runner + FastCheck property-based testing"
---

# ADR-009: Bun test runner + FastCheck property-based testing

## Status

Accepted

## Date

2026-05-02

## Context

Tests are needed for Effect services (particularly `UrlChecker`) that involve:

- Layer substitution (mock `HttpClient`)
- Typed error assertions
- Behavioral invariants across arbitrary inputs

We need a test runner compatible with Bun (the project runtime per ADR-001) and a property testing library that integrates with Effect.

## Decision

- **Test runner**: `bun test` (built into Bun, zero configuration, TypeScript-native)
- **Property testing**: `effect/testing/FastCheck` — Effect's re-export of `fast-check` (`fc.*`)
- **File conventions**:
  - `*.test.ts` — example-based tests (concrete inputs, `describe`/`test`/`expect`)
  - `*.property.ts` — property-based tests (arbitrary inputs, `FastCheck.assert` + `FastCheck.asyncProperty`)
- **Types**: `bun-types` provides `bun:test` module declarations; registered via `/// <reference types="bun-types" />` in `src/__tests__/globals.d.ts`

## Alternatives Considered

### Vitest

- Pros: Excellent `@effect/vitest` integration, `it.effect` sugar
- Cons: Requires its own runtime (vite); adds build tooling Bun already replaces; `@effect/vitest` is not needed since we bridge to promises via `Effect.runPromise` in tests.
- Rejected: Bun is already the runtime; `bun test` is sufficient without extra tooling.

### Jest

- Pros: Industry standard
- Cons: Slow, requires Babel/ts-jest for TypeScript; no native ESM support; Bun's `bun test` is a compatible drop-in.
- Rejected: Superseded by `bun test` in a Bun project.

### fast-check directly (not via `effect/testing/FastCheck`)

- Pros: Direct dependency
- Cons: `effect/testing/FastCheck` is just a re-export; using it directly ties us to a specific `fast-check` version that may diverge from what Effect re-exports.
- Rejected: Use the Effect-managed re-export to stay in sync.

## Consequences

- Property tests revealed two real constraints during initial development (documented in `docs/postmortems/fastcheck-url-checker.md`):
  1. `HttpClient.make` validates URLs before invoking the mock — `fc.string()` is wrong for URL arbitraries; use `FastCheck.webUrl()`
  2. `new Response(null, { status: 100 })` throws — `Response` only accepts `101` or `200–599`
- `bun test ./src/__tests__/*.test.ts` runs example-based tests; `bun test ./src/__tests__/*.property.ts` runs property tests.
- `@types/bun` (DefinitelyTyped) re-exports `bun-types` via a triple-slash reference; `bun-types` must be listed explicitly in `package.json` to ensure it lands in `node_modules` rather than Bun's internal cache.
