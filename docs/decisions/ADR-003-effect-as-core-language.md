# ADR-003: Effect (beta) as core language over raw async/await

## Status
Accepted

## Date
2026-05-02

## Context
Agent code involves: HTTP requests that can fail in multiple ways, service dependencies that should be injectable (for testing), error types that need to be explicit and structured, concurrency (checking multiple URLs in parallel), and timeout management. Raw `async/await` with `try/catch` handles these poorly: errors are untyped, dependencies are implicit globals, concurrent operations require manual `Promise.all`, and timeouts are a footgun.

## Decision
Use `effect` (beta, `4.0.0-beta.x`) as the core language for all non-agent-handler logic. Specifically:
- `Data.TaggedError` for all domain errors (typed, structured, pattern-matchable)
- `Context.Service` + `Layer` for all service definitions and dependency injection
- `Effect.fn` for named, traceable operations
- `Effect.gen` for sequential composition
- `effect/unstable/http` for HTTP (see ADR-004)
- `effect/testing/FastCheck` for property-based tests

The Flue agent handler (`doc-freshness.ts`) is the only file that uses raw `async/await` — it's the boundary where Effect is bridged to Flue via `Effect.runPromise`.

## Alternatives Considered

### Raw async/await throughout
- Pros: Simpler, no learning curve, familiar
- Cons: Errors are `unknown` at catch sites; no typed error channels; testing requires manual dependency injection via constructor arguments or module mocking (fragile); no structured concurrency; timeouts require `AbortController` boilerplate.
- Rejected: The codebase would accumulate the exact problems Effect solves, especially as service complexity grows.

### fp-ts
- Pros: Mature, stable, good TypeScript integration
- Cons: Abandoned (author moved to Effect); smaller ecosystem; less ergonomic `do`-notation compared to `Effect.gen`; no built-in HTTP client or testing utilities.
- Rejected: Effect is the maintained successor.

### Neverthrow / ts-results
- Pros: Lightweight typed errors
- Cons: Only solves the error channel problem; does not address DI, concurrency, HTTP, or testing. Would still need separate solutions for those concerns.
- Rejected: Partial solution; Effect solves the full set.

## Consequences
- All service modules (`src/*.ts`) are Effect programs; the Flue boundary (`Effect.runPromise`) is isolated to tool `execute` functions.
- `@effect/language-service` is registered as a TypeScript plugin for better IDE ergonomics.
- `linteffect` (Biome plugin, all `.grit` rules) enforces Effect idioms (no raw try/catch, no async in Effect context, etc.).
- `effect` beta is a runtime dependency — it must be kept current as the beta evolves.
- Tests use `Effect.provide(layer)` for dependency injection — no module mocking, no `jest.mock`.
