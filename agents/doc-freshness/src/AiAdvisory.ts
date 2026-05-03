import { Match, Schema } from "effect";

const nonNegativeIntegerSchema = Schema.Number.check(
	Schema.isInt(),
	Schema.isGreaterThanOrEqualTo(0),
);

export const semanticImpactSchema = Schema.Literals(["none", "low", "medium", "high"]);
export const advisoryConfidenceSchema = Schema.Literals(["low", "medium", "high"]);
export const staleClassificationSchema = Schema.Literals([
	"real-stale",
	"needs-review",
	"probably-harmless",
]);
export const deterministicPrioritySchema = Schema.Literals(["critical", "medium", "low"]);
export const aiFeatureSchema = Schema.Literals([
	"executive-summary",
	"semantic-impact",
	"implicit-relationships",
	"issue-body",
	"patch-proposal",
	"pr-comment",
]);
export const aiProvenanceSourceSchema = Schema.Literals(["openai", "fallback"]);
export const aiProviderSchema = Schema.Literals(["openai", "none"]);
export const advisoryRiskSeveritySchema = Schema.Literals(["critical", "high", "medium", "low"]);

export const semanticImpactReviewSchema = Schema.Struct({
	path: Schema.String,
	semanticImpact: semanticImpactSchema,
	confidence: advisoryConfidenceSchema,
	staleClassification: staleClassificationSchema,
	rationale: Schema.String,
	affectedSections: Schema.Array(Schema.String),
	suggestedFixes: Schema.Array(Schema.String),
});

export const aiFeatureProvenanceSchema = Schema.Struct({
	feature: aiFeatureSchema,
	source: aiProvenanceSourceSchema,
	provider: aiProviderSchema,
	model: Schema.String,
	inputTokens: nonNegativeIntegerSchema,
	outputTokens: nonNegativeIntegerSchema,
	totalTokens: nonNegativeIntegerSchema,
	itemCount: nonNegativeIntegerSchema,
	generatedAt: Schema.String,
	note: Schema.optional(Schema.String),
});

export const advisoryRiskSchema = Schema.Struct({
	path: Schema.String,
	severity: advisoryRiskSeveritySchema,
	reason: Schema.String,
});

export const advisoryActionSchema = Schema.Struct({
	path: Schema.String,
	priority: deterministicPrioritySchema,
	action: Schema.String,
});

export const advisoryRankingInputSchema = Schema.Struct({
	path: Schema.String,
	deterministicPriority: deterministicPrioritySchema,
	pageViews30d: nonNegativeIntegerSchema,
	staleClassification: staleClassificationSchema,
	semanticImpact: semanticImpactSchema,
	confidence: advisoryConfidenceSchema,
});

export const advisoryRankingSchema = Schema.Struct({
	path: Schema.String,
	deterministicPriority: deterministicPrioritySchema,
	pageViews30d: nonNegativeIntegerSchema,
	staleClassification: staleClassificationSchema,
	semanticImpact: semanticImpactSchema,
	confidence: advisoryConfidenceSchema,
	statsScore: Schema.Number,
	aiImpactScore: Schema.Number,
	finalScore: Schema.Number,
	reason: Schema.String,
});

export type SemanticImpact = typeof semanticImpactSchema.Type;
export type AdvisoryConfidence = typeof advisoryConfidenceSchema.Type;
export type StaleClassification = typeof staleClassificationSchema.Type;
export type DeterministicPriority = typeof deterministicPrioritySchema.Type;
export type AiFeature = typeof aiFeatureSchema.Type;
export type AiFeatureProvenance = typeof aiFeatureProvenanceSchema.Type;
export type SemanticImpactReview = typeof semanticImpactReviewSchema.Type;
export type AdvisoryRisk = typeof advisoryRiskSchema.Type;
export type AdvisoryAction = typeof advisoryActionSchema.Type;
export type AdvisoryRankingInput = typeof advisoryRankingInputSchema.Type;
export type AdvisoryRanking = typeof advisoryRankingSchema.Type;

const priorityScore = (priority: DeterministicPriority) =>
	Match.value(priority).pipe(
		Match.when("critical", () => 40),
		Match.when("medium", () => 25),
		Match.orElse(() => 10),
	);

const semanticImpactScore = (impact: SemanticImpact) =>
	Match.value(impact).pipe(
		Match.when("high", () => 20),
		Match.when("medium", () => 12),
		Match.when("low", () => 5),
		Match.orElse(() => 0),
	);

const staleClassificationScore = (classification: StaleClassification) =>
	Match.value(classification).pipe(
		Match.when("real-stale", () => 15),
		Match.when("needs-review", () => 6),
		Match.orElse(() => -10),
	);

const confidenceScore = (confidence: AdvisoryConfidence) =>
	Match.value(confidence).pipe(
		Match.when("high", () => 8),
		Match.when("medium", () => 4),
		Match.orElse(() => 0),
	);

const normalizedPageViewScore = (pageViews30d: number, maxPageViews30d: number) =>
	Match.value(maxPageViews30d > 0).pipe(
		Match.when(true, () => Math.round((pageViews30d / maxPageViews30d) * 25)),
		Match.orElse(() => 0),
	);

const maxPageViews30d = (candidates: ReadonlyArray<AdvisoryRankingInput>) =>
	candidates.reduce((max, candidate) => Math.max(max, candidate.pageViews30d), 0);

const rankingReason = (candidate: AdvisoryRankingInput) =>
	`${candidate.deterministicPriority} deterministic priority, ${candidate.pageViews30d.toLocaleString("en-GB")} 30d views, ${candidate.semanticImpact} semantic impact, ${candidate.staleClassification}, ${candidate.confidence} confidence`;

const rankingForCandidate = (maxViews: number) => (candidate: AdvisoryRankingInput) => {
	const statsScore =
		priorityScore(candidate.deterministicPriority) +
		normalizedPageViewScore(candidate.pageViews30d, maxViews);
	const aiImpactScore =
		semanticImpactScore(candidate.semanticImpact) +
		staleClassificationScore(candidate.staleClassification) +
		confidenceScore(candidate.confidence);

	return advisoryRankingSchema.make({
		path: candidate.path,
		deterministicPriority: candidate.deterministicPriority,
		pageViews30d: candidate.pageViews30d,
		staleClassification: candidate.staleClassification,
		semanticImpact: candidate.semanticImpact,
		confidence: candidate.confidence,
		statsScore,
		aiImpactScore,
		finalScore: statsScore + aiImpactScore,
		reason: rankingReason(candidate),
	});
};

const compareRanking = (left: AdvisoryRanking, right: AdvisoryRanking) =>
	right.finalScore - left.finalScore ||
	right.pageViews30d - left.pageViews30d ||
	left.path.localeCompare(right.path);

export const rankAdvisoryCandidates = (
	candidates: ReadonlyArray<AdvisoryRankingInput>,
): ReadonlyArray<AdvisoryRanking> => {
	const maxViews = maxPageViews30d(candidates);

	return candidates.map(rankingForCandidate(maxViews)).sort(compareRanking);
};
