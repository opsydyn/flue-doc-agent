---
title: "ADR-012: Freshness signals — GitHub Traffic API + One Dollar Stats"
---

# ADR-012: Freshness signals — GitHub Traffic API + One Dollar Stats

## Status

Accepted

## Date

2026-05-02

## Context

Git-based staleness (ADR-006, ADR-007) answers "has the code changed since this doc was
written?" It says nothing about whether anyone is reading the doc. A stale doc read by
nobody is low priority; a stale doc read by hundreds of people every week is a P1.

The missing dimension is **usage weight**: combining staleness × readership gives
actionable priority rather than a flat list of stale files.

Two distinct signals exist and are complementary:

| Signal | What it measures |
| --- | --- |
| **Git-based** | Developer demand — who is actively cloning the repo, viewing raw files on github.com, or referencing the source |
| **Page views** | Reader demand — who is visiting the deployed Starlight docs site |

A doc can have zero GitHub repo traffic but high page views (end-users who only read the
deployed site), or vice versa (contributors who read raw markdown on github.com but never
visit the rendered site).

The deployed site is an **Astro Starlight** project hosted on GitHub Pages. It generates
static HTML from the same markdown files the agent analyses. GitHub Pages provides no
built-in analytics.

### Why not Google Analytics

GA requires consent banners, is blocked by most ad blockers, and is overkill for a
single-digit dollar budget. Rejected on complexity and privacy grounds.

### Why not Plausible

Correct API shape, GDPR-clean, well-documented. Rejected solely on cost ($9/month vs
$1/month) — the API contract is nearly identical to One Dollar Stats, so migration is
trivial if needed.

### Why not GoatCounter

Free for public/open-source sites. Rejected because One Dollar Stats provides an npm
package for framework-native installation and a cleaner API response shape.

## Decision

Use two signals in combination:

### Signal 1 — GitHub Traffic API (git-based, free)

```http
GET /repos/:owner/:repo/traffic/popular/paths
GET /repos/:owner/:repo/traffic/views
```

- Requires `repo` scope; `GITHUB_TOKEN` provided automatically in Actions.
- Returns top 10 paths by view count within a 14-day rolling window.
- Used as a proxy for **contributor/developer demand** — people reading raw source,
  browsing the repo, or following file links from issues and PRs.
- Limitation: top 10 only, 14-day window, path refers to `github.com/owner/repo/blob/…`
  not the deployed site. Useful for ranking which docs contributors care about, not
  which pages end-users read.

### Signal 2 — One Dollar Stats (page views, $1/month)

```http
POST https://api.onedollarstats.com/api
x-api-key: <ODS_API_KEY>
Content-Type: application/json

{
  "site_id": "docs.example.com",
  "metrics": ["pageviews"],
  "date_range": "30d",
  "dimensions": ["event:page"]
}
```

Response:

```json
{
  "results": [
    { "dimensions": ["/decisions/adr-006/"], "metrics": [142] },
    { "dimensions": ["/decisions/adr-007/"], "metrics": [38] }
  ]
}
```

- GDPR-clean (cookieless), no consent banner required.
- npm package (`onedollarstats`) for Starlight-native installation via `astro.config.mjs`
  `head` config, or a `<script>` tag in the Starlight custom `Head` component.
- `ODS_API_KEY` stored as a GitHub Actions repository secret.
- Used as the primary **reader demand** signal — direct page view counts on the deployed
  docs site.

### Signal combination and priority scoring

The GitHub Actions workflow fetches both signals before invoking the agent and merges
them into a single `signals` object in the payload. The agent uses this to assign a
`priority` alongside the existing `status`:

| Staleness | Pageviews (30d) | Priority |
| --- | --- | --- |
| `stale` | > threshold (e.g. 50) | `critical` |
| `stale` | ≤ threshold | `low` |
| `warning` | > threshold | `medium` |
| `warning` | ≤ threshold | `low` |
| `fresh` | any | — (no action) |

The threshold is configurable via workflow input (`pageview_threshold`, default `50`).

### Payload shape (extended)

```typescript
// agents/doc-freshness/.flue/agents/doc-freshness.ts
type Payload = {
  repoPath: string
  glob?: string
  signals?: {
    // file path (relative to repoPath) → 30-day page views from One Dollar Stats
    pageviews: Record<string, number>
    // file path → 14-day view count from GitHub Traffic API (top 10 only)
    repoTraffic: Record<string, number>
    pageviewThreshold: number
  }
}
```

### Path normalisation

Starlight generates URL paths from file paths with predictable transformations:
`docs/decisions/ADR-006-url-checker-anti-corruption-layer.md`
→ `/decisions/adr-006-url-checker-anti-corruption-layer/`

The workflow step that fetches One Dollar Stats results maps URL paths back to file
paths using this inverse transform before building the `pageviews` record. A small
inline script in the workflow handles this — no extra dependency needed.

### GitHub Actions workflow (signals fetch step)

Added before the `flue run` step in `.github/workflows/doc-freshness.yml`:

```yaml
- name: Fetch analytics signals
  id: signals
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    ODS_API_KEY: ${{ secrets.ODS_API_KEY }}
    ODS_SITE_ID: ${{ vars.ODS_SITE_ID }}
  run: |
    # GitHub Traffic API — top 10 paths, 14-day window
    gh api repos/${{ github.repository }}/traffic/popular/paths \
      > /tmp/gh-traffic.json

    # One Dollar Stats — per-page views, 30-day window
    curl -s -X POST https://api.onedollarstats.com/api \
      -H "x-api-key: $ODS_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"site_id\":\"$ODS_SITE_ID\",\"metrics\":[\"pageviews\"],\"date_range\":\"30d\",\"dimensions\":[\"event:page\"]}" \
      > /tmp/ods-pageviews.json

    # Merge into a single signals JSON and write to GITHUB_OUTPUT
    node -e "
      const gh = require('/tmp/gh-traffic.json');
      const ods = require('/tmp/ods-pageviews.json');

      // Map ODS URL paths → relative file paths
      const pageviews = {};
      for (const row of ods.results ?? []) {
        const urlPath = row.dimensions[0];
        // /decisions/adr-006-.../ → docs/decisions/ADR-006-...md (approximate)
        // Agent tolerates fuzzy keys; exact mapping refined in implementation
        pageviews[urlPath] = row.metrics[0];
      }

      const repoTraffic = {};
      for (const row of gh) {
        repoTraffic[row.path] = row.count;
      }

      const signals = JSON.stringify({ pageviews, repoTraffic, pageviewThreshold: 50 });
      require('fs').appendFileSync(process.env.GITHUB_OUTPUT, 'signals=' + signals + '\n');
    "

- name: Run doc-freshness agent
  working-directory: agents/doc-freshness
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  run: |
    bunx flue run doc-freshness --target node \
      --id "run-${{ github.run_id }}" \
      --payload "{\"repoPath\":\"${{ github.workspace }}\",\"signals\":${{ steps.signals.outputs.signals }}}"
```

### Starlight integration

In `agents/doc-freshness/` (or the Starlight site package if separate):

```typescript
// astro.config.mjs
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      head: [
        {
          tag: 'script',
          attrs: {
            defer: true,
            src: 'https://cdn.onedollarstats.com/tracker.js',
            'data-site': import.meta.env.PUBLIC_ODS_SITE_ID,
          },
        },
      ],
    }),
  ],
});
```

`PUBLIC_ODS_SITE_ID` is a public env var (not a secret — the site ID is visible in the
page source regardless).

### Write-back frontmatter

The agent writes the following block to each analysed doc. Starlight renders it via a
custom `FreshnessNotice` Astro component that reads the frontmatter at build time:

```yaml
freshness:
  status: stale          # fresh | warning | stale
  priority: critical     # critical | medium | low (omitted when fresh)
  checked: 2026-05-02
  pageviews_30d: 142
  issues:
    - "src/UrlChecker.ts committed 2026-04-20, doc last updated 2026-03-10"
```

## Alternatives Considered

### Single signal only (git staleness, no analytics)

- Pros: Zero cost, already built
- Cons: Cannot distinguish a stale doc nobody reads from a stale doc blocking hundreds
  of users — both get the same severity
- Rejected: The priority tier is the entire point of adding analytics

### Use One Dollar Stats alone (drop GitHub Traffic API)

- Pros: Simpler — one signal, one secret
- Cons: GitHub Traffic API is free and takes one `gh api` call; dropping it loses the
  contributor-demand signal at zero marginal cost
- Rejected: Both signals are cheap enough to keep

### Self-host Umami or Plausible

- Pros: Free at runtime (after server cost), full data ownership
- Cons: Requires a persistent server, Docker, and ongoing maintenance; $1/month is
  cheaper than the ops time
- Rejected: Not worth the operational complexity at this scale

## Consequences

- `ODS_API_KEY` added as a GitHub Actions repository secret.
- `ODS_SITE_ID` added as a GitHub Actions repository variable (public, not a secret).
- `PUBLIC_ODS_SITE_ID` added to the Starlight site's `.env` (or `astro.config.mjs`
  directly if the site ID is considered non-sensitive).
- The `signals` payload field is optional — if the workflow step fails or is skipped,
  the agent falls back to git-only staleness with no priority tier.
- Path normalisation between ODS URL paths and repo file paths is an approximation at
  this stage. Exact mapping should be validated against the deployed Starlight URL
  structure before relying on `pageviews` counts for priority decisions.
- One Dollar Stats supports `"12mo"` and `"all"` date range presets and custom ISO8601
  ranges — strongly implies data is retained for the lifetime of the account with no
  rolling-window cap. For the weekly agent querying `"30d"` this is not a concern.
  Confirm `"all"` means account lifetime (not a rolling window) before building
  year-over-year trend comparisons; contact <help@drizzle.team> if needed.
- When the Starlight site moves to a custom domain, update `ODS_SITE_ID` accordingly —
  One Dollar Stats tracks by `site_id`, not by script key.
