import { type Brand, Match, Optic, Result } from "effect";

// --- HttpUrl ---

export type HttpUrl = Brand.Branded<string, "HttpUrl">;

export const httpUrl = Optic.makePrism<string, HttpUrl>(
	(s) =>
		Match.value(s).pipe(
			Match.when(
				(str) => /^https?:\/\/.+/i.test(str),
				(str) => Result.succeed(str as HttpUrl),
			),
			Match.orElse((str) => Result.fail(`not a valid HTTP URL: ${str}`)),
		),
	(u: HttpUrl): string => u,
);

// --- HttpStatusCode ---

export type HttpStatusCode = Brand.Branded<number, "HttpStatusCode">;

export const httpStatusCode = Optic.makePrism<number, HttpStatusCode>(
	(n) =>
		Match.value(n).pipe(
			Match.when(
				(num) => Number.isInteger(num) && num >= 100 && num < 600,
				(num) => Result.succeed(num as HttpStatusCode),
			),
			Match.orElse((num) => Result.fail(`not a valid HTTP status code: ${num}`)),
		),
	(code: HttpStatusCode): number => code,
);

// --- RelativeFilePath ---

// Path relative to the repo root (e.g. "packages/docs/src/content/docs/decisions/ADR-001.md")
export type RelativeFilePath = Brand.Branded<string, "RelativeFilePath">;

export const relativeFilePath = Optic.makeIso<RelativeFilePath, string>(
	(p: RelativeFilePath): string => p,
	(s: string): RelativeFilePath => s as RelativeFilePath,
);

// --- GitHubRepoPath ---

// Path as returned by the GitHub Traffic API (e.g. "/opsydyn/flue-doc-agent/blob/main/README.md")
export type GitHubRepoPath = Brand.Branded<string, "GitHubRepoPath">;

export const gitHubRepoPath = Optic.makeIso<GitHubRepoPath, string>(
	(p: GitHubRepoPath): string => p,
	(s: string): GitHubRepoPath => s as GitHubRepoPath,
);

// --- PageViews ---

// Non-negative integer count of page views over a window (30d ODS or 14d GitHub Traffic)
export type PageViews = Brand.Branded<number, "PageViews">;

export const pageViews = Optic.makePrism<number, PageViews>(
	(n) =>
		Match.value(n).pipe(
			Match.when(
				(num) => Number.isInteger(num) && num >= 0,
				(num) => Result.succeed(num as PageViews),
			),
			Match.orElse(() => Result.fail("page views must be a non-negative integer")),
		),
	(v: PageViews): number => v,
);

// --- PageviewThreshold ---

// Positive integer: minimum 30-day views for a doc to be considered "high demand"
export type PageviewThreshold = Brand.Branded<number, "PageviewThreshold">;

export const pageviewThreshold = Optic.makePrism<number, PageviewThreshold>(
	(n) =>
		Match.value(n).pipe(
			Match.when(
				(num) => Number.isInteger(num) && num > 0,
				(num) => Result.succeed(num as PageviewThreshold),
			),
			Match.orElse(() => Result.fail("pageview threshold must be a positive integer")),
		),
	(t: PageviewThreshold): number => t,
);
