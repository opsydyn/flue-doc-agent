---
name: check-staleness
description: Full documentation freshness audit — scans markdown files, checks git history of referenced code, validates links, scores by page-view demand, and returns a structured report.
---

Perform a full documentation freshness audit for the repository at `{{repoPath}}`.

## Step 1 — Find all markdown files

Call `list-docs` with `repoPath: "{{repoPath}}"` and `glob: "{{glob}}"`. Parse the returned
JSON and use its `files` array as the complete list of docs to audit. Ignore any paths containing
`node_modules/`, `dist/`, or `.git/`.

The `files` array contains paths relative to `{{repoPath}}`; use those paths when reporting files
or when requesting commit history.

## Step 2 — For each markdown file

For each file found:

1. **Get the doc's latest commit evidence:**

   Call `github-history` with:

   ```json
   {
     "owner": "{{owner}}",
     "repo": "{{repo}}",
     "ref": "{{ref}}",
     "paths": ["<relative-path>"]
   }
   ```

   Parse the returned JSON and use the tagged result:
   - `{ "_tag": "CommitFound", "committedAt": "..." }` — use `committedAt` as the doc commit date.
   - `{ "_tag": "NoCommitFound" }` — skip the file.
   - `{ "_tag": "HistoryUnavailable", "reason": "..." }` — skip the file unless another issue is
     independently backed by evidence.

2. **Read parsed markdown evidence:**

   Call `read-doc` with:

   ```json
   {
     "repoPath": "{{repoPath}}",
     "path": "<relative-path>"
   }
   ```

   Parse the returned JSON and use the tagged result:
   - `{ "_tag": "DocRead", ... }` — use `internalLinks`, `externalLinks`, and `codeReferences`.
   - `{ "_tag": "DocUnavailable", "reason": "..." }` — skip the file unless commit evidence
     already proves another issue.

3. **For referenced code files**, get latest commit evidence:

   Call `github-history` once per doc with the `codeReferences` paths batched in `paths`.

   If a referenced code file returns `{ "_tag": "CommitFound" }` and its `committedAt` is **newer**
   than the doc's `committedAt`, add issue:
   `"<code-file> updated after this doc (code: <date>, doc: <date>)"`.

   Ignore `NoCommitFound` and `HistoryUnavailable` for staleness scoring; only flag staleness backed
   by commit evidence.

4. **Check internal markdown links** — for each `internalLinks` item ending in `.md` or `.mdx`,
   verify the target file exists in the `files` array from `list-docs`. Resolve relative links from
   the current document path. Missing targets → issue:
   `"broken link: <target>"`

5. **Check external links** — for each `externalLinks` URL, call `check-url`.
   Parse the returned JSON tagged result:
   - `{ "_tag": "Reachable", "statusCode": N }` — if `N` is outside `200..299`, add issue: `"dead link: <url> (<N>)"`
   - `{ "_tag": "Unreachable", "reason": "..." }` — add issue: `"dead link: <url> (unreachable)"`
   - `{ "_tag": "InvalidUrl", "reason": "..." }` — add issue: `"dead link: <url> (invalid-url)"`

6. Keep evidence structured for review:
   - Add code-commit evidence issues to `staleReasons`.
   - Add broken internal links and dead external URLs to `warningReasons`.
   - Do not assign status or priority yourself; `review-freshness` does that deterministically.

## Step 3 — Review structured evidence

Page-view signals: `{{pageviews}}` is a JSON object mapping relative file path → 30-day view
count from the deployed docs site. `{{repoTraffic}}` maps GitHub repo path → 14-day view count.
Either may be the string `"null"` if signals were not fetched this run.

The threshold for "high demand" is `{{pageviewThreshold}}` views in 30 days.

Parse the pageviews JSON (if not `"null"`), then for each file look up its path.

Call `review-freshness` once with:

```json
{
  "pageviewThreshold": 50,
  "files": [
    {
      "path": "<relative-doc-path>",
      "lastDocCommit": "<doc commit timestamp>",
      "staleReasons": ["..."],
      "warningReasons": ["..."],
      "pageViews30d": 123
    }
  ]
}
```

Use `{{pageviewThreshold}}` as the numeric `pageviewThreshold`. Omit `pageViews30d` when page-view
signals are null or the doc path is not present.

Parse the returned JSON and use its `files`, `summary`, and `shouldFail` fields as authoritative.
The tool applies the deterministic status/priority table:

| Evidence | 30-day page views | Result |
| --- | --- | --- |
| `staleReasons` non-empty | > threshold | `status: "stale"`, `priority: "critical"` |
| `staleReasons` non-empty | ≤ threshold or unknown | `status: "stale"`, `priority: "low"` |
| no stale reasons, `warningReasons` non-empty | > threshold | `status: "warning"`, `priority: "medium"` |
| no stale reasons, `warningReasons` non-empty | ≤ threshold or unknown | `status: "warning"`, `priority: "low"` |
| no stale or warning reasons | any | `status: "fresh"`, no priority |

## Step 4 — Generate the CI report

Compose a GitHub-flavoured markdown string for the `report` field. Include:

1. A summary table:

   ```markdown
   ## Doc Freshness Report

   | Status | Count |
   | --- | --- |
   | Total | N |
   | Fresh | N |
   | Stale | N |
   | Warnings | N |
   | Critical | N |
   ```

2. If any files have `priority: "critical"`, a **Critical (stale + high demand)** section listing
   each file as `- **path** (N views) — issue1; issue2`.

3. If any stale files have `priority: "low"`, a **Stale (low demand)** section listing each file.

4. If any files have status `"warning"`, a **Warnings** section listing each file.

Use the `shouldFail` value returned by `review-freshness`.

## Step 5 — Return the result

Return a JSON object in the result block with this exact shape:

```json
{
  "files": [
    {
      "path": "packages/docs/src/content/docs/decisions/ADR-006-url-checker-anti-corruption-layer.md",
      "status": "stale",
      "priority": "critical",
      "pageViews30d": 142,
      "lastDocCommit": "2024-01-15T10:30:00+00:00",
      "issues": ["agents/doc-freshness/src/UrlChecker.ts updated after this doc (code: 2024-03-01, doc: 2024-01-15)"]
    },
    {
      "path": "packages/docs/src/content/docs/diataxis/compass.md",
      "status": "fresh",
      "lastDocCommit": "2024-05-01T09:00:00+00:00",
      "issues": []
    }
  ],
  "summary": {
    "total": 12,
    "fresh": 9,
    "stale": 2,
    "warnings": 1,
    "critical": 1
  },
  "report": "## Doc Freshness Report\n\n| Status | Count |\n| --- | --- |\n| Total | 12 |\n...",
  "shouldFail": true
}
```

`priority` and `pageViews30d` are omitted for `fresh` files. `summary.critical` is the count
of files with `priority: "critical"`. `shouldFail` is `true` when `summary.critical > 0`.
