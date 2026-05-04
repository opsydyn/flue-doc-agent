import { describe, expect, test } from "bun:test";
import { planGithubFreshnessIssues } from "../GithubFreshnessIssues";

const criticalFile = {
	path: "packages/docs/src/content/docs/decisions/ADR-001.md",
	status: "stale" as const,
	priority: "critical" as const,
	pageViews30d: 81,
	lastDocCommit: "2026-05-01T00:00:00Z",
	issues: ["agents/doc-freshness/src/a.ts updated after this doc"],
};

describe("planGithubFreshnessIssues", () => {
	test("creates an issue for each critical document without an existing marker", () => {
		const actions = planGithubFreshnessIssues(
			{
				files: [
					criticalFile,
					{
						path: "packages/docs/src/content/docs/guides/example.md",
						status: "warning",
						priority: "medium",
						pageViews30d: 90,
						lastDocCommit: "2026-05-01T00:00:00Z",
						issues: ["dead link"],
					},
				],
			},
			[],
		);
		expect(actions).toHaveLength(1);
		expect(actions[0]).toMatchObject({
			_tag: "CreateGithubFreshnessIssue",
			title: "Critical doc freshness: packages/docs/src/content/docs/decisions/ADR-001.md",
		});
		expect(actions[0]?.body).toContain(
			"<!-- doc-freshness:packages/docs/src/content/docs/decisions/ADR-001.md -->",
		);
		expect(actions[0]?.body).toContain("- agents/doc-freshness/src/a.ts updated after this doc");
	});

	test("updates an existing issue when critical evidence changes", () => {
		const actions = planGithubFreshnessIssues({ files: [criticalFile] }, [
			{
				number: 42,
				title: "Critical doc freshness: packages/docs/src/content/docs/decisions/ADR-001.md",
				body: "<!-- doc-freshness:packages/docs/src/content/docs/decisions/ADR-001.md -->\nold",
			},
		]);

		expect(actions).toHaveLength(1);
		expect(actions[0]).toMatchObject({
			_tag: "UpdateGithubFreshnessIssue",
			number: 42,
			title: "Critical doc freshness: packages/docs/src/content/docs/decisions/ADR-001.md",
		});
	});

	test("does nothing when the existing issue already matches the current critical evidence", () => {
		const [createAction] = planGithubFreshnessIssues({ files: [criticalFile] }, []);
		const actions = planGithubFreshnessIssues({ files: [criticalFile] }, [
			{
				number: 42,
				title: createAction?.title ?? "",
				body: createAction?.body,
			},
		]);

		expect(actions).toEqual([]);
	});

	test("uses advisory issue body drafts without changing deterministic issue decisions", () => {
		const actions = planGithubFreshnessIssues({ files: [criticalFile] }, [], {
			issueBodyDrafts: [
				{
					path: criticalFile.path,
					title: `Critical doc freshness: ${criticalFile.path}`,
					marker: `<!-- doc-freshness:${criticalFile.path} -->`,
					body: [
						`<!-- doc-freshness:${criticalFile.path} -->`,
						"",
						"AI advisory context: high impact.",
					].join("\n"),
				},
			],
		});

		expect(actions).toHaveLength(1);
		expect(actions[0]?.body).toContain("AI advisory context: high impact.");
		expect(actions[0]?.body).toContain(`<!-- doc-freshness:${criticalFile.path} -->`);
	});

	test("preserves deterministic markers when advisory draft bodies omit them", () => {
		const actions = planGithubFreshnessIssues({ files: [criticalFile] }, [], {
			issueBodyDrafts: [
				{
					path: criticalFile.path,
					title: `Critical doc freshness: ${criticalFile.path}`,
					marker: `<!-- doc-freshness:${criticalFile.path} -->`,
					body: "AI advisory body without a marker.",
				},
			],
		});

		expect(actions[0]?.body.startsWith(`<!-- doc-freshness:${criticalFile.path} -->`)).toBe(true);
		expect(actions[0]?.body).toContain("AI advisory body without a marker.");
	});
});
