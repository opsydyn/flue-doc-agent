# ADR-008: OpenAI gpt-4o as the agent model

## Status
Accepted

## Date
2026-05-02

## Context
Flue agents require a model string in the format `provider/model-id`. The initial scaffold used `anthropic/claude-sonnet-4-6` but the project has an OpenAI API key and the user prefers OpenAI for this agent.

## Decision
Use `openai/gpt-4o` as the model in `doc-freshness.ts`. The API key is provided via `OPENAI_API_KEY` in `.env` (gitignored; `.env.example` is committed as a template).

## Alternatives Considered

### anthropic/claude-sonnet-4-6
- The default in Flue examples and previously used in the scaffold.
- Rejected: User has OpenAI key and prefers it for this project.

### openai/gpt-4o-mini
- Pros: Significantly cheaper; faster
- Cons: Less capable for complex reasoning tasks like multi-file git staleness analysis
- Could be revisited if cost becomes a concern during integration testing.

### openrouter routing
- Pros: Model-agnostic; can switch providers without code change
- Cons: Additional dependency; adds latency; not necessary at this scale.
- Rejected: Premature.

## Consequences
- `.env.example` documents `OPENAI_API_KEY=sk-...` as the required environment variable.
- `flue dev --target node --env .env` loads the key from the local `.env` file.
- The model string is a single string literal in `doc-freshness.ts` — changing models requires one line edit.
- If the project migrates to Anthropic models, ADR-008 should be superseded.
