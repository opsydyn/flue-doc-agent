import { describe, expect, test } from "bun:test";
import { planGithubDraftPr } from "../GithubDraftPr";

const readyDraftPr = {
	status: "ready" as const,
	branchName: "doc-freshness/packages-docs-src-content-docs-analytics-freshness-md",
	title: "Draft docs freshness proposal: packages/docs/src/content/docs/analytics/freshness.md",
	body: "Please review the proposed documentation changes.",
	comment: "The Docs Librarian has selected the freshness report for careful review.",
	reason: "Multiple dead links and code references need review.",
};

const patchProposal = {
	path: "packages/docs/src/content/docs/analytics/freshness.md",
	status: "generated" as const,
	title: "Patch proposal for packages/docs/src/content/docs/analytics/freshness.md",
	rationale: "The freshness report contains dead links.",
	proposedChanges: ["Update or remove dead links."],
	markdownArtifact: "### Patch proposal\n\nUpdate or remove dead links.",
	requiresHumanReview: true,
};

describe("planGithubDraftPr", () => {
	test("creates one draft PR action for a ready recommendation without an open PR", () => {
		const actions = planGithubDraftPr({ draftPr: readyDraftPr, patchProposal }, []);

		expect(actions).toHaveLength(1);
		expect(actions[0]).toMatchObject({
			_tag: "CreateGithubDraftPr",
			branchName: "doc-freshness/packages-docs-src-content-docs-analytics-freshness-md",
			title: "Draft docs freshness proposal: packages/docs/src/content/docs/analytics/freshness.md",
			comment: "The Docs Librarian has selected the freshness report for careful review.",
			proposalPath:
				".github/doc-freshness/draft-prs/doc-freshness-packages-docs-src-content-docs-analytics-freshness-md.md",
		});
		expect(actions[0]?.proposalContent).toContain(
			"<!-- doc-freshness-draft-pr:doc-freshness/packages-docs-src-content-docs-analytics-freshness-md -->",
		);
		expect(actions[0]?.proposalContent).toContain("Update or remove dead links.");
	});

	test("updates the generated proposal artifact for an existing open PR", () => {
		const actions = planGithubDraftPr({ draftPr: readyDraftPr, patchProposal }, [
			{
				number: 12,
				title: readyDraftPr.title,
				body: "old body",
				headRef: readyDraftPr.branchName,
			},
		]);

		expect(actions).toHaveLength(1);
		expect(actions[0]).toMatchObject({
			_tag: "UpdateGithubDraftPr",
			number: 12,
			branchName: readyDraftPr.branchName,
			title: readyDraftPr.title,
		});
	});

	test("does nothing when the advisory has no ready draft PR", () => {
		const actions = planGithubDraftPr(
			{
				draftPr: {
					status: "not-ready",
					branchName: "n/a",
					title: "Draft PR not recommended",
					body: "No valid patch proposal is ready.",
					comment: "No Docs Librarian PR comment was generated.",
					reason: "Patch proposal was skipped.",
				},
			},
			[],
		);

		expect(actions).toEqual([]);
	});
});
