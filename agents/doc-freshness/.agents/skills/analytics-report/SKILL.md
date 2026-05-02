---
name: analytics-report
description: Fetch 30-day page-view data from One Dollar Stats and format as a markdown report.
---

Call the `fetch-analytics` tool (no arguments needed) to get page-view data for the last 30 days.

## If the response contains an `error` field

Return:

```json
{
  "report": "## One Dollar Stats — 30d Page Views\n\n> ODS not configured: <error message>",
  "pageCount": 0,
  "totalViews": 0
}
```

## If the response contains a `results` array

Each entry has `dimensions: [urlPath]` and `metrics: [viewCount]`.

1. Sort entries by view count descending.
2. Sum all view counts → `totalViews`.
3. Count entries → `pageCount`.
4. Build a markdown report:

```markdown
## One Dollar Stats — 30d Page Views

| Page | Views |
| --- | --- |
| /flue-doc-agent/decisions/adr-006-.../ | 142 |
| /flue-doc-agent/diataxis/compass/ | 38 |
...

**Total: 738 views across 12 pages**
```

Return:

```json
{
  "report": "<the markdown string above>",
  "pageCount": 12,
  "totalViews": 738
}
```
