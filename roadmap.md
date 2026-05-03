# Doc Freshness Roadmap

## Goal

Build a reliable Starlight documentation freshness workflow that combines deterministic
repository evidence with Flue's agentic review capabilities. The MVP should publish useful
Markdown reports into the docs site, preserve Git history for generated reports, and avoid
brittle shell-driven control flow.

## Current Problems

- The agent still asks the built-in `bash` tool to run `git`.
- CI can fail with `bash: git: command not found` inside the Flue tool environment.
- `defineCommand("gh", { env: { GH_TOKEN } })` does not fix missing `git`; it only defines a
  GitHub CLI command and must still be passed as a tool to be usable.
- The report helper scripts are `.mjs`, loosely typed, and do manual parsing.
- The Starlight app only needs Markdown report pages, but the workflow currently passes through
  several JSON/log extraction steps before writing Markdown.
- Freshness evidence should be modelled as domain data, not string tokens or implicit shell text.

## Direction

Move shell-sensitive evidence gathering out of the LLM prompt and into typed Flue tools. Keep the
agent responsible for judgement, prioritisation, and synthesis.

The preferred pipeline is:

```text
Starlight docs Markdown
  -> typed doc inventory tool
  -> typed doc parser using gray-matter
  -> typed GitHub history tool using Octokit
  -> Flue agent review and prioritisation
  -> typed Starlight Markdown report writer
  -> docs build
  -> commit generated report pages
```

## Octokit Assessment

Octokit would help the agent, but it should be used as a custom Flue tool, not through
`defineCommand("gh")`.

Use Octokit for:

- Latest commit for a path via GitHub REST commits API.
- Repository metadata, default branch, and current SHA.
- Future PR comments, issue creation, or check annotations.
- CI-safe history lookup when the Flue runtime cannot see a `git` binary.

Do not use Octokit for:

- Parsing local Markdown files.
- Reading uncommitted working tree changes.
- Replacing Starlight content collections.
- Hiding loosely typed result parsing.

Tradeoffs:

- Pros: no dependency on the `git` binary; works naturally in GitHub Actions with `GITHUB_TOKEN`;
  explicit API contracts; easy to add PR/report features later.
- Cons: only sees committed remote state; needs owner/repo/ref in the payload; can hit API rate
  limits if every file is queried individually; local development needs a token or fallback.

MVP recommendation: add a `github-history` Flue tool backed by Octokit. Batch or cache path lookups
inside the tool so the agent receives structured history data instead of running `git` commands.

## Varlock Assessment

[Varlock](https://varlock.dev/) fits this project as a configuration and secrets contract layer.
It does not replace Octokit, Flue, Starlight content collections, or Markdown parsing. Its value is
making environment requirements explicit, typed, validated, and safe for AI agents to inspect.

Use Varlock for:

- Replacing `.env.example` drift with a checked-in `.env.schema`.
- Marking sensitive values such as `OPENAI_API_KEY` and `ONE_DOLLAR_STATS_API_KEY`.
- Documenting non-secret values such as `ODS_SITE_ID`, `PUBLIC_ODS_SITE_ID`, docs base URL, owner,
  repo, branch, and pageview threshold.
- Validating required CI/local configuration before running Flue.
- Generating type-safe env access for TypeScript code.
- Running local scripts through validated env injection, for example `varlock run -- bun ...`.
- Leak scanning and redaction guardrails around logs and agent workflows.

Do not use Varlock for:

- Fetching GitHub commit history.
- Parsing Starlight Markdown.
- Replacing GitHub Actions secrets.
- Storing public generated freshness reports.

Recommended schema shape:

```dotenv
# @sensitive @required @type=string
OPENAI_API_KEY=

# @sensitive @required @type=string
ONE_DOLLAR_STATS_API_KEY=

# @required @type=string
ODS_SITE_ID=

# @type=string
PUBLIC_ODS_SITE_ID=

# @required @type=string
GITHUB_REPOSITORY=

# @type=integer(min=1)
PAGEVIEW_THRESHOLD=50
```

MVP recommendation: add Varlock after the Octokit history tool is in place, or in parallel if CI
configuration keeps causing ambiguity. It should sit at the workflow/script boundary so the agent
and helper scripts receive validated configuration without seeing secret values.

## Proposed Tools

### `list-docs`

Purpose: return the Starlight Markdown files to audit.

Inputs:

- `repoPath`
- `docsRoot`, default `packages/docs/src/content/docs`
- `extensions`, default `[".md", ".mdx"]`

Output:

```ts
{
  files: ReadonlyArray<string>
}
```

### `read-doc`

Purpose: parse Starlight Markdown content and frontmatter.

Implementation:

- Use `gray-matter`.
- Restrict reads to `packages/docs/src/content/docs`.
- Return parsed frontmatter, body, links, and candidate code references.

Output:

```ts
{
  path: string
  frontmatter: Record<string, unknown>
  body: string
  internalLinks: ReadonlyArray<string>
  externalLinks: ReadonlyArray<string>
  codeReferences: ReadonlyArray<string>
}
```

### `github-history`

Purpose: get last commit metadata without invoking `git`.

Implementation:

- Use Octokit with `GH_TOKEN` or `GITHUB_TOKEN`.
- Query latest commit for each path at the selected ref.
- Cache repeated path lookups for a run.

Output:

```ts
{
  path: string
  lastCommit: Option.Option<{
    sha: string
    committedAt: string
    url: string
  }>
}
```

### `check-url`

Purpose: validate external links.

Keep the existing typed tagged result:

```ts
Reachable | InvalidUrl | Unreachable
```

Avoid returning string status tokens.

### `write-starlight-report`

Purpose: generate Markdown report pages for Starlight.

Implementation options:

- Prefer a TypeScript script run with Bun.
- Keep output Markdown deterministic.
- Write to `packages/docs/src/content/docs/analytics`.

Output files:

- `analytics/freshness.md`
- `analytics/pageviews.md`

## TypeScript Script Cleanup

Convert helper scripts from `.mjs` to `.ts`.

Why:

- Bun can run TypeScript directly.
- Existing repo tooling already typechecks TypeScript.
- Report input/output schemas can be represented explicitly.
- It reduces accidental `null`, `undefined`, or malformed Markdown output.

Recommended scripts:

- `agents/doc-freshness/scripts/extract-flue-json.ts`
- `agents/doc-freshness/scripts/write-starlight-reports.ts`

Longer term, remove the extractor if Flue can be invoked through an API path that returns structured
results without mixed CLI logs.

## Effect Modelling Rules

Keep these rules in the agent and tools:

- Use `Schema.make` or field `.make` for domain constructors.
- Use `Struct.evolve` with `effect/Record` combinators for state updates.
- Keep JSON encode/decode at boundaries.
- Avoid `Object.assign`, spread-based state rebuilds, `Object.fromEntries`, and inline JSON
  parse/stringify in Effect transitions.
- Avoid returning string tokens for control flow.
- Prefer `Option`, `Either`, tagged unions, or typed Effect errors.

## GitHub Actions Plan

The workflow should:

1. Check out the repository with full history for normal GitHub context, even if the agent does not
   shell out to `git`.
2. Fetch analytics signals from One Dollar Stats and GitHub Traffic.
3. Run the Flue agent.
4. Generate Starlight Markdown reports.
5. Build the docs site.
6. Commit generated report pages when they changed.
7. Apply the freshness gate after reports have been generated.

Secrets and env:

- `OPENAI_API_KEY` as a repository secret.
- `ONE_DOLLAR_STATS_API_KEY` as a repository secret.
- `ODS_SITE_ID` can be a repository secret or variable. It is public in browser output if used as
  `PUBLIC_ODS_SITE_ID`.
- `GITHUB_TOKEN` is automatically available in Actions; expose it as `GH_TOKEN` only for tools that
  need GitHub API access.
- Add Varlock as the source-of-truth schema for required env names, sensitivity, defaults, and
  validation. GitHub Actions still supplies the secret values.

## Phases

### Phase 1: Stabilise CI

- Remove prompt instructions that ask the agent to run `git` through `bash`.
- Add Octokit-backed `github-history` tool.
- Pass `GH_TOKEN`, owner, repo, and ref in the payload.
- Keep the report shape unchanged.
- Verify the workflow no longer fails when `git` is absent from the Flue shell environment.
- Add a minimal `.env.schema` if env-name drift continues to cause CI failures.

### Phase 2: Typed Markdown Pipeline

- Add `gray-matter`.
- Add `read-doc` tool for frontmatter, links, and code references.
- Convert `.mjs` scripts to `.ts`.
- Add schemas for ODS rows, freshness result, and generated report inputs.
- Generate only Starlight Markdown as the persistent artifact.
- Optionally run scripts through Varlock locally and in CI once the schema is committed.

### Phase 3: Better Freshness Evidence

- Improve code-reference extraction from Markdown links, fenced code metadata, and frontmatter.
- Map Starlight routes back to source files deterministically.
- Cache Octokit commit lookups per path.
- Add deterministic unit tests for stale, warning, fresh, and critical cases.

### Phase 4: Agentic Review Layer

- Give the Flue agent structured tool outputs only.
- Ask the agent to explain why a document is stale or fresh.
- Keep priority scoring deterministic where possible.
- Let the agent produce the human-readable report and remediation queue.

### Phase 5: Publishing and Feedback

- Commit generated reports to Git for history.
- Let the existing docs deploy workflow publish Starlight.
- Optionally use Octokit for PR comments, issue creation, or GitHub check annotations.
- Add trend pages once report history is stable.

## Near-Term Decision

Use Octokit for GitHub-backed history lookup in CI, with a typed Flue tool boundary. Do not rely on
`defineCommand("gh")` to solve missing `git`, and do not ask the LLM to orchestrate `git` through
`bash`.

Add Varlock as a follow-on configuration hardening step. It is most useful once the required
environment contract is stable enough to encode, but it can be introduced earlier if secret and
variable naming keeps slowing the workflow down.
