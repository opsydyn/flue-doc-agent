# doc-agent

A Bun monorepo of autonomous agents built on the [Flue framework](https://flueframework.com/) using [Effect](https://effect.website/) as the core language.

The first agent — **doc-freshness** — checks markdown documentation for staleness by comparing git history against the source files each doc references, then scores results by reader demand using page-view analytics.

## Agents

| Agent | Description |
| --- | --- |
| [`agents/doc-freshness`](agents/doc-freshness/) | Detects stale docs, validates external links, scores by page views |

## Packages

| Package | Description |
| --- | --- |
| [`packages/docs`](packages/docs/) | Astro Starlight documentation site (GitHub Pages) |

## Monorepo layout

```text
doc-agent/
├── agents/
│   └── doc-freshness/          # Flue agent — staleness checker
│       ├── .flue/agents/       # Agent handler entry point
│       ├── src/                # Effect services (UrlChecker, …)
│       └── src/__tests__/      # bun test + FastCheck property tests
├── packages/
│   └── docs/                   # Astro Starlight site (source of truth for all docs)
│       └── src/content/docs/
│           ├── decisions/      # ADR-001 through ADR-012
│           ├── analysis/       # Balanced coupling analysis
│           ├── postmortems/    # Incident post-mortems
│           └── diataxis/       # Diátaxis documentation framework
├── .agents/skills/             # Shared agent skills (balanced-coupling, tdd, …)
└── flue-main/                  # Flue SDK source (excluded from Bun workspace)
```

## Development

All `bun` commands run from the repo root unless noted.

```bash
bun install           # install all workspace dependencies
bun run env:check     # validate environment with Varlock

# Lint, format, type-check
bun run check         # biome check --write
bun run typecheck     # tsgo --noEmit

# Docs site (from packages/docs/)
bun run dev           # Starlight dev server → localhost:4321
bun run build         # build to dist/
```

## Running the agent

Environment variables are described in [`.env.schema`](.env.schema). Put local secret values in a
gitignored `.env` or `.env.local`, then run the agent through Varlock so the environment is
validated before Flue starts.

```bash
# Watch mode (port 3583)
varlock run -- flue dev --target node

# One-shot
varlock run -- flue run doc-freshness --target node --id run-1 \
  --payload '{"repoPath": "/path/to/repo"}'
```

## Architecture decisions

Eleven decisions are recorded in [`docs/decisions/`](docs/decisions/):

- ADR-001 Bun monorepo · ADR-002 Flue framework · ADR-003 Effect as core language
- ADR-004 effect/unstable/http · ADR-005 Valibot/Effect Schema split
- ADR-006 UrlChecker anti-corruption layer · ADR-007 Pure/Default layer split
- ADR-008 OpenAI gpt-4o · ADR-009 Bun test + FastCheck · ADR-010 Biome + linteffect
- ADR-011 Node server + GitHub Actions deployment · ADR-012 Freshness signals (GitHub Traffic API + One Dollar Stats)

## Tech stack

| Concern | Tool |
| --- | --- |
| Agent framework | [Flue](https://flueframework.com/) |
| Core language | [Effect](https://effect.website/) (beta) |
| Runtime | [Bun](https://bun.sh/) |
| Model | OpenAI `gpt-4o` |
| Lint + format | [Biome](https://biomejs.dev/) v2 + [linteffect](https://github.com/catenarycloud/linteffect) |
| Tests | `bun test` + `effect/testing/FastCheck` |
| Docs site | [Astro Starlight](https://starlight.astro.build/) |
| Page analytics | [One Dollar Stats](https://onedollarstats.com/) |
