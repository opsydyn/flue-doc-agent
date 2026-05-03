---
title: "ADR-013: Octokit-backed history tool for documentation freshness"
---

# ADR-013: Octokit-backed history tool for documentation freshness

## Status

Accepted

## Date

2026-05-03

## Supersedes

This ADR supersedes the history-lookup assumption in
[ADR-011: Dual-mode deployment — Node.js server and GitHub Actions](./ADR-011-deployment-node-github-actions.md).
ADR-011 assumed read-only freshness history could safely be gathered by asking the agent to run
`git` through Flue's built-in `bash` tool. CI has shown that assumption is not stable enough.

## Context

The doc-freshness agent compares documentation commit dates against the source files those docs
describe. That comparison is core evidence: without commit history the agent can only speculate.

The original implementation asked the model to run commands like:

```bash
git -C <repoPath> log -1 --format="%ai" -- <path>
```

That is too fragile for the MVP:

- The Flue tool environment can report `bash: git: command not found`.
- The model has to orchestrate shell commands and parse shell text.
- `defineCommand("gh", { env: { GH_TOKEN } })` does not make `git` available; it only defines a
  GitHub CLI command, and only if that command is passed into the Flue session.
- Shell output is not a domain contract. It forces defensive branching and makes result extraction
  hard to verify.

The repository already has accepted decisions that constrain the replacement:

- ADR-003: use Effect for typed errors, services, and non-boundary logic.
- ADR-005: use Valibot at the Flue result boundary.
- ADR-011: keep a single Flue agent usable from the Node server and GitHub Actions.
- ADR-012: combine freshness evidence with GitHub/One Dollar Stats demand signals.

## Decision

Use an Octokit-backed Flue tool for GitHub commit history in CI. The agent must no longer be
instructed to run `git` through `bash` for freshness evidence.

The new tool is named `github-history`.

The tool:

- Accepts `owner`, `repo`, `ref`, and `paths`.
- Uses Octokit with `GH_TOKEN` or `GITHUB_TOKEN`.
- Queries GitHub's commits API for the latest commit touching each path.
- Returns schema-encoded JSON with tagged domain values.
- Caches repeated path lookups during a single tool invocation.

The agent remains responsible for judgement and report synthesis. The tool is responsible for
evidence collection.

## Domain Contract

The history tool returns one entry per requested path:

```ts
type GitHubHistoryEntry =
  | {
      _tag: "CommitFound"
      path: string
      sha: string
      committedAt: string
      url: string
    }
  | {
      _tag: "NoCommitFound"
      path: string
    }
  | {
      _tag: "HistoryUnavailable"
      path: string
      reason: string
    }
```

The result envelope is:

```ts
{
  histories: ReadonlyArray<GitHubHistoryEntry>
}
```

These are domain values, not string tokens. The `_tag` field is a typed discriminator used
consistently with the existing `check-url` result style.

## Non-Goals

- Do not use Octokit to parse Markdown.
- Do not use Octokit to read uncommitted local working tree changes.
- Do not replace Starlight content collections.
- Do not introduce PR comments, issue creation, or check annotations in this slice.
- Do not add Varlock in this slice; configuration hardening is a follow-on step.
- Do not write freshness metadata back into every source Markdown file yet. The current artifact is
  generated report Markdown.

## Alternatives Considered

### Continue using `bash git`

- Pros: simple locally; full checkout history is already available in GitHub Actions.
- Cons: failed in Flue tool runtime; pushes shell orchestration into the model; parsing text output
  weakens the model contract.
- Rejected.

### Add `defineCommand("gh")`

- Pros: useful for future GitHub operations that need token injection.
- Cons: does not solve `git: command not found`; still depends on an external CLI; still returns
  CLI text unless wrapped carefully.
- Rejected for freshness history.

### Pure JavaScript git reader

- Pros: can inspect local `.git` without the `git` binary; useful for local/offline development.
- Cons: more implementation detail for this first CI slice; still needs careful history traversal
  and path handling.
- Deferred as a possible local fallback.

### Octokit-backed Flue tool

- Pros: works naturally in GitHub Actions with `GITHUB_TOKEN`; no dependency on `git`; explicit API
  contract; future PR/comment/check integrations can reuse the same GitHub client.
- Cons: only sees committed remote state; needs owner/repo/ref context; can hit API limits if path
  lookups are not cached or batched.
- Accepted.

## Implementation Plan

1. Add Octokit to `agents/doc-freshness` dependencies.
2. In `agents/doc-freshness/.flue/agents/doc-freshness.ts`:
   - Remove the unused `defineCommand("gh")` history workaround.
   - Add payload fields for `owner`, `repo`, and `ref`.
   - Add a `github-history` tool using Octokit.
   - Encode/decode tool arguments and results with Effect Schema.
   - Use tagged result values for found, not found, and unavailable history.
   - Pass `owner`, `repo`, and `ref` into the `check-staleness` skill args.
3. In `agents/doc-freshness/.agents/skills/check-staleness/SKILL.md`:
   - Replace `git -C ...` instructions with `github-history` calls.
   - Tell the agent to batch paths where practical.
   - Keep `check-url` for external link validation.
4. In `agents/doc-freshness/AGENTS.md`:
   - Remove instructions to use `bash` for `git`.
   - Document `github-history` as the commit evidence source.
5. In `.github/workflows/doc-freshness.yml`:
   - Expose `GH_TOKEN: ${{ github.token }}` to the freshness run.
   - Add `owner`, `repo`, and `ref` to the Flue payload.
6. Leave the existing report result schema unchanged for this slice.

## Verification

- [x] `agents/doc-freshness/AGENTS.md` no longer instructs agents to run `git`.
- [x] `check-staleness/SKILL.md` no longer contains `git -C`.
- [x] `doc-freshness.ts` includes `github-history` in the Flue tool list.
- [x] The workflow passes repository owner, repository name, ref, and `GH_TOKEN`.
- [x] `bun run --cwd agents/doc-freshness typecheck` passes.
- [x] Biome lint passes for the changed agent file.
- [x] The freshness result schema remains compatible with the existing workflow.

## Consequences

- CI freshness checks no longer depend on `git` being present in the Flue shell environment.
- The agent receives commit history as structured evidence instead of shell text.
- Local development without a GitHub token needs either `GH_TOKEN`/`GITHUB_TOKEN` or a future
  pure-JS local git fallback.
- Octokit becomes a runtime dependency of the doc-freshness agent.
- ADR-011 remains valid for dual-mode deployment, but its `bash git` history assumption should no
  longer guide new code.
