---
title: Tutorial — run doc-freshness locally with Flue
description: A first successful local run of the doc-freshness agent, from environment setup to a freshness report.
---

This tutorial gives you **one reliable path** through the system. By the end, you will have run the
`doc-freshness` agent with Flue against this repository and seen a real freshness report.

We stay on a single track here. No alternatives, no branching, no architecture discussion.

## Before you start

You need:

- Bun installed
- a GitHub token that can read `opsydyn/flue-doc-agent`
- an OpenAI API key
- a One Dollar Stats API key and site id

## 1. Install the workspace dependencies

From the repository root, install everything once:

```bash
bun install
```

The install should finish without dependency errors.

## 2. Create your local environment file

Copy the committed example file:

```bash
cp .env.example .env
```

Now open `.env` and set values for these keys:

- `OPENAI_API_KEY`
- `ONE_DOLLAR_STATS_API_KEY`
- `ODS_SITE_ID`
- `GH_TOKEN`

Leave the existing defaults in place unless you already know you need different values.

## 3. Validate the environment contract

Run the repository's environment check:

```bash
bun run env:check
```

The command should complete without reporting missing required values.

## 4. Run the agent once

Start a one-shot Flue run with a payload that points at your local clone.

Replace `/absolute/path/to/doc-agent` with the full path to this repository on your machine.

```bash
./node_modules/.bin/varlock run --path ./.env.schema -- \
  ./node_modules/.bin/flue run doc-freshness --target node --id tutorial-1 \
  --payload '{"repoPath":"/absolute/path/to/doc-agent","glob":"packages/docs/src/content/docs/**/*.{md,mdx}","owner":"opsydyn","repo":"flue-doc-agent","ref":"main"}'
```

## 5. Check the result

The output should include a structured result with these top-level fields:

- `files`
- `summary`
- `report`
- `shouldFail`

The `report` field should begin with `## Doc Freshness Report`.

If `shouldFail` is `true`, the run still succeeded — it means the agent found critical stale
documentation.

## You have completed the first run

You have now:

- validated the repo environment contract with Varlock
- started the Flue runtime from the command line
- executed `doc-freshness` against a real repository
- seen the structured output the agent returns

Next:

- go to the [how-to guide](/flue-doc-agent/diataxis/how-to-guides/) for day-two tasks
- use the [reference page](/flue-doc-agent/diataxis/reference/) when you need exact payload fields
- read the [explanation page](/flue-doc-agent/diataxis/explanation/) when you want the architecture behind the commands
