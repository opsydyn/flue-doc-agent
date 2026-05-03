import { describe, expect, test } from "bun:test";
import {
	annotationsForFreshness,
	formatGithubActionsAnnotation,
} from "../GithubActionsAnnotations";

describe("GitHub Actions freshness annotations", () => {
	test("emits warning and error annotations for non-fresh documents", () => {
		const annotations = annotationsForFreshness({
			files: [
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
					path: "docs/stale.md",
					status: "stale",
					priority: "critical",
					pageViews30d: 90,
					lastDocCommit: "2026-05-01T00:00:00Z",
					issues: ["src/a.ts updated after this doc"],
				},
			],
		});

		expect(annotations).toEqual([
			{
				_tag: "GithubActionsWarningAnnotation",
				file: "docs/warning.md",
				title: "Documentation freshness warning",
				message: "dead link: https://example.com (unreachable)",
			},
			{
				_tag: "GithubActionsErrorAnnotation",
				file: "docs/stale.md",
				title: "Critical documentation freshness issue",
				message: "src/a.ts updated after this doc",
			},
		]);
	});

	test("formats annotations as escaped workflow commands", () => {
		expect(
			formatGithubActionsAnnotation({
				_tag: "GithubActionsErrorAnnotation",
				file: "docs/a:b,100%.md",
				title: "Critical: docs, stale",
				message: "line one\nline 100%",
			}),
		).toBe(
			"::error file=docs/a%3Ab%2C100%25.md,title=Critical%3A docs%2C stale::line one%0Aline 100%25",
		);
	});
});
