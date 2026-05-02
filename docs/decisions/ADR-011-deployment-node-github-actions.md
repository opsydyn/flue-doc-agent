# ADR-011: Dual-mode deployment — Node.js server and GitHub Actions

## Status

Accepted

## Date

2026-05-02

## Context

With `OPENAI_API_KEY` in hand the agent is ready to run end-to-end. We need three
things:

1. **Immediate practical testing** — run the agent locally against a real repo and see
   results without any deployment.
2. **Node.js server** — a long-running process that exposes an HTTP endpoint, suitable
   for demos, local integration tests, and any host that can run Node (Docker, Railway,
   Fly.io).
3. **GitHub Actions** — run the staleness check in CI on a schedule or on push, using
   the checked-out repo as the target.

Key constraints that shaped the decision:

- The agent already uses `sandbox: 'local'` (ADR-002). In the local sandbox Flue mounts
  `process.cwd()` at `/workspace` **and** gives the agent access to the full host
  filesystem — so passing an absolute `repoPath` in the payload works in all modes.
- `flue run` invokes any agent regardless of its `triggers` value, so a single agent
  file serves both the server (HTTP) and the CLI (CI / one-shot) paths.
- `defineCommand` (from `@flue/sdk/node`) is needed only when secrets must be injected
  into an external CLI. Our agent calls `git` via the built-in `bash` tool through the
  local sandbox — no `GH_TOKEN` or other secret is required for read-only git operations.
  If the agent is extended to comment on PRs or open issues, `defineCommand('gh', { env:
  { GH_TOKEN: … } })` would be introduced at that point.

## Decision

### 1. Keep `triggers = { webhook: true }`

The agent retains its webhook trigger. This has no negative effect on CLI invocation —
`flue run` ignores triggers entirely. The single agent file serves both modes:

| Mode | Invocation |
|---|---|
| Node server | HTTP `POST /agents/doc-freshness/:id` |
| CLI / CI | `flue run doc-freshness --target node --id <id> --payload '{…}'` |

### 2. Local testing (immediate, dev loop)

```bash
# From agents/doc-freshness/
flue dev --target node --env .env
# → watch mode, port 3583, reloads on file change

curl http://localhost:3583/agents/doc-freshness/run-1 \
  -H "Content-Type: application/json" \
  -d '{"repoPath": "/Users/alan/Projects/doc-agent"}'
```

Or one-shot (no server, result to stdout):

```bash
flue run doc-freshness --target node --id run-1 --env .env \
  --payload '{"repoPath": "/Users/alan/Projects/doc-agent"}'
```

The `repoPath` is the absolute path to the repo to analyse. With `sandbox: 'local'` the
agent can read any path on the host filesystem, so the absolute path works without any
extra mounting.

### 3. Node.js server (demo / hosted)

```bash
# From agents/doc-freshness/
flue build --target node          # → dist/server.mjs
set -a; source .env; set +a
node dist/server.mjs              # PORT defaults to 3000
# or: PORT=8080 node dist/server.mjs
```

Server endpoints (Hono under the hood):

| Route | Purpose |
|---|---|
| `GET /health` | Health check |
| `GET /agents` | Agent manifest |
| `POST /agents/doc-freshness/:id` | Invoke the agent |

`node_modules` must be present at runtime — the build externalises dependencies rather
than bundling them.

### 4. GitHub Actions deployment

The canonical workflow runs on `workflow_dispatch` (manual demo trigger) and on a
weekly schedule (Monday 08:00 UTC), targeting the repo's own docs — a self-referential
demo that dog-foods the agent.

`.github/workflows/doc-freshness.yml`:

```yaml
name: Doc Freshness Check

on:
  workflow_dispatch:
  schedule:
    - cron: '0 8 * * 1'   # every Monday 08:00 UTC
  push:
    branches: [main]
    paths:
      - 'docs/**'
      - 'agents/doc-freshness/src/**'

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install
        working-directory: agents/doc-freshness
      - name: Run doc-freshness agent
        working-directory: agents/doc-freshness
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          bunx flue run doc-freshness --target node \
            --id "run-${{ github.run_id }}" \
            --payload "{\"repoPath\": \"${{ github.workspace }}\"}"
```

Key points:

- `working-directory: agents/doc-freshness` — Flue discovers the agent at
  `.flue/agents/doc-freshness.ts` from this directory.
- `repoPath: ${{ github.workspace }}` — the checked-out repo root; the agent's local
  sandbox gives it full read access to that path even though `process.cwd()` is the
  agent package directory.
- `OPENAI_API_KEY` is a repository secret (**Settings → Secrets and variables →
  Actions**). Never committed; only referenced via `${{ secrets.OPENAI_API_KEY }}`.
- `bunx flue` uses the Bun-installed Flue CLI rather than `npx`, consistent with the
  Bun monorepo toolchain (ADR-001).
- `timeout-minutes: 15` caps runaway agent sessions. Adjust upward if the target repo
  is large.

### 5. Demo scenario — self-referential check

The natural demo for the Flue framework is the agent checking its own repository: run
`doc-freshness` against `/Users/alan/Projects/doc-agent` (locally) or
`${{ github.workspace }}` (CI). This works out of the box because:

- `docs/decisions/` contains 10 ADRs that reference source files
- `docs/balanced-coupling-analysis.md` references specific modules
- `docs/postmortems/fastcheck-url-checker.md` references test files

Any commit to `src/UrlChecker.ts` that post-dates the ADRs referencing it will be
flagged as stale — a concrete, verifiable signal.

## Alternatives Considered

### `triggers = {}` (no webhook) for a CI-only agent

- Pros: Clearer signal that the agent is not meant for HTTP
- Cons: Prevents reuse as a server endpoint without code change; the Flue docs
  show that `flue run` works regardless of trigger value, so there is no practical
  difference at runtime
- Rejected: Keep `{ webhook: true }` to preserve both modes from one file.

### Run `flue run` from the repo root (not `agents/doc-freshness/`)

- Pros: `process.cwd()` = repo root, so `/workspace` = repo root, eliminating the
  need to pass `repoPath` as an absolute path
- Cons: Flue discovers agents relative to cwd; the agent is under
  `agents/doc-freshness/.flue/agents/` — Flue would not find it from the root unless
  it traverses workspace directories (not documented). Requires validation.
- Deferred: Validate with `flue` version currently installed; default to
  `working-directory: agents/doc-freshness` with explicit `repoPath` for now.

### Docker deployment for the node server

- Pros: Reproducible environment, easy to host anywhere
- Cons: Adds build pipeline complexity; not needed for the demo phase
- Not rejected: Docker is the natural next step once the demo is validated on bare
  Node. A `Dockerfile` following the pattern in the Flue node docs can be added to
  `agents/doc-freshness/` when needed.

### `push` trigger on every commit

- Pros: Catches staleness immediately after every merge
- Cons: Every push to `main` would invoke a paid OpenAI call; noisy for a demo repo
- Compromise: Scope the `push` trigger to `paths` that are likely to introduce
  staleness (`docs/**`, `src/**`) to reduce unnecessary runs.

## Consequences

- `OPENAI_API_KEY` must be added as a GitHub Actions repository secret before the
  workflow can run in CI.
- The workflow file `.github/workflows/doc-freshness.yml` is the single place to adjust
  trigger cadence, timeout, and payload.
- Local dev uses `flue dev` (port 3583, watch mode); the built server uses port 3000
  (or `PORT` env). Document this difference to avoid confusion when switching modes.
- When the agent is extended to post results as GitHub PR comments or issue annotations,
  add `permissions: pull-requests: write` (or `issues: write`) to the workflow and
  introduce `defineCommand('gh', { env: { GH_TOKEN: process.env.GH_TOKEN } })` in the
  handler — `GITHUB_TOKEN` is provided automatically by Actions and does not require a
  repository secret.
- `bunx flue run` streams progress to stderr and prints the final JSON result to stdout.
  To surface the result in the Actions summary, pipe stdout to a subsequent step:
  `run: bunx flue run … | tee result.json` and upload `result.json` as a workflow
  artifact or parse it with `jq` to set step outputs.
