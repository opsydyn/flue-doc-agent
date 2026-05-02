---
title: "ADR-002: Flue framework for agent orchestration"
---

# ADR-002: Flue framework for agent orchestration

## Status

Accepted

## Date

2026-05-02

## Context

We are building autonomous agents that need: LLM session management, tool execution loops, skill (prompt template) discovery, sandbox isolation, and multiple deployment targets (Node.js, CI). We need a framework rather than raw Anthropic/OpenAI SDK calls to avoid reimplementing session state, tool-call loops, result extraction, and compaction.

Key requirements:

- Agents must be testable locally with `flue dev`
- Skills defined in Markdown (`.agents/skills/`) must be auto-discovered
- Result schemas must be validated (typed output from LLM)
- Must support `sandbox: 'local'` for reading host filesystem (git repos)
- Runtime-agnostic: run in Node.js today, potentially Cloudflare Workers later

## Decision

Use [Flue](https://flueframework.com/) (`@flue/sdk ^0.3.6`) as the agent framework. Agent handlers live in `.flue/agents/`, skills in `.agents/skills/`, roles in `roles/`. The `AGENTS.md` file is the system prompt.

## Alternatives Considered

### Raw Anthropic SDK + custom harness

- Pros: Full control, no framework dependency
- Cons: Would require reimplementing session persistence, tool-call loops, skill discovery, result extraction, compaction, and multi-target build — essentially rebuilding Flue. High ongoing maintenance.
- Rejected: Flue is purpose-built for exactly this use case.

### LangChain / LangGraph

- Pros: Large ecosystem, many integrations
- Cons: JavaScript LangChain is notoriously unstable and over-abstracted; poor TypeScript experience; does not support Markdown-based skills or Flue's `AGENTS.md` convention; no built-in `flue dev` equivalent.
- Rejected: Ecosystem mismatch and instability.

### Mastra

- Pros: Good TypeScript-first DX
- Cons: Less mature than Flue for the "autonomous coding agent" use case; no `sandbox: 'local'` filesystem integration; no `AGENTS.md` auto-discovery.
- Rejected: Flue is a better fit for file-system-aware agents.

## Consequences

- Agent handlers are thin orchestration files; business logic goes in Effect services and Markdown skills.
- `@flue/sdk` is experimental — "APIs may change". ADR-002 notes this; coupling is minimised (contract coupling via `FlueContext`, `ToolDef`, `Type` only).
- The `flue-main/` reference project is kept locally for SDK source inspection, but dependency resolves from npm.
- Skill authoring is in Markdown, not TypeScript — skills are prose instructions, not code.
- Deployment: `flue build --target node` → `dist/server.mjs`.
