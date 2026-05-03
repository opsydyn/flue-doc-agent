# @doc-agent/docs

Astro Starlight documentation site for the doc-agent project, deployed to GitHub Pages.

Live at <https://opsydyn.github.io/flue-doc-agent/>.

This site is dogfooded — the `doc-freshness` agent runs against it on a weekly schedule
to check whether the docs are staying in sync with the code they describe.

## Commands

Run from this directory (`packages/docs/`):

| Command | Action |
| --- | --- |
| `bun run dev` | Start dev server at `localhost:4321` |
| `bun run build` | Build static site to `./dist/` |
| `bun run preview` | Preview production build locally |

The repo-level [`.env.schema`](../../.env.schema) is the environment contract. From the repo root,
run `bun run env:check` before CI-like builds. When a command needs resolved environment values,
prefer `varlock run -- <command>`.

## Content

Documentation lives in `src/content/docs/`. Starlight maps the file tree directly to
URL paths:

```text
src/content/docs/
├── index.mdx               → /
├── decisions/              → /decisions/*   (Architecture Decision Records)
└── guides/                 → /guides/*
```

Add a new page by creating a `.md` or `.mdx` file in the appropriate directory.
The sidebar entries for `decisions/` and `guides/` are auto-generated.

## Analytics

Page views are tracked with [One Dollar Stats](https://onedollarstats.com/).
The tracker script is wired in `astro.config.mjs` via the `head` option and reads
`PUBLIC_ODS_SITE_ID` from the environment. Set it in `.env` locally or as a repository
variable (`vars.PUBLIC_ODS_SITE_ID`) in GitHub Actions.

## Deployment

Pushes to `main` that touch `packages/docs/**` trigger
[`.github/workflows/deploy-docs.yml`](../../.github/workflows/deploy-docs.yml),
which builds the site with Bun and deploys to GitHub Pages via `actions/deploy-pages`.

Before the first deploy:

1. Enable GitHub Pages in repo Settings → Pages → Source: **GitHub Actions**
2. Set `site` and `base` in `astro.config.mjs` once the Pages URL is known
3. Add `PUBLIC_ODS_SITE_ID` as a repository variable and uncomment the tracker in `astro.config.mjs`
