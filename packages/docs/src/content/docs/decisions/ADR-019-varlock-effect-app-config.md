---
title: "ADR-019: Varlock and Effect AppConfig"
---

# ADR-019: Varlock and Effect AppConfig

## Status

Accepted

## Date

2026-05-03

## Context

The doc-freshness workflow has accumulated environment configuration in several places:

- GitHub Actions `env:` blocks in `.github/workflows/doc-freshness.yml`
- direct `process.env` reads in `agents/doc-freshness/.flue/agents/doc-freshness.ts`
- direct `process.env` reads in `agents/doc-freshness/scripts/sync-github-freshness-issues.ts`
- `.env.example`, which currently documents only `OPENAI_API_KEY`
- older ADR text that treats `.env.example` as the source of truth

This has already caused confusion around `ODS_SITE_ID` and `ONE_DOLLAR_STATS_API_KEY`. It also
makes it easy for future agents to introduce new direct environment reads without a typed contract.

Varlock fits the repo as the external environment contract:

- `.env.schema` is safe to commit and gives agents variable names, types, sensitivity, defaults,
  and docs without revealing secret values.
- `varlock load` validates configuration in local development and CI.
- `varlock run -- <command>` injects resolved, validated environment variables into app and script
  startup.
- Varlock can be used without importing it into application code.

Effect fits the in-app typed configuration layer:

- `Config` provides typed loading and validation.
- `Config.redacted` keeps secrets represented as `Redacted.Redacted<string>`.
- `Context.Service` plus `Layer` gives tests a clean override seam in the Effect beta version this
  repo uses.

## Decision

Adopt Varlock for repository-level environment schema and validation, and Effect `Config` for
in-application typed configuration.

The rules are:

- Direct `process.env` access is banned outside `src/config/*` and thin script/workflow boundary
  adapters.
- Runtime application entry points must be started with `varlock run -- ...`.
- CI must run `varlock load` before build/test steps that depend on environment configuration.
- Keep Varlock outside application code unless there is a strong reason to use `varlock/auto-load`.
- Expose a single `AppConfig` Effect service.
- Secrets must use `Config.redacted`.
- Tests must override config with `Layer.succeed(AppConfig, ...)`, not real environment variables.

For this repo, the initial `AppConfig` should model the environment we actually use:

```ts
export type AppEnv = "development" | "preview" | "production" | "test";

export interface AppConfigShape {
  readonly appEnv: AppEnv;
  readonly openAiApiKey: Redacted.Redacted<string>;
  readonly githubToken: Redacted.Redacted<string>;
  readonly githubRepository: string;
  readonly githubRef: string;
  readonly githubSha: string;
  readonly oneDollarStatsApiKey: Redacted.Redacted<string>;
  readonly odsSiteId: string;
  readonly publicOdsSiteId: string;
  readonly pageviewThreshold: number;
  readonly docsBasePath: string;
}
```

Do not add `DATABASE_URL` or `SESSION_SECRET` until the repo has a database or session feature.
When those features arrive, add them to the Varlock schema and `AppConfig` in the same slice.

The generic sample shape below is accepted as the pattern for future app/server packages, but not as
the initial doc-freshness contract because unused required secrets would create unnecessary CI and
local setup failures:

```ts
export class AppConfig extends Context.Service<AppConfig, AppConfigShape>()(
  "AppConfig",
) {}

export const AppConfigLive = Layer.effect(AppConfig, loadAppConfig);
```

## Varlock Schema Plan

Add a committed root `.env.schema` with non-secret defaults and sensitive markers. Use
`@defaultSensitive=false` so agents can inspect public config while explicit secrets remain hidden.

Initial variables:

```dotenv
# @defaultSensitive=false
# ---

# @type=enum(development, preview, production, test)
APP_ENV=development

# @sensitive @required @type=string(startsWith=sk-)
OPENAI_API_KEY=

# @sensitive @required @type=string
ONE_DOLLAR_STATS_API_KEY=

# @required @type=string
ODS_SITE_ID=

# @type=string
PUBLIC_ODS_SITE_ID=

# @sensitive @type=string
GH_TOKEN=

# @type=string
GITHUB_TOKEN=

# @required @type=string
GITHUB_REPOSITORY=

# @type=string
GITHUB_REF_NAME=

# @type=string
GITHUB_SHA=

# @type=number(min=1, isInt=true)
PAGEVIEW_THRESHOLD=50

# @type=string
DOCS_BASE_PATH=/flue-doc-agent
```

The exact Varlock decorator syntax should be checked against the installed Varlock version during
implementation. The intended contract is more important than the textual schema syntax in this ADR.

## Implementation Plan

### Slice 1: Schema and dependency

1. Add Varlock as a dev dependency at the root package.
2. Add `.env.schema` at the repository root.
3. Replace or reduce `.env.example` so it points to `.env.schema` as the contract.
4. Add package scripts:
   - `env:check`: `varlock load --show-all`
   - `env:run`: documentation-only pattern for `varlock run -- ...`
5. Update `README.md` and `packages/docs/README.md` with local run examples.

### Slice 2: Effect AppConfig

1. Add `agents/doc-freshness/src/config/AppConfig.ts`.
2. Implement `AppConfigShape`, `AppConfig`, and `AppConfigLive` with Effect `Config`.
3. Use `Config.redacted` for:
   - `OPENAI_API_KEY`
   - `ONE_DOLLAR_STATS_API_KEY`
   - `GH_TOKEN` / `GITHUB_TOKEN`
4. Keep public values as normal typed fields:
   - `ODS_SITE_ID`
   - `PUBLIC_ODS_SITE_ID`
   - `GITHUB_REPOSITORY`
   - `GITHUB_REF_NAME`
   - `GITHUB_SHA`
   - `PAGEVIEW_THRESHOLD`
   - `DOCS_BASE_PATH`
5. Use `Config.withDefault` for safe defaults such as `APP_ENV`, `PAGEVIEW_THRESHOLD`, and
   `DOCS_BASE_PATH`.

### Slice 3: Remove direct environment reads

1. Replace direct `process.env` reads in `agents/doc-freshness/.flue/agents/doc-freshness.ts` with
   `AppConfig`.
2. Move script-only GitHub Actions reads in
   `agents/doc-freshness/scripts/sync-github-freshness-issues.ts` behind
   `agents/doc-freshness/src/config/GithubActionsConfig.ts` or another `src/config/*` boundary.
3. Add a lint or `rg` CI guard that fails on `process.env` outside:
   - `agents/doc-freshness/src/config/**`
   - `.github/workflows/**`
   - committed ADR/documentation examples
4. Keep workflow shell interpolation (`${{ secrets.* }}`, `${{ github.* }}`) in GitHub Actions;
   Varlock validates those names but does not replace GitHub secret storage.

### Slice 4: CI and startup

1. Run `varlock load --show-all` after dependency installation in:
   - `.github/workflows/doc-freshness.yml`
   - `.github/workflows/deploy-docs.yml`
2. Wrap app/script startup that needs env with `varlock run -- ...` where practical.
3. Prefer running Varlock from the repository root because Varlock reads `package.json` config from
   the current working directory.
4. Use `--path` explicitly for subpackage commands if a future package gets its own schema.

### Slice 5: Tests

1. Add `agents/doc-freshness/src/__tests__/AppConfig.test.ts`.
2. Test config consumers with `Layer.succeed(AppConfig, testConfig)`.
3. Do not mutate real environment variables in tests.
4. Add a smoke test or script check for the `process.env` ban.

## Improvements to the Proposed Sample

- Keep the sample pattern, but make the initial config shape repo-specific. Do not require
  `DATABASE_URL` or `SESSION_SECRET` before those features exist.
- Treat `PUBLIC_*` values as public. They should not be `Redacted`.
- Keep `GH_TOKEN` redacted even though GitHub also exposes `GITHUB_TOKEN`; both represent secrets.
- Add `DOCS_BASE_PATH` so ODS route mapping does not hardcode `/flue-doc-agent`.
- Add `PAGEVIEW_THRESHOLD` to config rather than keeping it only in workflow input plumbing.
- Avoid `varlock/auto-load` for now. It is useful when a framework controls startup, but this repo
  can use `varlock run -- ...` explicitly.
- Put script boundary environment access behind `src/config/*`, even when the script is small, so
  the `process.env` ban stays enforceable.

## Alternatives Considered

### Keep `.env.example` and direct `process.env`

- Pros: no new dependency and no migration work.
- Cons: drift-prone, untyped, and unsafe for agents to reason about; repeats the ODS naming
  confusion that already happened.
- Rejected.

### Use Varlock directly in application code with `varlock/auto-load`

- Pros: minimal command changes; useful when startup is not under our control.
- Cons: couples application modules to Varlock and duplicates Effect Config responsibility.
- Rejected for now.

### Use only Effect Config

- Pros: typed in application code.
- Cons: does not provide an AI-safe committed schema, external validation before startup, or CI
  environment graph visibility.
- Rejected.

### Varlock at boundary plus Effect AppConfig in code

- Pros: clear separation. Varlock resolves and validates env before boot; Effect loads typed values
  into app layers.
- Cons: two contracts must stay aligned.
- Accepted.

## Verification

- [x] `.env.schema` is committed and documents all runtime variables.
- [x] `varlock load --show-all` passes locally with expected non-secret defaults.
- [x] CI runs `varlock load` before doc-freshness and docs build/test steps.
- [x] Runtime commands that need env use `varlock run -- ...`.
- [x] `agents/doc-freshness/src/config/AppConfig.ts` exposes one `AppConfig` service.
- [x] Secrets in `AppConfigShape` use `Redacted.Redacted<string>`.
- [x] Tests use `Layer.succeed(AppConfig, ...)` for config overrides.
- [x] `rg "process\\.env" agents/doc-freshness --glob "!src/config/**"` has no app-code matches
  after excluding docs, workflows, and historical ADR examples.
- [x] `bun run --cwd agents/doc-freshness typecheck` passes.
- [x] `bun run --cwd agents/doc-freshness test:all` passes.
- [x] `bun run --cwd packages/docs build` passes.

## Consequences

- ADR-008 remains correct about the selected OpenAI model, but its `.env.example` contract is
  superseded by this ADR.
- Future agents can inspect `.env.schema` safely without seeing secret values.
- Environment validation moves earlier: local and CI runs should fail before app boot when required
  configuration is missing or malformed.
- App code becomes easier to test because configuration is a normal Effect service.
