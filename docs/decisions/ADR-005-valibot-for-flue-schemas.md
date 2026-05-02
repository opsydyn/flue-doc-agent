# ADR-005: Valibot for Flue result schemas, Effect Schema for domain validation

## Status

Accepted

## Date

2026-05-02

## Context

Two distinct schema needs exist in this project:

1. **Flue result extraction** — `session.skill('check-staleness', { result: schema })` requires a schema that Flue can use to parse the LLM's JSON output block. Flue's SDK types accept Valibot schemas specifically.

2. **Domain validation** — Input parsing, API contracts, and data shapes within Effect programs should use `effect/Schema` to stay in the Effect ecosystem (typed errors, composable with `Effect.gen`, no separate dependencies).

## Decision

- Use **Valibot** (`^1.0.0`) exclusively for Flue result schemas (the `result:` argument to `session.prompt/skill/task`).
- Use **`effect/Schema`** for all domain-level validation within Effect programs (input parsing, HTTP response decoding, etc.) — following the pattern in the `BSDataFetcher` reference (`Schema.Struct`, `Schema.Array`, `HttpClientResponse.schemaBodyJson`).
- Do not mix the two in the same layer: Valibot stops at the Flue boundary; Effect Schema starts on the other side.

## Alternatives Considered

### Effect Schema everywhere (including Flue result)

- Pros: Single schema library; consistent types
- Cons: Flue's `result:` type is typed as Valibot's `BaseSchema` — using Effect Schema would require a wrapper or type cast; we'd be fighting the framework's types.
- Rejected: The boundary is clean: Valibot is Flue's schema language.

### Zod everywhere

- Pros: Widely known
- Cons: Zod is not the schema library used by either Flue (Valibot) or Effect (its own Schema module). Using Zod would add a third schema library.
- Rejected: Redundant.

### Valibot everywhere

- Pros: Single library
- Cons: Valibot does not integrate with Effect's typed error channel or `Effect.gen`; using it inside Effect programs produces untyped `catch` blocks.
- Rejected: Inconsistent with ADR-003.

## Consequences

- `valibot` is a production dependency of each agent package; `effect` is also a production dependency.
- The split is enforced by convention: Valibot imports only appear in `.flue/agents/*.ts` handler files; Effect Schema imports only appear in `src/*.ts` service files.
- Flue result schemas (`resultSchema` in `doc-freshness.ts`) are the exact shape the LLM is instructed to produce — they must be kept in sync with the SKILL.md result block format.
