---
title: How to work with Flue and doc-freshness
description: Common tasks for running the Flue dev server, scoping audits, switching modes, and fetching analytics.
---

Use this page when your environment already works and you need to get something done.

## How to start the local webhook server

Start the Flue development server from the repository root:

```bash
./node_modules/.bin/varlock run --path ./.env.schema -- \
  ./node_modules/.bin/flue dev --target node
```

Then call the webhook endpoint:

```bash
curl http://localhost:3583/agents/doc-freshness/session-local \
  -H "Content-Type: application/json" \
  -d '{"repoPath":"/absolute/path/to/doc-agent","glob":"packages/docs/src/content/docs/**/*.{md,mdx}","owner":"opsydyn","repo":"flue-doc-agent","ref":"main"}'
```

Use a new final path segment to start a fresh Flue conversation. Reuse the same final path segment
to continue the same session.

## How to audit only part of the docs tree

Pass a narrower `glob` in the payload.

Examples:

### Decisions only

```json
{"glob":"packages/docs/src/content/docs/decisions/**/*.md"}
```

### Postmortems only

```json
{"glob":"packages/docs/src/content/docs/postmortems/**/*.md"}
```

### One subtree under `diataxis`

```json
{"glob":"packages/docs/src/content/docs/diataxis/**/*.{md,mdx}"}
```

Use an absolute glob when your caller already has one. The handler accepts both repo-relative and
absolute patterns.

## How to force the agentic Flue skill path

The default mode is deterministic `check-staleness`. To run the embedded Flue skill instead, set
`mode` to `agent` or `agent-check-staleness`.

```json
{
  "mode": "agent",
  "repoPath": "/absolute/path/to/doc-agent",
  "glob": "packages/docs/src/content/docs/**/*.{md,mdx}",
  "owner": "opsydyn",
  "repo": "flue-doc-agent",
  "ref": "main"
}
```

Both `agent` and `agent-check-staleness` select the same agentic execution path.

## How to fetch the analytics report only

Run the analytics mode when you only want the One Dollar Stats summary:

```bash
./node_modules/.bin/varlock run --path ./.env.schema -- \
  ./node_modules/.bin/flue run doc-freshness --target node --id analytics-1 \
  --payload '{"mode":"analytics"}'
```

The result contains `report`, `pageCount`, and `totalViews`.

## How to match the GitHub Actions invocation shape locally

When you want your local run to resemble CI, pass the repository metadata explicitly and keep the
glob rooted at the docs collection:

```bash
./node_modules/.bin/varlock run --path ./.env.schema -- \
  ./node_modules/.bin/flue run doc-freshness --target node --id ci-shape-1 \
  --payload '{"repoPath":"/absolute/path/to/doc-agent","glob":"packages/docs/src/content/docs/**/*.{md,mdx}","owner":"opsydyn","repo":"flue-doc-agent","ref":"main"}'
```

If you also have analytics signals available, provide them in `signals.pageviews`,
`signals.repoTraffic`, and `signals.pageviewThreshold`.
