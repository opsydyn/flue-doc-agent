import { describe, expect, test } from "bun:test";
import { reviewFreshness } from "../FreshnessReview";

describe("reviewFreshness", () => {
	test("scores fresh, warning, stale, and critical outcomes deterministically", () => {
		const review = reviewFreshness({
			pageviewThreshold: 50,
			files: [
				{
					path: "docs/fresh.md",
					lastDocCommit: "2026-05-01T00:00:00Z",
					staleReasons: [],
					warningReasons: [],
				},
				{
					path: "docs/warning.md",
					lastDocCommit: "2026-05-01T00:00:00Z",
					staleReasons: [],
					warningReasons: ["dead link: https://example.com (unreachable)"],
					pageViews30d: 70,
				},
				{
					path: "docs/stale-low.md",
					lastDocCommit: "2026-05-01T00:00:00Z",
					staleReasons: ["src/a.ts updated after this doc"],
					warningReasons: [],
					pageViews30d: 50,
				},
				{
					path: "docs/stale-critical.md",
					lastDocCommit: "2026-05-01T00:00:00Z",
					staleReasons: ["src/b.ts updated after this doc"],
					warningReasons: ["dead link: https://docs.example.com (500)"],
					pageViews30d: 51,
				},
			],
		});

		expect(review.files).toEqual([
			{
				path: "docs/fresh.md",
				status: "fresh",
				lastDocCommit: "2026-05-01T00:00:00Z",
				issues: [],
			},
			{
				path: "docs/warning.md",
				status: "warning",
				priority: "medium",
				pageViews30d: 70,
				lastDocCommit: "2026-05-01T00:00:00Z",
				issues: ["dead link: https://example.com (unreachable)"],
			},
			{
				path: "docs/stale-low.md",
				status: "stale",
				priority: "low",
				pageViews30d: 50,
				lastDocCommit: "2026-05-01T00:00:00Z",
				issues: ["src/a.ts updated after this doc"],
			},
			{
				path: "docs/stale-critical.md",
				status: "stale",
				priority: "critical",
				pageViews30d: 51,
				lastDocCommit: "2026-05-01T00:00:00Z",
				issues: ["src/b.ts updated after this doc", "dead link: https://docs.example.com (500)"],
			},
		]);
		expect(review.summary).toEqual({
			total: 4,
			fresh: 1,
			stale: 2,
			warnings: 1,
			critical: 1,
		});
		expect(review.shouldFail).toBe(true);
	});
});
