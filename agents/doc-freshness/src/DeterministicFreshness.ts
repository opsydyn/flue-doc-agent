import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Octokit } from "@octokit/rest";
import { Data, Effect, Match, Option } from "effect";
import { httpUrl } from "./Domain";
import {
	type FreshnessReviewedFile,
	type FreshnessReviewInputFile,
	type FreshnessSummary,
	freshnessReviewInputFileSchema,
	reviewFreshness,
} from "./FreshnessReview";
import {
	fetchGithubHistoryEntries,
	type GitHubHistoryClient,
	type GitHubHistoryEntry,
	makeHistoryUnavailable,
} from "./GithubHistory";
import { makeDocUnavailable, parseMarkdownDoc, type ReadDocResult } from "./MarkdownDoc";
import { UrlChecker, UrlCheckerDefault } from "./UrlChecker";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type SignalMap = { readonly [key: string]: number };

export type DeterministicFreshnessSignals = {
	readonly pageviews: SignalMap;
	readonly pageviewThreshold: number;
};

type DeterministicFreshnessInput = {
	readonly repoPath: string;
	readonly glob: string;
	readonly owner: string;
	readonly repo: string;
	readonly ref: string;
	readonly githubToken: string;
	readonly signals: Option.Option<DeterministicFreshnessSignals>;
};

type DeterministicFreshnessResult = {
	readonly files: ReadonlyArray<FreshnessReviewedFile>;
	readonly summary: FreshnessSummary;
	readonly report: string;
	readonly shouldFail: boolean;
};

type CommitFound = Extract<GitHubHistoryEntry, { readonly _tag: "CommitFound" }>;
type DocRead = Extract<ReadDocResult, { readonly _tag: "DocRead" }>;
type DocUnavailable = Extract<ReadDocResult, { readonly _tag: "DocUnavailable" }>;

class InvalidDeterministicUrl extends Data.TaggedError("InvalidDeterministicUrl")<{
	readonly reason: string;
}> {}

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

const markdownLinkPattern = /\.mdx?$/iu;
const staleDate = (date: string) => date.slice(0, 10);
const uniqueStrings = (values: ReadonlyArray<string>) => Array.from(new Set(values)).sort();

const isCommitFound = (entry: GitHubHistoryEntry): entry is CommitFound =>
	entry._tag === "CommitFound";

const isDocRead = (result: ReadDocResult): result is DocRead => result._tag === "DocRead";

const isDocUnavailable = (result: ReadDocResult): result is DocUnavailable =>
	result._tag === "DocUnavailable";

const logEvent = Effect.fn("DocFreshness.logEvent")(function* (
	event: string,
	details: { readonly [key: string]: unknown } = {},
) {
	yield* Effect.sync(() => {
		const detailText = Object.entries(details)
			.map(([key, value]) => `${key}=${String(value)}`)
			.join(" ");
		const suffix = Match.value(detailText.length > 0).pipe(
			Match.when(true, () => ` ${detailText}`),
			Match.orElse(() => ""),
		);
		process.stderr.write(`[doc-freshness] event=${event}${suffix}\n`);
	});
});

const globBaseDirectory = (repoPath: string, glob: string) => {
	const globMetaIndex = glob.search(/[*?{[]/);
	const staticPrefix = Match.value(globMetaIndex).pipe(
		Match.when(
			(index) => index >= 0,
			(index) => glob.slice(0, index),
		),
		Match.orElse(() => glob),
	);
	const directory = Match.value(staticPrefix.endsWith(path.sep)).pipe(
		Match.when(true, () => staticPrefix.slice(0, -1)),
		Match.orElse(() => path.dirname(staticPrefix)),
	);

	return Match.value(path.isAbsolute(directory)).pipe(
		Match.when(true, () => directory),
		Match.orElse(() => path.resolve(repoPath, directory)),
	);
};

const globExtensions = (glob: string) =>
	Match.value(glob).pipe(
		Match.when(
			(input) => input.includes("{md,mdx}") || input.includes("{mdx,md}"),
			() => [".md", ".mdx"] as const,
		),
		Match.when(
			(input) => input.endsWith(".mdx"),
			() => [".mdx"] as const,
		),
		Match.orElse(() => [".md"] as const),
	);

const matchedFileList = (fullPath: string, isMatch: boolean) =>
	Match.value(isMatch).pipe(
		Match.when(true, () => [fullPath]),
		Match.orElse(() => []),
	);

const listMarkdownEntry = (
	directory: string,
	extensions: ReadonlyArray<string>,
	entry: Dirent<string>,
) => {
	const fullPath = path.join(directory, entry.name);

	return Match.value(entry.isDirectory()).pipe(
		Match.when(true, () => listMarkdownFiles(fullPath, extensions)),
		Match.orElse(() =>
			Promise.resolve(
				matchedFileList(
					fullPath,
					extensions.some((extension) => entry.name.endsWith(extension)),
				),
			),
		),
	);
};

const listMarkdownFiles = async (
	directory: string,
	extensions: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> =>
	fs
		.readdir(directory, { withFileTypes: true })
		.then((entries) =>
			Promise.all(entries.map((entry) => listMarkdownEntry(directory, extensions, entry))),
		)
		.then((groups) => groups.flat())
		.catch(() => []);

const listMarkdownDocs = Effect.fn("DocFreshness.listMarkdownDocs")(function* (
	repoPath: string,
	glob: string,
) {
	const root = globBaseDirectory(repoPath, glob);
	const extensions = globExtensions(glob);
	const files = yield* Effect.promise(() => listMarkdownFiles(root, extensions));
	const relativeFiles = files
		.map((filePath) => path.relative(repoPath, filePath).replaceAll(path.sep, "/"))
		.sort();

	yield* logEvent("list_docs.done", { count: relativeFiles.length, root });

	return relativeFiles;
});

const githubHistoryClient = (client: Octokit): GitHubHistoryClient => ({
	listCommits: ({ owner, repo, ref, path: filePath }) =>
		client.rest.repos
			.listCommits({
				owner,
				repo,
				sha: ref,
				path: filePath,
				per_page: 1,
			})
			.then((response) => ({ data: response.data })),
});

const invalidGithubConfig = (
	paths: ReadonlyArray<string>,
	reason: string,
): ReadonlyArray<GitHubHistoryEntry> =>
	paths.map((filePath) => makeHistoryUnavailable(filePath, reason));

const githubHistoryTokenIssue = (token: string) =>
	Match.value(token.length === 0).pipe(
		Match.when(true, () => "GH_TOKEN or GITHUB_TOKEN is not configured"),
		Match.orElse(() => undefined),
	);

const githubHistoryRepositoryIssue = (owner: string, repo: string, ref: string) =>
	Match.value(owner.length === 0 || repo.length === 0 || ref.length === 0).pipe(
		Match.when(true, () => "GitHub owner, repo, or ref is missing"),
		Match.orElse(() => undefined),
	);

const githubHistoryConfigIssue = (token: string, owner: string, repo: string, ref: string) =>
	Option.fromNullishOr(
		githubHistoryTokenIssue(token) ?? githubHistoryRepositoryIssue(owner, repo, ref),
	);

const fetchGithubHistory = (input: DeterministicFreshnessInput, paths: ReadonlyArray<string>) => {
	const client = new Octokit({ auth: input.githubToken });
	return fetchGithubHistoryEntries(githubHistoryClient(client), {
		owner: input.owner,
		repo: input.repo,
		ref: input.ref,
		paths,
	});
};

const historyStats = (histories: ReadonlyArray<GitHubHistoryEntry>) => ({
	found: histories.filter((entry) => entry._tag === "CommitFound").length,
	missing: histories.filter((entry) => entry._tag === "NoCommitFound").length,
	unavailable: histories.filter((entry) => entry._tag === "HistoryUnavailable").length,
});

const fetchHistory = Effect.fn("DocFreshness.fetchHistory")(function* (
	input: DeterministicFreshnessInput,
	paths: ReadonlyArray<string>,
	kind: "docs" | "code",
) {
	const histories = yield* Option.match(
		githubHistoryConfigIssue(input.githubToken, input.owner, input.repo, input.ref),
		{
			onNone: () => Effect.promise(() => fetchGithubHistory(input, paths)),
			onSome: (reason) => Effect.succeed(invalidGithubConfig(paths, reason)),
		},
	);

	yield* logEvent("github_history.done", {
		kind,
		requested: paths.length,
		...historyStats(histories),
	});

	return histories;
});

const historyMap = (histories: ReadonlyArray<GitHubHistoryEntry>) =>
	new Map(histories.map((entry) => [entry.path, entry] as const));

const readMarkdownDoc = Effect.fn("DocFreshness.readMarkdownDoc")(function* (
	repoPath: string,
	filePath: string,
) {
	const fullPath = path.resolve(repoPath, filePath);

	return yield* Effect.tryPromise({
		try: () => fs.readFile(fullPath, "utf8").then((content) => parseMarkdownDoc(filePath, content)),
		catch: (cause) => makeDocUnavailable(filePath, cause),
	});
});

const readMarkdownDocs = Effect.fn("DocFreshness.readMarkdownDocs")(function* (
	repoPath: string,
	files: ReadonlyArray<string>,
) {
	const docs = yield* Effect.forEach(files, (filePath) => readMarkdownDoc(repoPath, filePath), {
		concurrency: 8,
	});
	const readDocs = docs.filter(isDocRead);

	yield* logEvent("read_docs.done", {
		requested: files.length,
		read: readDocs.length,
		unavailable: docs.length - readDocs.length,
		codeReferences: uniqueStrings(readDocs.flatMap((doc) => doc.codeReferences)).length,
		externalLinks: uniqueStrings(readDocs.flatMap((doc) => doc.externalLinks)).length,
	});

	return docs;
});

const isCommittedAfter = (codeCommit: string, docCommit: string) => {
	const codeTime = Date.parse(codeCommit);
	const docTime = Date.parse(docCommit);

	return Number.isFinite(codeTime) && Number.isFinite(docTime) && codeTime > docTime;
};

const staleReasonForReference = (
	docCommit: CommitFound,
	codeHistory: GitHubHistoryEntry | undefined,
) => {
	if (!codeHistory || !isCommitFound(codeHistory)) return Option.none<string>();

	return Match.value(isCommittedAfter(codeHistory.committedAt, docCommit.committedAt)).pipe(
		Match.when(true, () =>
			Option.some(
				`${codeHistory.path} updated after this doc (code: ${staleDate(codeHistory.committedAt)}, doc: ${staleDate(docCommit.committedAt)})`,
			),
		),
		Match.orElse(() => Option.none<string>()),
	);
};

const markdownLinkTarget = (docPath: string, target: string) => {
	const rawTarget = Match.value(target.startsWith("/")).pipe(
		Match.when(true, () => target.slice(1)),
		Match.orElse(() => path.posix.join(path.posix.dirname(docPath), target)),
	);

	return path.posix.normalize(rawTarget);
};

const brokenInternalLinkReason = (
	availableDocs: ReadonlySet<string>,
	target: string,
	resolvedTarget: string,
) =>
	Match.value(availableDocs.has(resolvedTarget)).pipe(
		Match.when(true, () => []),
		Match.orElse(() => [`broken link: ${target}`]),
	);

const brokenMarkdownLinkReasons = (
	doc: DocRead,
	availableDocs: ReadonlySet<string>,
	target: string,
) => brokenInternalLinkReason(availableDocs, target, markdownLinkTarget(doc.path, target));

const brokenInternalLinkReasons = (doc: DocRead, availableDocs: ReadonlySet<string>) =>
	doc.internalLinks.flatMap((target) =>
		Match.value(markdownLinkPattern.test(target)).pipe(
			Match.when(true, () => brokenMarkdownLinkReasons(doc, availableDocs, target)),
			Match.orElse(() => []),
		),
	);

const checkExternalLink = Effect.fn("DocFreshness.checkExternalLink")(function* (url: string) {
	const checker = yield* UrlChecker;

	return yield* Effect.gen(function* () {
		const parsedUrl = yield* Effect.fromResult(httpUrl.getResult(url)).pipe(
			Effect.mapError((reason) => new InvalidDeterministicUrl({ reason })),
		);
		const statusCode = yield* checker.check(parsedUrl);

		return Match.value(statusCode >= 200 && statusCode <= 299).pipe(
			Match.when(true, () => Option.none<string>()),
			Match.orElse(() => Option.some(`dead link: ${url} (${statusCode})`)),
		);
	}).pipe(
		Effect.catchTags({
			InvalidDeterministicUrl: () => Effect.succeed(Option.some(`dead link: ${url} (invalid-url)`)),
			UrlCheckError: () => Effect.succeed(Option.some(`dead link: ${url} (unreachable)`)),
		}),
	);
});

const compactOptions = <A>(values: ReadonlyArray<Option.Option<A>>): ReadonlyArray<A> =>
	values.flatMap((value) =>
		Option.match(value, {
			onNone: () => [],
			onSome: (availableValue) => [availableValue],
		}),
	);

const externalLinkReasons = Effect.fn("DocFreshness.externalLinkReasons")(function* (doc: DocRead) {
	const issues = yield* Effect.forEach(doc.externalLinks, checkExternalLink, { concurrency: 8 });
	return compactOptions(issues);
});

const warningReasonsForDoc = Effect.fn("DocFreshness.warningReasonsForDoc")(function* (
	doc: DocRead,
	availableDocs: ReadonlySet<string>,
) {
	const externalReasons = yield* externalLinkReasons(doc);
	return uniqueStrings([...brokenInternalLinkReasons(doc, availableDocs), ...externalReasons]);
});

const pageViewsForPath = (
	signals: Option.Option<DeterministicFreshnessSignals>,
	filePath: string,
) =>
	Option.flatMap(signals, (availableSignals) =>
		Option.fromNullishOr(availableSignals.pageviews[filePath]),
	);

const makeReviewInputFile = (
	path: string,
	lastDocCommit: string,
	staleReasons: ReadonlyArray<string>,
	warningReasons: ReadonlyArray<string>,
	pageViews30d: Option.Option<number>,
): FreshnessReviewInputFile =>
	Option.match(pageViews30d, {
		onNone: () =>
			freshnessReviewInputFileSchema.make({
				path,
				lastDocCommit,
				staleReasons,
				warningReasons,
			}),
		onSome: (views) =>
			freshnessReviewInputFileSchema.make({
				path,
				lastDocCommit,
				staleReasons,
				warningReasons,
				pageViews30d: views,
			}),
	});

const commitFoundOption = (entry: GitHubHistoryEntry | undefined) =>
	Option.filter(Option.fromNullishOr(entry), isCommitFound);

const docReadOption = (doc: ReadDocResult) => Option.filter(Option.some(doc), isDocRead);

const unavailableDocWarningReasons = (doc: ReadDocResult) =>
	Option.match(Option.filter(Option.some(doc), isDocUnavailable), {
		onNone: () => [],
		onSome: (unavailableDoc) => [`doc unavailable: ${unavailableDoc.reason}`],
	});

const reviewInputForUnavailableDoc = (
	doc: ReadDocResult,
	docHistory: CommitFound,
	signals: Option.Option<DeterministicFreshnessSignals>,
) =>
	Option.some(
		makeReviewInputFile(
			doc.path,
			docHistory.committedAt,
			[],
			unavailableDocWarningReasons(doc),
			pageViewsForPath(signals, doc.path),
		),
	);

const reviewInputForReadDoc = Effect.fn("DocFreshness.reviewInputForReadDoc")(function* (
	doc: DocRead,
	docHistory: CommitFound,
	codeHistories: ReadonlyMap<string, GitHubHistoryEntry>,
	availableDocs: ReadonlySet<string>,
	signals: Option.Option<DeterministicFreshnessSignals>,
) {
	const staleReasons = compactOptions(
		doc.codeReferences.map((reference) =>
			staleReasonForReference(docHistory, codeHistories.get(reference)),
		),
	);
	const warningReasons = yield* warningReasonsForDoc(doc, availableDocs);

	return Option.some(
		makeReviewInputFile(
			doc.path,
			docHistory.committedAt,
			uniqueStrings(staleReasons),
			warningReasons,
			pageViewsForPath(signals, doc.path),
		),
	);
});

const reviewInputForDoc = Effect.fn("DocFreshness.reviewInputForDoc")(function* (
	doc: ReadDocResult,
	docHistory: GitHubHistoryEntry | undefined,
	codeHistories: ReadonlyMap<string, GitHubHistoryEntry>,
	availableDocs: ReadonlySet<string>,
	signals: Option.Option<DeterministicFreshnessSignals>,
) {
	return yield* Option.match(commitFoundOption(docHistory), {
		onNone: () => Effect.succeed(Option.none<FreshnessReviewInputFile>()),
		onSome: (availableDocHistory) =>
			Option.match(docReadOption(doc), {
				onNone: () =>
					Effect.succeed(reviewInputForUnavailableDoc(doc, availableDocHistory, signals)),
				onSome: (availableDoc) =>
					reviewInputForReadDoc(
						availableDoc,
						availableDocHistory,
						codeHistories,
						availableDocs,
						signals,
					),
			}),
	});
});

const thresholdForSignals = (signals: Option.Option<DeterministicFreshnessSignals>) =>
	Option.match(signals, {
		onNone: () => 50,
		onSome: (availableSignals) => availableSignals.pageviewThreshold,
	});

const viewsLabel = (file: FreshnessReviewedFile) =>
	Option.match(Option.fromNullishOr(file.pageViews30d), {
		onNone: () => "unknown views",
		onSome: (views) => `${views} views`,
	});

const issueLabel = (file: FreshnessReviewedFile) =>
	Match.value(file.issues.length > 0).pipe(
		Match.when(true, () => file.issues.join("; ")),
		Match.orElse(() => "no issues"),
	);

const reportLineForFile = (file: FreshnessReviewedFile) =>
	`- **${file.path}** (${viewsLabel(file)}) — ${issueLabel(file)}`;

const reportSection = (title: string, files: ReadonlyArray<FreshnessReviewedFile>) =>
	Match.value(files.length > 0).pipe(
		Match.when(true, () => ["", `### ${title}`, ...files.map(reportLineForFile)]),
		Match.orElse(() => []),
	);

const buildReport = (files: ReadonlyArray<FreshnessReviewedFile>, summary: FreshnessSummary) => {
	const criticalFiles = files.filter((file) => file.priority === "critical");
	const lowDemandStaleFiles = files.filter(
		(file) => file.status === "stale" && file.priority !== "critical",
	);
	const warningFiles = files.filter((file) => file.status === "warning");

	return [
		"## Doc Freshness Report",
		"",
		"| Status | Count |",
		"| --- | --- |",
		`| Total | ${summary.total} |`,
		`| Fresh | ${summary.fresh} |`,
		`| Stale | ${summary.stale} |`,
		`| Warnings | ${summary.warnings} |`,
		`| Critical | ${summary.critical} |`,
		...reportSection("Critical (stale + high demand)", criticalFiles),
		...reportSection("Stale (low demand)", lowDemandStaleFiles),
		...reportSection("Warnings", warningFiles),
		"",
	].join("\n");
};

const runDeterministicFreshnessBase = Effect.fn("DocFreshness.runDeterministicFreshness")(
	function* (input: DeterministicFreshnessInput) {
		yield* logEvent("run.start", {
			mode: "deterministic",
			glob: input.glob,
			repository: `${input.owner}/${input.repo}`,
			ref: input.ref.slice(0, 12),
		});

		const docPaths = yield* listMarkdownDocs(input.repoPath, input.glob);
		const docHistories = yield* fetchHistory(input, docPaths, "docs");
		const docs = yield* readMarkdownDocs(input.repoPath, docPaths);
		const codeReferences = uniqueStrings(
			docs.filter(isDocRead).flatMap((doc) => doc.codeReferences),
		);
		const codeHistories = yield* fetchHistory(input, codeReferences, "code");
		const docHistoryMap = historyMap(docHistories);
		const codeHistoryMap = historyMap(codeHistories);
		const availableDocs = new Set(docPaths);
		const reviewInputOptions = yield* Effect.forEach(
			docs,
			(doc) =>
				reviewInputForDoc(
					doc,
					docHistoryMap.get(doc.path),
					codeHistoryMap,
					availableDocs,
					input.signals,
				),
			{ concurrency: 8 },
		);
		const reviewInputFiles = compactOptions(reviewInputOptions);
		const review = reviewFreshness({
			files: reviewInputFiles,
			pageviewThreshold: thresholdForSignals(input.signals),
		});
		const result = {
			files: review.files,
			summary: review.summary,
			report: buildReport(review.files, review.summary),
			shouldFail: review.shouldFail,
		};

		yield* logEvent("run.done", {
			total: result.summary.total,
			fresh: result.summary.fresh,
			stale: result.summary.stale,
			warnings: result.summary.warnings,
			critical: result.summary.critical,
			shouldFail: result.shouldFail,
		});

		return result satisfies DeterministicFreshnessResult;
	},
);

export const runDeterministicFreshness = (input: DeterministicFreshnessInput) =>
	runDeterministicFreshnessBase(input).pipe(
		Effect.annotateLogs({ component: "doc-freshness", mode: "deterministic" }),
		Effect.provide(UrlCheckerDefault),
	);
