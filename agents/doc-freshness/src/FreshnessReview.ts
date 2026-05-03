import { Array as EffectArray, Match, Option, Schema } from "effect";

const pageViewsSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

export const freshnessReviewInputFileSchema = Schema.Struct({
	path: Schema.String,
	lastDocCommit: Schema.String,
	staleReasons: Schema.Array(Schema.String),
	warningReasons: Schema.Array(Schema.String),
	pageViews30d: Schema.optional(pageViewsSchema),
});

export const freshnessReviewInputSchema = Schema.Struct({
	files: Schema.Array(freshnessReviewInputFileSchema),
	pageviewThreshold: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
});

export const freshnessReviewedFileSchema = Schema.Struct({
	path: Schema.String,
	status: Schema.Literals(["fresh", "stale", "warning"]),
	priority: Schema.optional(Schema.Literals(["critical", "medium", "low"])),
	pageViews30d: Schema.optional(pageViewsSchema),
	lastDocCommit: Schema.String,
	issues: Schema.Array(Schema.String),
});

export const freshnessSummarySchema = Schema.Struct({
	total: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
	fresh: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
	stale: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
	warnings: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
	critical: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});

export const freshnessReviewSchema = Schema.Struct({
	files: Schema.Array(freshnessReviewedFileSchema),
	summary: freshnessSummarySchema,
	shouldFail: Schema.Boolean,
});

export const freshnessReviewJsonSchema = Schema.fromJsonString(freshnessReviewSchema);

export type FreshnessReviewInput = typeof freshnessReviewInputSchema.Type;
export type FreshnessReviewInputFile = typeof freshnessReviewInputFileSchema.Type;
export type FreshnessReviewedFile = typeof freshnessReviewedFileSchema.Type;
export type FreshnessSummary = typeof freshnessSummarySchema.Type;
export type FreshnessReview = typeof freshnessReviewSchema.Type;

const issueList = (file: FreshnessReviewInputFile) =>
	EffectArray.appendAll(file.staleReasons, file.warningReasons);

const statusForFile = (file: FreshnessReviewInputFile) =>
	Match.value([file.staleReasons.length > 0, file.warningReasons.length > 0]).pipe(
		Match.when([true, Match.any], (): FreshnessReviewedFile["status"] => "stale"),
		Match.when([false, true], (): FreshnessReviewedFile["status"] => "warning"),
		Match.orElse((): FreshnessReviewedFile["status"] => "fresh"),
	);

const highDemand = (pageViews30d: number | undefined, pageviewThreshold: number) =>
	(pageViews30d ?? 0) > pageviewThreshold;

const priorityForStale = (isHighDemand: boolean) =>
	Match.value(isHighDemand).pipe(
		Match.when(true, (): "critical" => "critical"),
		Match.orElse((): "low" => "low"),
	);

const priorityForWarning = (isHighDemand: boolean) =>
	Match.value(isHighDemand).pipe(
		Match.when(true, (): "medium" => "medium"),
		Match.orElse((): "low" => "low"),
	);

const priorityForFile = (
	status: FreshnessReviewedFile["status"],
	pageViews30d: number | undefined,
	pageviewThreshold: number,
) =>
	Match.value(status).pipe(
		Match.when("fresh", () => Option.none<"critical" | "medium" | "low">()),
		Match.when("stale", () =>
			Option.some(priorityForStale(highDemand(pageViews30d, pageviewThreshold))),
		),
		Match.orElse(() =>
			Option.some(priorityForWarning(highDemand(pageViews30d, pageviewThreshold))),
		),
	);

const withOptionalPriority = (
	file: Omit<FreshnessReviewedFile, "priority">,
	priority: Option.Option<"critical" | "medium" | "low">,
) =>
	Option.match(priority, {
		onNone: () => freshnessReviewedFileSchema.make(file),
		onSome: (availablePriority) =>
			freshnessReviewedFileSchema.make({
				path: file.path,
				status: file.status,
				pageViews30d: file.pageViews30d,
				lastDocCommit: file.lastDocCommit,
				issues: file.issues,
				priority: availablePriority,
			}),
	});

const reviewFile = (
	file: FreshnessReviewInputFile,
	pageviewThreshold: number,
): FreshnessReviewedFile => {
	const status = statusForFile(file);
	const reviewed = {
		path: file.path,
		status,
		pageViews30d: file.pageViews30d,
		lastDocCommit: file.lastDocCommit,
		issues: issueList(file),
	};

	return withOptionalPriority(
		reviewed,
		priorityForFile(status, file.pageViews30d, pageviewThreshold),
	);
};

const countStatus = (
	files: ReadonlyArray<FreshnessReviewedFile>,
	status: FreshnessReviewedFile["status"],
) => files.filter((file) => file.status === status).length;

const countCritical = (files: ReadonlyArray<FreshnessReviewedFile>) =>
	files.filter((file) => file.priority === "critical").length;

const summaryForFiles = (files: ReadonlyArray<FreshnessReviewedFile>): FreshnessSummary =>
	freshnessSummarySchema.make({
		total: files.length,
		fresh: countStatus(files, "fresh"),
		stale: countStatus(files, "stale"),
		warnings: countStatus(files, "warning"),
		critical: countCritical(files),
	});

export const reviewFreshness = (input: FreshnessReviewInput): FreshnessReview => {
	const files = input.files.map((file) => reviewFile(file, input.pageviewThreshold));
	const summary = summaryForFiles(files);

	return freshnessReviewSchema.make({
		files,
		summary,
		shouldFail: summary.critical > 0,
	});
};
