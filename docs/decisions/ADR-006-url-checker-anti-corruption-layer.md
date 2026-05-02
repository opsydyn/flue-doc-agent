# ADR-006: UrlChecker as anti-corruption layer for effect/unstable/http

## Status
Accepted

## Date
2026-05-02

## Context
The `check-url` tool must perform HTTP HEAD requests. Using `effect/unstable/http` directly (ADR-004) introduces **model coupling** to an explicitly unstable external API: `HttpClient.HttpClient`, `HttpClientRequest.head`, `HttpClientError.HttpClientError`, `HttpClientError.TransportError`. These types are internal Effect domain model types and will change when the module is stabilised.

If these types are imported directly in the agent handler or scattered across multiple files, every file becomes a change point when `effect/unstable/http` is renamed or refactored.

A balanced-coupling analysis (see `docs/balanced-coupling-analysis.md`) classified this as **Tight Coupling** (high strength + high distance + high volatility) requiring explicit containment.

## Decision
Encapsulate all `effect/unstable/http` imports within a single `UrlChecker` Effect service (`src/UrlChecker.ts`). This service:

1. Exposes only a stable domain interface: `check(url: string) => Effect<string, UrlCheckError>`
2. Translates all HTTP errors to `UrlCheckError` (a domain-owned tagged error) via `Effect.mapError`
3. Is the **sole import point** for `effect/unstable/http` in production code

The rest of the codebase (`doc-freshness.ts`, future agents) depends only on `UrlChecker` and `UrlCheckError` — never on Effect's HTTP types directly.

This is the **Anti-Corruption Layer** pattern from Domain-Driven Design: a translation layer that shields the domain from a volatile external model.

## Alternatives Considered

### Use effect/unstable/http directly in the tool execute function
- Pros: Less code, no intermediate layer
- Cons: The agent handler becomes coupled to `effect/unstable/http` internals; every `unstable` API change requires updating the handler; testability requires mocking at a lower level.
- Rejected: Creates the distributed change-point problem the ACL prevents.

### Separate the ACL into its own package
- Pros: Even stronger isolation
- Cons: Premature for a single agent; adds workspace overhead; the ACL is small (one file).
- Rejected: Overkill at this scale.

## Consequences
- When `effect/unstable/http` stabilises and renames, **only `UrlChecker.ts`** needs updating.
- `UrlCheckError` is the domain's error vocabulary for link-checking — callers use `Effect.catchTag("UrlCheckError", ...)` without knowing the underlying HTTP error type.
- Tests that need to mock HTTP use `src/__tests__/mock-layers.ts` — the single import point for `effect/unstable/http` in test code, mirroring this ACL pattern. Test files import only from `mock-layers.ts`; the unstable HTTP types are fully contained.
