---
title: "ADR-010: Biome + linteffect for formatting and linting"
---

# ADR-010: Biome + linteffect for formatting and linting

## Status

Accepted

## Date

2026-05-02

## Context

The project needs consistent formatting and linting across all TypeScript files. Given ADR-003 (Effect as core language), Effect-specific lint rules are also desirable to enforce idiomatic usage (no raw try/catch inside Effect programs, no async functions in Effect generators, no if/switch statements where pattern matching should be used, etc.).

## Decision

- **Formatter + linter**: Biome (`@biomejs/biome ^2.0.0`) — single tool for both; tabs, 100-char line width
- **Effect lint rules**: `@catenarycloud/linteffect` (`0.0.4-1`) — a set of `.grit` Biome plugin rules enforcing Effect idioms
- **Configuration**: `biome.jsonc` at the workspace root; all 38 Effect `.grit` rules referenced individually by path (Biome v2 requires explicit paths)
- **TypeScript language service**: `@effect/language-service` registered as a TypeScript plugin in `tsconfig.json` for IDE-level Effect hints
- **Dead code**: `knip` (`^6.9.0`) for unused exports detection

## Alternatives Considered

### ESLint + Prettier

- Pros: Industry standard; large plugin ecosystem
- Cons: Two tools (format + lint); slow; `eslint-plugin-effect` exists but is less comprehensive than linteffect's `.grit` rules; configuration complexity.
- Rejected: Biome replaces both with faster performance and simpler config.

### Biome without linteffect

- Pros: Simpler
- Cons: No Effect-specific rule enforcement; allows anti-patterns like `async` functions inside Effect generators or raw `try/catch` where `Effect.tryPromise` should be used.
- Rejected: The linteffect rules are the primary reason for the combination.

## Consequences

- `biome.jsonc` must list every `.grit` rule by explicit path — the Biome v2 plugin system does not support wildcard glob loading. Adding new `linteffect` rules requires updating `biome.jsonc`.
- `bun run check` runs `biome check --write .` (lint + format + fix).
- The `linteffect` package version (`0.0.4-1`) is pinned because the rules are pre-release; update with care.
- `@typescript/native-preview` (`tsgo`) is used instead of `tsc` — it is the Go-based TypeScript implementation providing faster type-checking; `bun run typecheck` invokes it via `tsgo --noEmit`.
