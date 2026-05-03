import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import {
	advisoryRankingInputSchema,
	aiFeatureProvenanceSchema,
	rankAdvisoryCandidates,
	semanticImpactReviewSchema,
} from "../AiAdvisory";

const decodeSemanticImpactReview = Schema.decodeUnknownOption(semanticImpactReviewSchema);
const decodeAiFeatureProvenance = Schema.decodeUnknownOption(aiFeatureProvenanceSchema);
const decodeAdvisoryRankingInput = Schema.decodeUnknownOption(advisoryRankingInputSchema);

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
			feature: "executive-summary",
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
