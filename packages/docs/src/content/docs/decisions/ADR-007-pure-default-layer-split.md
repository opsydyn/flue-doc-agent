---
title: "ADR-007: Pure/Default layer split for Effect service testability"
---

# ADR-007: Pure/Default layer split for Effect service testability

## Status

Accepted

## Date

2026-05-02

## Context

Effect services that depend on external resources (HTTP clients, databases) need a way to substitute those dependencies in tests without module mocking. The naive approach — a single exported layer that wires everything together — forces tests to either hit the real network or monkey-patch modules.

`UrlChecker` depends on `HttpClient.HttpClient` (the Effect service tag) for its HTTP calls. The production implementation uses `FetchHttpClient.layer` to provide that dependency, but tests need a mock `HttpClient`.

## Decision

Export two layers from every Effect service:

- **`<Service>Layer`** — the "pure" layer: `Layer.effect(Service, make)`. Declares the service but leaves `HttpClient.HttpClient` (or other dependencies) unsatisfied. Tests provide their own implementation.
- **`<Service>Default`** — the "wired" layer: `<Service>Layer.pipe(Layer.provide(FetchHttpClient.layer))`. Production-ready; provides all dependencies. Used at the application entry point.

```typescript
export const UrlCheckerLayer   = Layer.effect(UrlChecker, make);            // pure
export const UrlCheckerDefault = UrlCheckerLayer.pipe(Layer.provide(FetchHttpClient.layer)); // wired
```

Tests compose their own test layer:

```typescript
const testLayer = UrlCheckerLayer.pipe(Layer.provide(mockHttpLayer(200)));
```

## Alternatives Considered

### Single `UrlCheckerDefault` layer, tests patch modules

- Pros: Less code to export
- Cons: Module patching (`jest.mock`, `vi.mock`) is fragile, couples tests to module identities, and breaks with bundlers. Against ADR-003 principle of Effect-native DI.
- Rejected: Violates the Effect DI model.

### Constructor injection (pass `HttpClient` as a parameter to `make`)

- Pros: Explicit dependency
- Cons: Effect's service model uses `Context.Service` + `Layer` for DI, not constructor parameters. Fighting the framework pattern.
- Rejected: Inconsistent with Effect idioms.

### Export `make` directly for tests to call

- Pros: Tests can call `make` with a mock environment
- Cons: Exposes internal implementation function; couples tests to the internal structure of the Effect generator.
- Rejected: `UrlCheckerLayer` is the right abstraction level.

## Consequences

- All services in `src/` follow the `<Service>Layer` / `<Service>Default` naming convention.
- Tests import `<Service>Layer`, never `<Service>Default`.
- The `doc-freshness.ts` handler imports `UrlCheckerDefault` (production wiring).
- When adding a new service, the pattern is: define `make`, export `<Service>Layer` and `<Service>Default`.
