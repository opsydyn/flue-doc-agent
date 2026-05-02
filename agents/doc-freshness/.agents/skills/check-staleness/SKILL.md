---
name: check-staleness
description: Full documentation freshness audit — scans markdown files, checks git history of referenced code, validates links, scores by page-view demand, and returns a structured report.
---

Perform a full documentation freshness audit for the repository at `{{repoPath}}`.

## Step 1 — Find all markdown files

Use `glob` to find all files matching `{{glob}}` under `{{repoPath}}`. Ignore files inside
`node_modules/`, `dist/`, and `.git/`.

## Step 2 — For each markdown file

For each file found:

1. **Get the doc's last commit date:**

   ```bash
   git -C {{repoPath}} log -1 --format="%ai" -- <relative-path>
   ```

   If the file has no commits (untracked), skip it.

2. **Extract code references** using `grep` — look for:
   - Markdown links pointing to source files: `[text](path/to/file.ts)`
   - Fenced code blocks with a file path comment on the first line: `` ```ts // src/foo.ts ``
   - Bare file paths on their own line matching `src/`, `lib/`, `packages/`

3. **For each referenced code file**, get its last commit date:

   ```bash
   git -C {{repoPath}} log -1 --format="%ai" -- <code-file>
   ```

   If the code file's commit is **newer** than the doc's commit → issue: `"<code-file> updated after this doc (code: <date>, doc: <date>)"`

4. **Check internal markdown links** — for each `[text](./relative.md)` link, verify the
   target file exists under `{{repoPath}}`. Missing targets → issue: `"broken link: <target>"`

5. **Check external links** — for each `https?://` URL found in the file, call `check-url`.
   Non-2xx or unreachable → issue: `"dead link: <url> (<status>)"`

6. Assign status:
   - `stale` — any code file newer than the doc
   - `warning` — broken internal link or dead external URL (but no stale code refs)
   - `fresh` — no issues

## Step 3 — Score by demand (priority)

Page-view signals: `{{pageviews}}` is a JSON object mapping relative file path → 30-day view
count from the deployed docs site. `{{repoTraffic}}` maps GitHub repo path → 14-day view count.
Either may be the string `"null"` if signals were not fetched this run.

The threshold for "high demand" is `{{pageviewThreshold}}` views in 30 days.

Parse the pageviews JSON (if not `"null"`), then for each file look up its path. Apply:

| Status | 30-day page views | Priority |
| --- | --- | --- |
| `stale` | > threshold | `critical` |
| `stale` | ≤ threshold or not found | `low` |
| `warning` | > threshold | `medium` |
| `warning` | ≤ threshold or not found | `low` |
| `fresh` | any | omit priority field entirely |

Set `pageViews30d` to the integer from the pageviews map, or omit the field if the path is
not present or signals are null.

## Step 4 — Return the result

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
  }
}
```

`priority` and `pageViews30d` are omitted for `fresh` files. `summary.critical` is the count
of files with `priority: "critical"`.
