# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A Bun monorepo of autonomous agents built on the [Flue framework](https://flueframework.com/) (`flue-main/`). The first agent — `agents/doc-freshness` — checks markdown documentation files for staleness by comparing their git history against the code they reference.

`flue-main/` is the local copy of the Flue SDK. Agent packages live under `agents/`. Each agent package is a self-contained Flue project.

## Monorepo Layout

```
doc-agent/
├── package.json              # Bun workspace root — workspaces: ["agents/*"]
├── CLAUDE.md
├── agents/
│   └── doc-freshness/        # First agent package
│       ├── package.json      # depends on @flue/sdk, valibot
│       ├── AGENTS.md         # System prompt injected into every session
│       ├── .flue/
│       │   └── agents/
│       │       └── doc-freshness.ts    # Agent handler (entry point)
│       ├── roles/
│       │   └── doc-reviewer.md        # Persona / model override
│       └── .agents/
│           └── skills/
│               └── <skill-name>/SKILL.md
└── flue-main/                # Flue SDK source (pnpm workspace, separate)
```

New agents follow the same layout under `agents/<agent-name>/`.

## Toolchain

| Tool | Purpose |
| --- | --- |
| **Biome** (`biome.jsonc`) | Lint + format. Tabs, 100-char line width. Run: `bun check` |
| **linteffect** | Biome plugin for Effect-specific lint rules (loaded via `plugins` in `biome.jsonc`) |
| **@effect/language-service** | TS language-service plugin for Effect (configured in `tsconfig.json` `plugins`) |
| **knip** | Dead code / unused exports detection. Run: `bun knip` |
| **effect beta** | Core FP library — use `Effect`, `Schema`, `Stream`, `Layer` etc. for non-agent orchestration logic (parsers, validators, pipelines) |

`tsconfig.json` enables `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess` — these are required by Effect patterns.

## Development Commands

All `bun` commands run from the repo root. `flue` commands run from inside an agent package (e.g. `agents/doc-freshness/`).

```bash
# Dev server — watch mode, rebuilds on file change, port 3583
flue dev --target node --env .env

# One-shot run (CI-style)
flue run doc-freshness --target node --id test-1 --payload '{"repoPath": "/path/to/repo"}'

# Build deployable artifact
flue build --target node      # → dist/server.mjs
flue build --target cloudflare

# Trigger a running agent
curl http://localhost:3583/agents/doc-freshness/session-1 \
  -H "Content-Type: application/json" \
  -d '{"repoPath": "/path/to/repo"}'
```

## Flue Agent Architecture

### Agent Handler (`.flue/agents/<name>.ts`)

Every agent exports `triggers` and a default async function:

```ts
import type { FlueContext } from '@flue/sdk/client';
import * as v from 'valibot';

export const triggers = { webhook: true };  // or {} for CLI-only

export default async function ({ init, id, env, payload }: FlueContext) {
  const agent = await init({ sandbox: 'local', model: 'anthropic/claude-sonnet-4-6' });
  const session = await agent.session();          // default session (persists history per id)
  const result = await session.prompt(payload.prompt, {
    result: v.object({ answer: v.string() }),     // typed, validated output
  });
  return result;
}
```

### Sandbox Options

- `sandbox: undefined` (default) — virtual in-memory fs via just-bash (fastest, no host access)
- `sandbox: 'local'` — mounts host filesystem at `/workspace`; required when the agent needs to read repo files
- `sandbox: () => new Bash({ fs })` — custom virtual sandbox with shared InMemoryFs

### Session Methods

```ts
session.prompt(text, options?)   // send a message, run tool loop, return text or typed result
session.skill(name, options?)    // invoke a SKILL.md template by name or path
session.task(text, options?)     // spawn a child agent in a detached session (used for delegation)
session.shell(command, options?) // run a shell command directly (bypasses LLM)
```

### Built-in LLM Tools (always available)

`read`, `write`, `edit`, `bash`, `grep`, `glob`, `task` — the LLM calls these autonomously during a prompt loop.

### Custom Tools

```ts
import { Type, type ToolDef } from '@flue/sdk/client';

const myTool: ToolDef = {
  name: 'fetch-url',
  description: 'Fetch an HTTP URL and return the status code.',
  parameters: Type.Object({ url: Type.String() }),
  execute: async (args) => { /* return string */ },
};
const agent = await init({ model: '...', tools: [myTool] });
```

### Result Schemas (Valibot)

Pass `result: v.object({...})` to any `prompt()`, `skill()`, or `task()` call. The LLM outputs a delimited JSON block; the session extracts and validates it. The return type is fully inferred.

### Roles (`.flue/roles/<name>.md` or `roles/<name>.md`)

Markdown files with optional YAML frontmatter (`description:`, `model:`). Role instructions are injected as a system prompt overlay at call time — they are not stored in message history. Precedence: call-level > session-level > agent-level.

### Skills (`.agents/skills/<name>/SKILL.md`)

Markdown prompt templates discovered from the sandbox `cwd`. Invoked with `session.skill('name', { args: {...} })`. Args are interpolated into the prompt.

### AGENTS.md

Placed at the workspace root and/or inside each agent package. Automatically injected as part of the system prompt for every session in that directory scope. Use it to set agent-wide behavioral rules and tool-use guidelines.

## Doc-Freshness Agent Design

**Payload:** `{ repoPath: string, glob?: string }`  
**Sandbox:** `'local'` (needs host git + filesystem)  
**Result schema:**
```ts
v.object({
  files: v.array(v.object({
    path: v.string(),
    status: v.picklist(['fresh', 'stale', 'warning']),
    lastDocCommit: v.string(),
    issues: v.array(v.string()),
  })),
  summary: v.object({ total: v.number(), fresh: v.number(), stale: v.number() }),
})
```

**Staleness logic (executed via built-in `bash`/`glob`/`grep` tools):**
1. `glob` to find all `*.md` files under `repoPath`
2. `git log -1 --format="%ai" -- <file>` for each doc's last-modified commit date
3. `grep` code file references (links, code fences with paths) inside each doc
4. `git log -1 --format="%ai" -- <code-file>` for each referenced file
5. Flag doc as `stale` if any referenced code file was committed after the doc

**Custom tool:** `check-url` — HTTP HEAD request to validate external links.

**Skills:** `scan-docs`, `check-staleness`, `check-links`, `generate-report`  
**Role:** `doc-reviewer` — focused on identifying outdated content
