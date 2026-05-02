# ADR-001: Bun monorepo with agents/* workspace layout

## Status

Accepted

## Date

2026-05-02

## Context

We need to host multiple autonomous agents that share tooling (linter, type checker, test runner) but have independent dependencies, entry points, and deployment units. The project is expected to grow — a doc-freshness agent is the first, but others (e.g., link-checker, changelog agent) are planned.

Key requirements:

- Each agent must be independently deployable
- Shared devDependencies (Biome, tsgo, Effect, knip) should not be duplicated per-agent
- The Flue framework expects each agent to be a self-contained package with its own `.flue/` directory
- Fast install and test times

## Decision

Use Bun as the package manager and runtime with `workspaces: ["agents/*"]` at the root. Each agent lives in `agents/<name>/` as its own package with its own `package.json`.

## Alternatives Considered

### pnpm monorepo

- Pros: Mature, battle-tested, strict hoisting model
- Cons: The Flue reference project (`flue-main`) already uses pnpm; a second pnpm workspace for our agents would create confusing nested workspace semantics. Bun is the runtime for agent code (Bun's `spawn`, `test`, native TS execution).
- Rejected: Bun monorepo is simpler and consistent with the runtime choice.

### Single flat package

- Pros: Simplest setup, no workspace overhead
- Cons: All agents share one `node_modules` lock, one `package.json`; can't deploy agents independently; Flue's per-agent `.flue/` convention is awkward without package boundaries.
- Rejected: Does not scale past one agent.

### Turborepo / Nx

- Pros: Build caching, task pipelines
- Cons: Overhead for a small project; Bun's workspace support is sufficient at this scale.
- Rejected: Premature complexity.

## Consequences

- `flue-main/` is excluded from Bun workspaces (it has its own pnpm workspace) and from `.gitignore`.
- `@flue/sdk` is resolved from npm (`^0.3.6`) not from `flue-main/`, because Bun cannot mix workspace managers.
- Each agent package has its own `test`, `typecheck` scripts; root scripts delegate via `bun run --filter '*'`.
- Adding a new agent = `mkdir agents/<name>` + `package.json` with name `@doc-agent/<name>`.
