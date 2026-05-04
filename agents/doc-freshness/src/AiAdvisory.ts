import { Match, Option, Schema } from "effect";

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
	"docs-librarian-pick",
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

export const issueBodyDraftSchema = Schema.Struct({
	path: Schema.String,
	title: Schema.String,
	body: Schema.String,
	marker: Schema.String,
});

export const docsLibrarianPickSchema = Schema.Struct({
	path: Schema.String,
	finalScore: Schema.Number,
	reason: Schema.String,
	action: Schema.String,
	note: Schema.String,
});

export const patchProposalStatusSchema = Schema.Literals(["generated", "skipped"]);
export const patchProposalSchema = Schema.Struct({
	path: Schema.String,
	status: patchProposalStatusSchema,
	title: Schema.String,
	rationale: Schema.String,
	proposedChanges: Schema.Array(Schema.String),
	markdownArtifact: Schema.String,
	requiresHumanReview: Schema.Boolean,
});
export const patchProposalBatchSchema = Schema.Struct({
	proposals: Schema.Array(patchProposalSchema),
});

export const draftPrStatusSchema = Schema.Literals(["ready", "not-ready"]);
export const draftPrRecommendationSchema = Schema.Struct({
	status: draftPrStatusSchema,
	branchName: Schema.String,
	title: Schema.String,
	body: Schema.String,
	comment: Schema.String,
	reason: Schema.String,
});

export const relationshipTypeSchema = Schema.Literals(["explicit", "implicit-ai-suggested"]);
export const implicitDocCodeRelationshipSchema = Schema.Struct({
	docPath: Schema.String,
	codePath: Schema.String,
	relationshipType: relationshipTypeSchema,
	confidence: advisoryConfidenceSchema,
	reason: Schema.String,
});

export const advisoryRankingInputSchema = Schema.Struct({
	path: Schema.String,
	deterministicPriority: deterministicPrioritySchema,
	pageViews30d: nonNegativeIntegerSchema,
	staleClassification: staleClassificationSchema,
	semanticImpact: semanticImpactSchema,
	confidence: advisoryConfidenceSchema,
});

export const advisoryFreshnessCandidateSchema = Schema.Struct({
	path: Schema.String,
	status: Schema.Literals(["stale", "warning"]),
	priority: Schema.optional(deterministicPrioritySchema),
	pageViews30d: Schema.optional(nonNegativeIntegerSchema),
	lastDocCommit: Schema.optional(Schema.String),
	issues: Schema.optional(Schema.Array(Schema.String)),
});

export const semanticImpactReviewBatchSchema = Schema.Struct({
	reviews: Schema.Array(semanticImpactReviewSchema),
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

export const aiAdvisoryReportSchema = Schema.Struct({
	semanticReviews: Schema.Array(semanticImpactReviewSchema),
	rankings: Schema.Array(advisoryRankingSchema),
	risks: Schema.optional(Schema.Array(advisoryRiskSchema)),
	actions: Schema.optional(Schema.Array(advisoryActionSchema)),
	issueBodyDrafts: Schema.optional(Schema.Array(issueBodyDraftSchema)),
	librarianPick: Schema.optional(docsLibrarianPickSchema),
	patchProposal: Schema.optional(patchProposalSchema),
	draftPr: Schema.optional(draftPrRecommendationSchema),
	implicitRelationships: Schema.optional(Schema.Array(implicitDocCodeRelationshipSchema)),
	provenance: Schema.Array(aiFeatureProvenanceSchema),
});

export type SemanticImpact = typeof semanticImpactSchema.Type;
export type AdvisoryConfidence = typeof advisoryConfidenceSchema.Type;
export type StaleClassification = typeof staleClassificationSchema.Type;
export type DeterministicPriority = typeof deterministicPrioritySchema.Type;
export type AiFeature = typeof aiFeatureSchema.Type;
export type AiFeatureProvenance = typeof aiFeatureProvenanceSchema.Type;
export type SemanticImpactReview = typeof semanticImpactReviewSchema.Type;
export type SemanticImpactReviewBatch = typeof semanticImpactReviewBatchSchema.Type;
export type AdvisoryRisk = typeof advisoryRiskSchema.Type;
export type AdvisoryAction = typeof advisoryActionSchema.Type;
export type IssueBodyDraft = typeof issueBodyDraftSchema.Type;
export type DocsLibrarianPick = typeof docsLibrarianPickSchema.Type;
export type PatchProposal = typeof patchProposalSchema.Type;
export type PatchProposalBatch = typeof patchProposalBatchSchema.Type;
export type DraftPrRecommendation = typeof draftPrRecommendationSchema.Type;
export type ImplicitDocCodeRelationship = typeof implicitDocCodeRelationshipSchema.Type;
export type AdvisoryFreshnessCandidate = typeof advisoryFreshnessCandidateSchema.Type;
export type AdvisoryRankingInput = typeof advisoryRankingInputSchema.Type;
export type AdvisoryRanking = typeof advisoryRankingSchema.Type;
export type AiAdvisoryReport = typeof aiAdvisoryReportSchema.Type;

const docsLibrarianModel = () => "deterministic-docs-librarian";

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

const optionalIssues = (candidate: AdvisoryFreshnessCandidate) => candidate.issues ?? [];

const fallbackRationale = (candidate: AdvisoryFreshnessCandidate, note: string) =>
	`${note}; deterministic ${candidate.status} evidence: ${
		optionalIssues(candidate).join("; ") || "no listed issues"
	}`;

export const fallbackSemanticImpactReview = (
	candidate: AdvisoryFreshnessCandidate,
	note: string,
): SemanticImpactReview =>
	semanticImpactReviewSchema.make({
		path: candidate.path,
		semanticImpact: "low",
		confidence: "low",
		staleClassification: "needs-review",
		rationale: fallbackRationale(candidate, note),
		affectedSections: [],
		suggestedFixes: ["Review the deterministic freshness evidence manually."],
	});

const reviewForCandidate = (
	reviews: ReadonlyArray<SemanticImpactReview>,
	candidate: AdvisoryFreshnessCandidate,
	fallbackNote: string,
) =>
	Option.getOrElse(
		Option.fromNullishOr(reviews.find((review) => review.path === candidate.path)),
		() => fallbackSemanticImpactReview(candidate, fallbackNote),
	);

export const completeSemanticImpactReviews = (
	candidates: ReadonlyArray<AdvisoryFreshnessCandidate>,
	reviews: ReadonlyArray<SemanticImpactReview>,
	fallbackNote: string,
): ReadonlyArray<SemanticImpactReview> =>
	candidates.map((candidate) => reviewForCandidate(reviews, candidate, fallbackNote));

const rankingInputForReview = (
	candidate: AdvisoryFreshnessCandidate,
	review: SemanticImpactReview,
): AdvisoryRankingInput =>
	advisoryRankingInputSchema.make({
		path: candidate.path,
		deterministicPriority: candidate.priority ?? "low",
		pageViews30d: candidate.pageViews30d ?? 0,
		staleClassification: review.staleClassification,
		semanticImpact: review.semanticImpact,
		confidence: review.confidence,
	});

const reviewByPath = (reviews: ReadonlyArray<SemanticImpactReview>, path: string) =>
	Option.fromNullishOr(reviews.find((review) => review.path === path));

const reviewForRanking = (reviews: ReadonlyArray<SemanticImpactReview>, ranking: AdvisoryRanking) =>
	Option.getOrElse(reviewByPath(reviews, ranking.path), () =>
		semanticImpactReviewSchema.make({
			path: ranking.path,
			semanticImpact: ranking.semanticImpact,
			confidence: ranking.confidence,
			staleClassification: ranking.staleClassification,
			rationale: ranking.reason,
			affectedSections: [],
			suggestedFixes: ["Review the deterministic freshness evidence manually."],
		}),
	);

const riskSeverity = (ranking: AdvisoryRanking): AdvisoryRisk["severity"] =>
	Match.value([ranking.finalScore >= 90, ranking.finalScore >= 65, ranking.finalScore >= 40]).pipe(
		Match.when([true, Match.any, Match.any], (): AdvisoryRisk["severity"] => "critical"),
		Match.when([false, true, Match.any], (): AdvisoryRisk["severity"] => "high"),
		Match.when([false, false, true], (): AdvisoryRisk["severity"] => "medium"),
		Match.orElse((): AdvisoryRisk["severity"] => "low"),
	);

const riskReason = (ranking: AdvisoryRanking, review: SemanticImpactReview) =>
	`${ranking.reason}. ${review.rationale}`;

const riskForRanking =
	(reviews: ReadonlyArray<SemanticImpactReview>) => (ranking: AdvisoryRanking) =>
		advisoryRiskSchema.make({
			path: ranking.path,
			severity: riskSeverity(ranking),
			reason: riskReason(ranking, reviewForRanking(reviews, ranking)),
		});

export const topAdvisoryRisks = (
	rankings: ReadonlyArray<AdvisoryRanking>,
	reviews: ReadonlyArray<SemanticImpactReview>,
): ReadonlyArray<AdvisoryRisk> => rankings.slice(0, 3).map(riskForRanking(reviews));

const firstSuggestedFix = (review: SemanticImpactReview) =>
	Option.getOrElse(
		Option.fromNullishOr(review.suggestedFixes[0]),
		() => "Review the deterministic freshness evidence manually.",
	);

const actionForRanking =
	(reviews: ReadonlyArray<SemanticImpactReview>) => (ranking: AdvisoryRanking) => {
		const review = reviewForRanking(reviews, ranking);

		return advisoryActionSchema.make({
			path: ranking.path,
			priority: ranking.deterministicPriority,
			action: firstSuggestedFix(review),
		});
	};

export const topAdvisoryActions = (
	rankings: ReadonlyArray<AdvisoryRanking>,
	reviews: ReadonlyArray<SemanticImpactReview>,
): ReadonlyArray<AdvisoryAction> => rankings.slice(0, 3).map(actionForRanking(reviews));

export const advisoryIssueMarker = (path: string) => `<!-- doc-freshness:${path} -->`;

const issueDraftTitle = (path: string) => `Critical doc freshness: ${path}`;

const markdownList = (items: ReadonlyArray<string>, fallback: string) =>
	Match.value(items.length > 0).pipe(
		Match.when(true, () => items.map((item) => `- ${item}`).join("\n")),
		Match.orElse(() => `- ${fallback}`),
	);

const issueBodyDraftForCandidate = (
	candidate: AdvisoryFreshnessCandidate,
	review: SemanticImpactReview,
): IssueBodyDraft =>
	issueBodyDraftSchema.make({
		path: candidate.path,
		title: issueDraftTitle(candidate.path),
		marker: advisoryIssueMarker(candidate.path),
		body: [
			advisoryIssueMarker(candidate.path),
			"",
			"## Critical documentation freshness issue",
			"",
			`Document: \`${candidate.path}\``,
			"",
			`30-day page views: ${(candidate.pageViews30d ?? 0).toLocaleString("en-GB")}`,
			"",
			`Last doc commit: \`${candidate.lastDocCommit ?? "unknown"}\``,
			"",
			"### Deterministic evidence",
			"",
			markdownList(optionalIssues(candidate), "Review the freshness report."),
			"",
			"### AI advisory context",
			"",
			`Semantic impact: \`${review.semanticImpact}\``,
			"",
			`Confidence: \`${review.confidence}\``,
			"",
			`Classification: \`${review.staleClassification}\``,
			"",
			review.rationale,
			"",
			"### Affected sections",
			"",
			markdownList(review.affectedSections, "No specific section was identified."),
			"",
			"### Suggested action",
			"",
			markdownList(review.suggestedFixes, "Review the deterministic freshness evidence manually."),
			"",
			"### Provenance",
			"",
			"Issue creation/update decisions are deterministic. This body includes advisory AI context and should be reviewed by a maintainer.",
		].join("\n"),
	});

export const issueBodyDraftsForCandidates = (
	candidates: ReadonlyArray<AdvisoryFreshnessCandidate>,
	reviews: ReadonlyArray<SemanticImpactReview>,
): ReadonlyArray<IssueBodyDraft> =>
	candidates
		.filter((candidate) => candidate.priority === "critical")
		.map((candidate) =>
			issueBodyDraftForCandidate(
				candidate,
				reviewForCandidate(reviews, candidate, "AI semantic review unavailable"),
			),
		);

const librarianNote = (ranking: AdvisoryRanking, review: SemanticImpactReview, action: string) =>
	`The Docs Librarian recommends starting with ${ranking.path}: ${ranking.reason}. ${review.rationale} Suggested next shelf-tidying step: ${action} A small banana may be authorized after the evidence stops wobbling.`;

const pickForRanking = (
	reviews: ReadonlyArray<SemanticImpactReview>,
	ranking: AdvisoryRanking,
): DocsLibrarianPick => {
	const review = reviewForRanking(reviews, ranking);
	const action = firstSuggestedFix(review);

	return docsLibrarianPickSchema.make({
		path: ranking.path,
		finalScore: ranking.finalScore,
		reason: ranking.reason,
		action,
		note: librarianNote(ranking, review, action),
	});
};

export const selectDocsLibrarianPick = (
	rankings: ReadonlyArray<AdvisoryRanking>,
	reviews: ReadonlyArray<SemanticImpactReview>,
) => Option.map(Option.fromNullishOr(rankings[0]), (ranking) => pickForRanking(reviews, ranking));

const patchEligibleImpact = (impact: SemanticImpact) => impact === "medium" || impact === "high";

const patchEligibleReview = (review: SemanticImpactReview) =>
	review.confidence === "high" && patchEligibleImpact(review.semanticImpact);

const selectedReview = (report: AiAdvisoryReport) =>
	Option.flatMap(Option.fromNullishOr(report.librarianPick), (pick) =>
		Option.map(reviewByPath(report.semanticReviews, pick.path), (review) => ({ pick, review })),
	);

const selectedPatchReview = (report: AiAdvisoryReport) =>
	Option.filter(selectedReview(report), ({ review }) => patchEligibleReview(review));

const skippedPatchProposal = (path: string, reason: string): PatchProposal =>
	patchProposalSchema.make({
		path,
		status: "skipped",
		title: "Patch proposal not generated",
		rationale: reason,
		proposedChanges: [],
		markdownArtifact: `Patch proposal not generated: ${reason}`,
		requiresHumanReview: true,
	});

const generatedPatchProposal = (
	pick: DocsLibrarianPick,
	review: SemanticImpactReview,
	note: string,
): PatchProposal =>
	patchProposalSchema.make({
		path: pick.path,
		status: "generated",
		title: `Patch proposal for ${pick.path}`,
		rationale: `${review.rationale} ${note}`,
		proposedChanges: review.suggestedFixes,
		markdownArtifact: [
			`### Patch proposal for \`${pick.path}\``,
			"",
			`**Why this document:** ${pick.reason}`,
			"",
			`**Semantic impact:** ${review.semanticImpact} (${review.confidence} confidence)`,
			"",
			"**Proposed changes:**",
			"",
			markdownList(review.suggestedFixes, "Review and update the stale section manually."),
			"",
			"**Human review required:** yes. This artifact does not modify source docs automatically.",
		].join("\n"),
		requiresHumanReview: true,
	});

export const fallbackPatchProposalForReport = (report: AiAdvisoryReport, note: string) =>
	Option.match(selectedPatchReview(report), {
		onNone: () =>
			skippedPatchProposal(
				report.librarianPick?.path ?? "n/a",
				"Docs Librarian pick is not high-confidence with medium/high semantic impact.",
			),
		onSome: ({ pick, review }) => generatedPatchProposal(pick, review, note),
	});

const safeBranchSegment = (path: string) =>
	path
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-|-$/g, "")
		.slice(0, 80);

const readyDraftPr = (proposal: PatchProposal): DraftPrRecommendation =>
	draftPrRecommendationSchema.make({
		status: "ready",
		branchName: `doc-freshness/${safeBranchSegment(proposal.path) || "patch-proposal"}`,
		title: `Draft docs freshness proposal: ${proposal.path}`,
		body: [
			"This draft PR should be opened only after a maintainer applies and validates the proposed documentation changes.",
			"",
			proposal.markdownArtifact,
		].join("\n"),
		comment: `The Docs Librarian has selected ${proposal.path}. The patch proposal is ready for human review; please apply it gently, like shelving a book that may bite.`,
		reason: proposal.rationale,
	});

const notReadyDraftPr = (proposal: PatchProposal): DraftPrRecommendation =>
	draftPrRecommendationSchema.make({
		status: "not-ready",
		branchName: "n/a",
		title: "Draft PR not recommended",
		body: proposal.markdownArtifact,
		comment: "No Docs Librarian PR comment was generated because no valid patch proposal is ready.",
		reason: proposal.rationale,
	});

export const draftPrRecommendationForPatch = (proposal: PatchProposal) =>
	Match.value(proposal.status).pipe(
		Match.when("generated", () => readyDraftPr(proposal)),
		Match.orElse(() => notReadyDraftPr(proposal)),
	);

const prCommentProvenance = (draftPr: DraftPrRecommendation): ReadonlyArray<AiFeatureProvenance> =>
	Match.value(draftPr.status).pipe(
		Match.when("ready", () => [
			aiFeatureProvenanceSchema.make({
				feature: "pr-comment",
				source: "fallback",
				provider: "none",
				model: docsLibrarianModel(),
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
				itemCount: 1,
				generatedAt: new Date().toISOString(),
				note: "Draft PR comment artifact generated; no PR was opened automatically",
			}),
		]),
		Match.orElse(() => []),
	);

export const addPatchProposalToReport = (
	report: AiAdvisoryReport,
	proposal: PatchProposal,
	provenance: AiFeatureProvenance,
): AiAdvisoryReport => {
	const draftPr = draftPrRecommendationForPatch(proposal);

	return aiAdvisoryReportSchema.make({
		semanticReviews: report.semanticReviews,
		rankings: report.rankings,
		risks: report.risks ?? [],
		actions: report.actions ?? [],
		issueBodyDrafts: report.issueBodyDrafts ?? [],
		librarianPick: report.librarianPick,
		patchProposal: proposal,
		draftPr,
		implicitRelationships: report.implicitRelationships ?? [],
		provenance: [...report.provenance, provenance, ...prCommentProvenance(draftPr)],
	});
};

export const addImplicitRelationshipsToReport = (
	report: AiAdvisoryReport,
	implicitRelationships: ReadonlyArray<ImplicitDocCodeRelationship>,
	provenance: AiFeatureProvenance,
): AiAdvisoryReport =>
	aiAdvisoryReportSchema.make({
		semanticReviews: report.semanticReviews,
		rankings: report.rankings,
		risks: report.risks ?? [],
		actions: report.actions ?? [],
		issueBodyDrafts: report.issueBodyDrafts ?? [],
		librarianPick: report.librarianPick,
		patchProposal: report.patchProposal,
		draftPr: report.draftPr,
		implicitRelationships,
		provenance: [...report.provenance, provenance],
	});

const docsLibrarianPickProvenance = (pick: DocsLibrarianPick): AiFeatureProvenance =>
	aiFeatureProvenanceSchema.make({
		feature: "docs-librarian-pick",
		source: "fallback",
		provider: "none",
		model: docsLibrarianModel(),
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		itemCount: 1,
		generatedAt: new Date().toISOString(),
		note: `Selected ${pick.path} from deterministic ranking`,
	});

const reportWithPick = (
	semanticReviews: ReadonlyArray<SemanticImpactReview>,
	rankings: ReadonlyArray<AdvisoryRanking>,
	risks: ReadonlyArray<AdvisoryRisk>,
	actions: ReadonlyArray<AdvisoryAction>,
	issueBodyDrafts: ReadonlyArray<IssueBodyDraft>,
	provenance: ReadonlyArray<AiFeatureProvenance>,
	pick: DocsLibrarianPick,
) =>
	aiAdvisoryReportSchema.make({
		semanticReviews,
		rankings,
		risks,
		actions,
		issueBodyDrafts,
		librarianPick: pick,
		provenance: [...provenance, docsLibrarianPickProvenance(pick)],
	});

const reportWithoutPick = (
	semanticReviews: ReadonlyArray<SemanticImpactReview>,
	rankings: ReadonlyArray<AdvisoryRanking>,
	risks: ReadonlyArray<AdvisoryRisk>,
	actions: ReadonlyArray<AdvisoryAction>,
	issueBodyDrafts: ReadonlyArray<IssueBodyDraft>,
	provenance: ReadonlyArray<AiFeatureProvenance>,
) =>
	aiAdvisoryReportSchema.make({
		semanticReviews,
		rankings,
		risks,
		actions,
		issueBodyDrafts,
		provenance,
	});

export const buildAiAdvisoryReport = (
	candidates: ReadonlyArray<AdvisoryFreshnessCandidate>,
	reviews: ReadonlyArray<SemanticImpactReview>,
	provenance: ReadonlyArray<AiFeatureProvenance>,
): AiAdvisoryReport => {
	const semanticReviews = completeSemanticImpactReviews(
		candidates,
		reviews,
		"AI semantic review unavailable",
	);
	const rankingInputs = candidates.map((candidate, index) =>
		rankingInputForReview(
			candidate,
			semanticReviews[index] ??
				fallbackSemanticImpactReview(candidate, "AI semantic review unavailable"),
		),
	);
	const rankings = rankAdvisoryCandidates(rankingInputs);
	const risks = topAdvisoryRisks(rankings, semanticReviews);
	const actions = topAdvisoryActions(rankings, semanticReviews);
	const issueBodyDrafts = issueBodyDraftsForCandidates(candidates, semanticReviews);
	const pick = selectDocsLibrarianPick(rankings, semanticReviews);

	return Option.match(pick, {
		onNone: () =>
			reportWithoutPick(semanticReviews, rankings, risks, actions, issueBodyDrafts, provenance),
		onSome: (availablePick) =>
			reportWithPick(
				semanticReviews,
				rankings,
				risks,
				actions,
				issueBodyDrafts,
				provenance,
				availablePick,
			),
	});
};
