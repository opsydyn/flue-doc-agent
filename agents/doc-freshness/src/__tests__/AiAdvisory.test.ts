import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import {
	addImplicitRelationshipsToReport,
	addPatchProposalToReport,
	advisoryRankingInputSchema,
	aiFeatureProvenanceSchema,
	buildAiAdvisoryReport,
	completeSemanticImpactReviews,
	docsLibrarianPickSchema,
	fallbackPatchProposalForReport,
	fallbackSemanticImpactReview,
	implicitDocCodeRelationshipSchema,
	issueBodyDraftSchema,
	patchProposalSchema,
	rankAdvisoryCandidates,
	selectDocsLibrarianPick,
	semanticImpactReviewSchema,
	topAdvisoryActions,
	topAdvisoryRisks,
} from "../AiAdvisory";

const decodeSemanticImpactReview = Schema.decodeUnknownOption(semanticImpactReviewSchema);
const decodeAiFeatureProvenance = Schema.decodeUnknownOption(aiFeatureProvenanceSchema);
const decodeAdvisoryRankingInput = Schema.decodeUnknownOption(advisoryRankingInputSchema);
const decodeDocsLibrarianPick = Schema.decodeUnknownOption(docsLibrarianPickSchema);
const decodeIssueBodyDraft = Schema.decodeUnknownOption(issueBodyDraftSchema);
const decodePatchProposal = Schema.decodeUnknownOption(patchProposalSchema);
const decodeImplicitRelationship = Schema.decodeUnknownOption(implicitDocCodeRelationshipSchema);

describe("AI advisory schemas", () => {
	test("decode valid semantic impact reviews", () => {
		const review = decodeSemanticImpactReview({
			path: "packages/docs/src/content/docs/analytics/freshness.md",
			semanticImpact: "high",
			confidence: "medium",
			staleClassification: "real-stale",
			rationale: "The documented workflow contradicts the current implementation.",
			affectedSections: ["Workflow", "Generated report"],
			suggestedFixes: ["Update the workflow description."],
		});

		expect(Option.isSome(review)).toBe(true);
	});

	test("reject malformed semantic impact reviews", () => {
		const review = decodeSemanticImpactReview({
			path: "packages/docs/src/content/docs/analytics/freshness.md",
			semanticImpact: "catastrophic",
			confidence: "certain",
			staleClassification: "definitely-stale",
			rationale: "The model got enthusiastic.",
			affectedSections: ["Workflow"],
			suggestedFixes: ["Try again with a schema."],
		});

		expect(Option.isNone(review)).toBe(true);
	});

	test("decode feature provenance with token counts", () => {
		const provenance = decodeAiFeatureProvenance({
			feature: "docs-librarian-pick",
			source: "openai",
			provider: "openai",
			model: "gpt-4.1-nano-2025-04-14",
			inputTokens: 649,
			outputTokens: 137,
			totalTokens: 786,
			itemCount: 1,
			generatedAt: "2026-05-03T22:45:00.000Z",
		});

		expect(Option.isSome(provenance)).toBe(true);
	});

	test("decode docs librarian picks", () => {
		const pick = decodeDocsLibrarianPick({
			path: "docs/critical.md",
			finalScore: 108,
			reason: "critical deterministic priority and high semantic impact",
			action: "Update the usage section.",
			note: "The Docs Librarian recommends starting here before the bananas organize.",
		});

		expect(Option.isSome(pick)).toBe(true);
	});

	test("decode issue body drafts, patch proposals, and implicit relationships", () => {
		const issueDraft = decodeIssueBodyDraft({
			path: "docs/critical.md",
			title: "Critical doc freshness: docs/critical.md",
			body: "<!-- doc-freshness:docs/critical.md -->\nbody",
			marker: "<!-- doc-freshness:docs/critical.md -->",
		});
		const patchProposal = decodePatchProposal({
			path: "docs/critical.md",
			status: "generated",
			title: "Patch proposal for docs/critical.md",
			rationale: "The usage section is stale.",
			proposedChanges: ["Update the usage section."],
			markdownArtifact: "### Patch proposal",
			requiresHumanReview: true,
		});
		const relationship = decodeImplicitRelationship({
			docPath: "docs/critical.md",
			codePath: "src/critical.ts",
			relationshipType: "implicit-ai-suggested",
			confidence: "low",
			reason: "The document names Critical and the source file exists.",
		});

		expect(Option.isSome(issueDraft)).toBe(true);
		expect(Option.isSome(patchProposal)).toBe(true);
		expect(Option.isSome(relationship)).toBe(true);
	});

	test("reject feature provenance with negative token counts", () => {
		const provenance = decodeAiFeatureProvenance({
			feature: "executive-summary",
			source: "openai",
			provider: "openai",
			model: "gpt-4.1-nano-2025-04-14",
			inputTokens: -1,
			outputTokens: 137,
			totalTokens: 786,
			itemCount: 1,
			generatedAt: "2026-05-03T22:45:00.000Z",
		});

		expect(Option.isNone(provenance)).toBe(true);
	});
});

describe("rankAdvisoryCandidates", () => {
	test("combines deterministic priority, views, semantic impact, classification, and confidence", () => {
		const rankings = rankAdvisoryCandidates([
			{
				path: "docs/critical.md",
				deterministicPriority: "critical",
				pageViews30d: 100,
				staleClassification: "real-stale",
				semanticImpact: "high",
				confidence: "high",
			},
			{
				path: "docs/medium.md",
				deterministicPriority: "medium",
				pageViews30d: 50,
				staleClassification: "needs-review",
				semanticImpact: "medium",
				confidence: "medium",
			},
			{
				path: "docs/probably-harmless.md",
				deterministicPriority: "low",
				pageViews30d: 100,
				staleClassification: "probably-harmless",
				semanticImpact: "none",
				confidence: "low",
			},
		]);

		expect(rankings.map((ranking) => ranking.path)).toEqual([
			"docs/critical.md",
			"docs/medium.md",
			"docs/probably-harmless.md",
		]);
		expect(rankings[0]).toMatchObject({
			path: "docs/critical.md",
			statsScore: 65,
			aiImpactScore: 43,
			finalScore: 108,
		});
		expect(rankings[1]).toMatchObject({
			path: "docs/medium.md",
			statsScore: 38,
			aiImpactScore: 22,
			finalScore: 60,
		});
		expect(rankings[2]).toMatchObject({
			path: "docs/probably-harmless.md",
			statsScore: 35,
			aiImpactScore: -10,
			finalScore: 25,
		});
	});

	test("uses zero view contribution when all candidates have no traffic", () => {
		const rankings = rankAdvisoryCandidates([
			{
				path: "docs/a.md",
				deterministicPriority: "low",
				pageViews30d: 0,
				staleClassification: "needs-review",
				semanticImpact: "low",
				confidence: "low",
			},
		]);

		expect(rankings).toEqual([
			{
				path: "docs/a.md",
				deterministicPriority: "low",
				pageViews30d: 0,
				staleClassification: "needs-review",
				semanticImpact: "low",
				confidence: "low",
				statsScore: 10,
				aiImpactScore: 11,
				finalScore: 21,
				reason:
					"low deterministic priority, 0 30d views, low semantic impact, needs-review, low confidence",
			},
		]);
	});

	test("validates ranking inputs before callers trust model-derived data", () => {
		const rankingInput = decodeAdvisoryRankingInput({
			path: "docs/negative-views.md",
			deterministicPriority: "critical",
			pageViews30d: -10,
			staleClassification: "real-stale",
			semanticImpact: "high",
			confidence: "high",
		});

		expect(Option.isNone(rankingInput)).toBe(true);
	});
});

describe("semantic advisory report helpers", () => {
	test("create needs-review fallbacks for missing semantic reviews", () => {
		const fallback = fallbackSemanticImpactReview(
			{
				path: "docs/missing.md",
				status: "stale",
				priority: "low",
				pageViews30d: 3,
				issues: ["src/missing.ts changed after this doc"],
			},
			"model unavailable",
		);

		expect(fallback).toEqual({
			path: "docs/missing.md",
			semanticImpact: "low",
			confidence: "low",
			staleClassification: "needs-review",
			rationale:
				"model unavailable; deterministic stale evidence: src/missing.ts changed after this doc",
			affectedSections: [],
			suggestedFixes: ["Review the deterministic freshness evidence manually."],
		});
	});

	test("complete semantic reviews in deterministic candidate order", () => {
		const reviews = completeSemanticImpactReviews(
			[
				{ path: "docs/a.md", status: "stale", priority: "critical", pageViews30d: 100 },
				{ path: "docs/b.md", status: "warning", priority: "low", pageViews30d: 0 },
			],
			[
				{
					path: "docs/b.md",
					semanticImpact: "none",
					confidence: "high",
					staleClassification: "probably-harmless",
					rationale: "The warning is unrelated to prose correctness.",
					affectedSections: [],
					suggestedFixes: ["Check the link manually."],
				},
			],
			"missing model output",
		);

		expect(reviews.map((review) => review.path)).toEqual(["docs/a.md", "docs/b.md"]);
		expect(reviews[0]?.staleClassification).toBe("needs-review");
		expect(reviews[1]?.staleClassification).toBe("probably-harmless");
	});

	test("build advisory reports with semantic reviews, rankings, and provenance", () => {
		const report = buildAiAdvisoryReport(
			[
				{ path: "docs/a.md", status: "stale", priority: "critical", pageViews30d: 100 },
				{ path: "docs/b.md", status: "warning", priority: "low", pageViews30d: 0 },
			],
			[
				{
					path: "docs/a.md",
					semanticImpact: "high",
					confidence: "high",
					staleClassification: "real-stale",
					rationale: "The docs contradict the implementation.",
					affectedSections: ["Usage"],
					suggestedFixes: ["Update the usage section."],
				},
			],
			[
				{
					feature: "semantic-impact",
					source: "fallback",
					provider: "none",
					model: "gpt-4.1-mini",
					inputTokens: 0,
					outputTokens: 0,
					totalTokens: 0,
					itemCount: 2,
					generatedAt: "2026-05-03T23:05:00.000Z",
					note: "test",
				},
			],
		);

		expect(report.semanticReviews).toHaveLength(2);
		expect(report.rankings[0]).toMatchObject({
			path: "docs/a.md",
			finalScore: 108,
		});
		expect(report.risks?.[0]).toMatchObject({
			path: "docs/a.md",
			severity: "critical",
		});
		expect(report.actions?.[0]).toMatchObject({
			path: "docs/a.md",
			action: "Update the usage section.",
		});
		expect(report.issueBodyDrafts?.[0]).toMatchObject({
			path: "docs/a.md",
			title: "Critical doc freshness: docs/a.md",
			marker: "<!-- doc-freshness:docs/a.md -->",
		});
		expect(report.issueBodyDrafts?.[0]?.body).toContain("Semantic impact: `high`");
		expect(report.librarianPick).toMatchObject({
			path: "docs/a.md",
			finalScore: 108,
			action: "Update the usage section.",
		});
		expect(report.provenance.map((entry) => entry.feature)).toEqual([
			"semantic-impact",
			"docs-librarian-pick",
		]);
	});

	test("derive top risks, next actions, and one librarian pick from rankings", () => {
		const rankings = rankAdvisoryCandidates([
			{
				path: "docs/high.md",
				deterministicPriority: "critical",
				pageViews30d: 100,
				staleClassification: "real-stale",
				semanticImpact: "high",
				confidence: "high",
			},
			{
				path: "docs/medium.md",
				deterministicPriority: "medium",
				pageViews30d: 50,
				staleClassification: "needs-review",
				semanticImpact: "medium",
				confidence: "medium",
			},
			{
				path: "docs/low.md",
				deterministicPriority: "low",
				pageViews30d: 0,
				staleClassification: "probably-harmless",
				semanticImpact: "none",
				confidence: "low",
			},
		]);
		const reviews = [
			{
				path: "docs/high.md",
				semanticImpact: "high" as const,
				confidence: "high" as const,
				staleClassification: "real-stale" as const,
				rationale: "The documented behaviour is now wrong.",
				affectedSections: ["Usage"],
				suggestedFixes: ["Rewrite the usage notes."],
			},
		];

		const risks = topAdvisoryRisks(rankings, reviews);
		const actions = topAdvisoryActions(rankings, reviews);
		const pick = selectDocsLibrarianPick(rankings, reviews);

		expect(risks.map((risk) => risk.path)).toEqual([
			"docs/high.md",
			"docs/medium.md",
			"docs/low.md",
		]);
		expect(risks[0]?.severity).toBe("critical");
		expect(actions[0]).toMatchObject({
			path: "docs/high.md",
			action: "Rewrite the usage notes.",
		});
		expect(Option.getOrThrow(pick)).toMatchObject({
			path: "docs/high.md",
			finalScore: 108,
			action: "Rewrite the usage notes.",
		});
	});

	test("add patch proposals, draft PR recommendations, and implicit relationships", () => {
		const baseReport = buildAiAdvisoryReport(
			[{ path: "docs/high.md", status: "stale", priority: "critical", pageViews30d: 100 }],
			[
				{
					path: "docs/high.md",
					semanticImpact: "high",
					confidence: "high",
					staleClassification: "real-stale",
					rationale: "The documented behaviour is now wrong.",
					affectedSections: ["Usage"],
					suggestedFixes: ["Rewrite the usage notes."],
				},
			],
			[],
		);
		const proposal = fallbackPatchProposalForReport(baseReport, "test fallback");
		const withProposal = addPatchProposalToReport(baseReport, proposal, {
			feature: "patch-proposal",
			source: "fallback",
			provider: "none",
			model: "gpt-4.1-mini",
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			itemCount: 1,
			generatedAt: "2026-05-04T08:00:00.000Z",
			note: "test",
		});
		const withRelationships = addImplicitRelationshipsToReport(
			withProposal,
			[
				{
					docPath: "docs/high.md",
					codePath: "src/high.ts",
					relationshipType: "implicit-ai-suggested",
					confidence: "low",
					reason: "The names match.",
				},
			],
			{
				feature: "implicit-relationships",
				source: "fallback",
				provider: "none",
				model: "deterministic-implicit-relationship-scanner",
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
				itemCount: 1,
				generatedAt: "2026-05-04T08:00:00.000Z",
				note: "test",
			},
		);

		expect(proposal).toMatchObject({
			path: "docs/high.md",
			status: "generated",
		});
		expect(withProposal.draftPr).toMatchObject({
			status: "ready",
			branchName: "doc-freshness/docs-high-md",
		});
		expect(withProposal.provenance.map((entry) => entry.feature)).toContain("pr-comment");
		expect(withRelationships.implicitRelationships?.[0]).toMatchObject({
			docPath: "docs/high.md",
			codePath: "src/high.ts",
		});
	});
});
