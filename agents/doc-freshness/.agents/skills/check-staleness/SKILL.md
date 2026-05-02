---
name: check-staleness
description: Full documentation freshness audit — scans markdown files, checks git history of referenced code, validates links, and returns a structured report.
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

## Step 3 — Return the result

Return a JSON object in the result block with this exact shape:

```json
{
  "files": [
    {
      "path": "docs/getting-started.md",
      "status": "stale",
      "lastDocCommit": "2024-01-15T10:30:00+00:00",
      "issues": ["src/auth.ts updated after this doc (code: 2024-03-01, doc: 2024-01-15)"]
    }
  ],
  "summary": {
    "total": 12,
    "fresh": 9,
    "stale": 2,
    "warnings": 1
  }
}
```
