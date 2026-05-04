---
title: Reference — Flue and doc-freshness
description: Commands, payload fields, environment variables, custom tools, and result shapes for this repository.
---

This page describes the Flue entry points and the `doc-freshness` contract used in this repo.

## Runtime surfaces

| Surface | Form | Notes |
| --- | --- | --- |
| Local one-shot run | `varlock run -- flue run doc-freshness --target node --id <id> --payload '{…}'` | CLI / CI-style invocation |
| Local dev server | `varlock run -- flue dev --target node` | Starts the Node dev server on port `3583` by default |
| Webhook endpoint | `POST /agents/doc-freshness/<id>` | Available because `triggers = { webhook: true }` |

## Supported modes

| `mode` value | Behaviour |
| --- | --- |
| `check-staleness` | Default deterministic audit path |
| `agent` | Agentic execution via `session.skill("check-staleness", …)` |
| `agent-check-staleness` | Alias for `agent` |
| `analytics` | Returns the One Dollar Stats report only |

## Payload fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `mode` | `string` | `"check-staleness"` | Selects deterministic, agentic, or analytics execution |
| `repoPath` | `string` | `"/workspace"` | Repository root visible to the agent/runtime |
| `glob` | `string` | `"**/*.md"` | Markdown selection glob; repo-relative or absolute |
| `repository` | `string` | `GITHUB_REPOSITORY` | Used to derive `owner` and `repo` when those fields are omitted |
| `owner` | `string` | first segment of `repository` | GitHub owner passed to the history tool |
| `repo` | `string` | second segment of `repository` | GitHub repository name passed to the history tool |
| `ref` | `string` | `GITHUB_SHA` or `GITHUB_REF_NAME` | Commit, branch, or tag for history lookups |
| `signals.pageviews` | `Record<string, number>` | omitted | Relative doc path → 30-day page views |
| `signals.repoTraffic` | `Record<string, number>` | omitted | Repository path → GitHub traffic count |
| `signals.pageviewThreshold` | `number` | omitted | Overrides the default threshold supplied to the review tool |

## Freshness result shape

| Field | Type | Notes |
| --- | --- | --- |
| `files` | `Array<object>` | One entry per reviewed documentation file |
| `files[].path` | `string` | Repo-relative documentation path |
| `files[].status` | `"fresh" \| "stale" \| "warning"` | Determined by the review pipeline |
| `files[].priority` | `"critical" \| "medium" \| "low"` | Omitted for fresh files |
| `files[].pageViews30d` | `number` | Omitted when unavailable |
| `files[].lastDocCommit` | `string` | Timestamp string from GitHub history |
| `files[].issues` | `string[]` | Human-readable stale or warning evidence |
| `summary.total` | `number` | Total reviewed files |
| `summary.fresh` | `number` | Files with `status: "fresh"` |
| `summary.stale` | `number` | Files with `status: "stale"` |
| `summary.warnings` | `number` | Files with `status: "warning"` |
| `summary.critical` | `number` | Files with `priority: "critical"` |
| `report` | `string` | GitHub-flavoured Markdown report |
| `shouldFail` | `boolean` | `true` when at least one critical stale file exists |

## Analytics result shape

| Field | Type | Notes |
| --- | --- | --- |
| `report` | `string` | Markdown summary of One Dollar Stats page views |
| `pageCount` | `number` | Number of rows in the returned analytics result |
| `totalViews` | `number` | Sum of the page-view counts |

## Custom Flue tools used by the agentic path

| Tool name | Purpose | Output |
| --- | --- | --- |
| `list-docs` | Lists Markdown files for a repository glob | JSON with `files: string[]` |
| `read-doc` | Parses frontmatter, links, and code references from a doc | Tagged JSON result from `MarkdownDoc` |
| `github-history` | Fetches latest commit metadata for repo paths | Tagged JSON history entries |
| `review-freshness` | Assigns deterministic statuses and priorities from structured evidence | JSON with reviewed files, summary, and `shouldFail` |
| `check-url` | Performs HTTP HEAD link checks | Tagged JSON: `Reachable`, `InvalidUrl`, or `Unreachable` |
| `fetch-analytics` | Fetches 30-day One Dollar Stats page views | Tagged JSON analytics result or error |

## Project-specific Flue assets

| File | Role |
| --- | --- |
| `agents/doc-freshness/.flue/agents/doc-freshness.ts` | Agent handler and Flue boundary |
| `agents/doc-freshness/AGENTS.md` | Package-scoped behavioural instructions injected into Flue sessions |
| `agents/doc-freshness/.agents/skills/check-staleness/SKILL.md` | Agentic audit workflow used by `mode: "agent"` |
| `agents/doc-freshness/.agents/skills/analytics-report/SKILL.md` | Analytics-oriented skill asset |

## Environment variables loaded by `AppConfig`

| Variable | Required by current config | Default | Purpose |
| --- | --- | --- | --- |
| `APP_ENV` | no | `development` | Runtime environment label |
| `OPENAI_API_KEY` | yes | none | Model provider credential |
| `DOC_FRESHNESS_SUMMARY_MODEL` | no | `gpt-4.1-nano` | Executive-summary model for generated reports |
| `DOC_FRESHNESS_ADVISORY_MODEL` | no | `gpt-4.1-mini` | Advisory model for semantic review |
| `ONE_DOLLAR_STATS_API_KEY` | yes | none | Private analytics API key |
| `ODS_SITE_ID` | yes | none | One Dollar Stats site identifier |
| `PUBLIC_ODS_SITE_ID` | no | `""` | Public site identifier for the docs client bundle |
| `GH_TOKEN` / `GITHUB_TOKEN` | effectively optional | empty redacted token | GitHub API access; needed for complete history and issue-sync behaviour |
| `GITHUB_REPOSITORY` | no | `""` | Default `owner/repo` source |
| `GITHUB_REF_NAME` | no | `main` | Fallback ref name |
| `GITHUB_SHA` | no | `""` | Preferred ref when present |
| `PAGEVIEW_THRESHOLD` | no | `50` | Default threshold for critical freshness priority |
| `DOCS_BASE_PATH` | no | `/flue-doc-agent` | URL base path used for analytics mapping |

`OPENAI_API_KEY`, `ONE_DOLLAR_STATS_API_KEY`, and `ODS_SITE_ID` are loaded at startup by the
current `AppConfig` contract even when a specific invocation does not end up calling the model or
analytics path.

The ADRs in this project are *not* reference — they are explanation. `CLAUDE.md` leans closest to reference.
