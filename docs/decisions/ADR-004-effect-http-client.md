# ADR-004: effect/unstable/http over raw fetch for HTTP requests

## Status

Accepted

## Date

2026-05-02

## Context

The `check-url` tool in the doc-freshness agent needs to make HTTP HEAD requests to validate external links. Given ADR-003 (Effect as core language), the HTTP client must compose with Effect's type system: errors in the typed error channel, cancellation via `AbortSignal` from Effect's runtime, and timeout as an Effect operation rather than a platform-specific API.

A reference implementation was available from another project (`@aab/bsdata/BSDataFetcher`) demonstrating the exact pattern.

## Decision

Use `effect/unstable/http` (`HttpClient`, `HttpClientRequest`, `HttpClientResponse`, `HttpClientError`, `FetchHttpClient`) for all HTTP in this project.

The service (`UrlChecker`) wraps the Effect HTTP client behind a domain interface, acting as an anti-corruption layer (see ADR-006). The `FetchHttpClient.layer` is provided only at the composition root (`UrlCheckerDefault`) so tests can substitute a mock `HttpClient` without touching the network.

## Alternatives Considered

### Raw `fetch` with try/catch

- Pros: No extra dependency, universal
- Cons: Errors are `unknown`; does not compose with Effect's typed error channel; `AbortSignal` for timeout is manual boilerplate; cannot be substituted in tests without module patching.
- Specifically rejected by the user: "we'll use effect's http client never raw fetch".

### axios

- Pros: Popular, interceptors, good error types
- Cons: Not Effect-native; would require an Effect wrapper anyway; adds a dependency that `effect/unstable/http` replaces.
- Rejected: Redundant given the Effect commitment.

### node-fetch / undici

- Pros: Node.js native performance
- Cons: Same objections as raw `fetch`.
- Rejected: Same reasons.

## Consequences

- `effect/unstable/http` is explicitly marked unstable — the API will change when it graduates. This is high-volatility coupling (see balanced-coupling analysis).
- `UrlChecker.ts` is the sole import point for `effect/unstable/http` in production code. When the module is renamed/stabilised, one file changes.
- Tests also import `effect/unstable/http` for mock construction — this is a known coupling risk tracked in the balanced-coupling analysis. Mitigation: extract to `src/__tests__/mock-layers.ts` (planned).
- `HttpClient.followRedirects()` is applied globally in `UrlChecker.make` — redirected URLs return the final status, not 301/302.
- No `filterStatusOk` — 4xx/5xx are returned as status strings, not errors, because our domain cares about the status code value.
