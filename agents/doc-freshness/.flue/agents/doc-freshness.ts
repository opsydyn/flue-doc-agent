import { type FlueContext, type ToolDef, Type } from "@flue/sdk/client";
import { Octokit } from "@octokit/rest";
import { Data, Effect, Layer, Match, Option, Redacted, Schema, Struct } from "effect";
import * as Record from "effect/Record";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as v from "valibot";
import { httpUrl } from "../../src/Domain";
import {
	freshnessReviewInputSchema,
	freshnessReviewJsonSchema,
	reviewFreshness,
} from "../../src/FreshnessReview";
import {
	fetchGithubHistoryEntries,
	type GitHubHistoryClient,
	type GitHubHistoryEntry,
	githubHistoryResultJsonSchema,
	makeHistoryUnavailable,
} from "../../src/GithubHistory";
import {
	makeDocUnavailable,
	parseMarkdownDoc,
	readDocResultJsonSchema,
} from "../../src/MarkdownDoc";
import { OdsClient, OdsClientDefault } from "../../src/OdsClient";
import { UrlChecker, UrlCheckerDefault } from "../../src/UrlChecker";
import { AppConfig, AppConfigLive } from "../../src/config/AppConfig";

export const triggers = { webhook: true };

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

// Valibot schema for the signals block injected from the CI workflow.
const signalsPayloadSchema = v.nullish(
	v.object({
		pageviews: v.record(v.string(), v.number()),
		repoTraffic: v.record(v.string(), v.number()),
		pageviewThreshold: v.number(),
	}),
);

type SignalMapInput = { readonly [key: string]: number };
type SignalsPayload = NonNullable<v.InferOutput<typeof signalsPayloadSchema>>;

const pageViewsSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const pageviewThresholdSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));
const signalMapSchema = Schema.Record(Schema.String, pageViewsSchema);
const signalsSchema = Schema.Struct({
	pageviews: signalMapSchema,
	repoTraffic: signalMapSchema,
	pageviewThreshold: pageviewThresholdSchema,
});
const nullableSignalMapJsonSchema = Schema.fromJsonString(Schema.NullOr(signalMapSchema));
const defaultPageviewThreshold = pageviewThresholdSchema.make(50);
const emptySignalMap = signalMapSchema.make({});
const emptySignals = signalsSchema.make({
	pageviews: emptySignalMap,
	repoTraffic: emptySignalMap,
	pageviewThreshold: defaultPageviewThreshold,
});

type Signals = typeof signalsSchema.Type;

const makeSignalMap = (input: SignalMapInput) =>
	signalMapSchema.make(
		Record.reduce(input, emptySignalMap, (state, views, path) =>
			Record.set(state, path, pageViewsSchema.make(views)),
		),
	);

const makeSignals = (input: SignalsPayload): Signals =>
	signalsSchema.make(
		Struct.evolve(emptySignals, {
			pageviews: () => makeSignalMap(input.pageviews),
			repoTraffic: () => makeSignalMap(input.repoTraffic),
			pageviewThreshold: () => pageviewThresholdSchema.make(input.pageviewThreshold),
		}),
	);

const encodeNullableSignalMap = Schema.encodeSync(nullableSignalMapJsonSchema);
const encodePageviewThreshold = Schema.encodeSync(Schema.NumberFromString);

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

// -----------------------------------------------------------------------------
// Tools
// -----------------------------------------------------------------------------

class InvalidToolUrl extends Data.TaggedError("InvalidToolUrl")<{
	readonly reason: string;
}> {}

class MissingAnalyticsConfig extends Data.TaggedError("MissingAnalyticsConfig")<{
	readonly variable: "ONE_DOLLAR_STATS_API_KEY" | "ODS_SITE_ID";
}> {}

const githubToken = Effect.gen(function* () {
	const config = yield* AppConfig;
	return Redacted.value(config.githubToken);
});

const checkUrlArgsSchema = Schema.Struct({
	url: Schema.String,
});
const checkUrlReachableSchema = Schema.Struct({
	_tag: Schema.Literal("Reachable"),
	statusCode: Schema.Number,
});
const checkUrlInvalidSchema = Schema.Struct({
	_tag: Schema.Literal("InvalidUrl"),
	reason: Schema.String,
});
const checkUrlUnreachableSchema = Schema.Struct({
	_tag: Schema.Literal("Unreachable"),
	reason: Schema.String,
});
const checkUrlResultJsonSchema = Schema.fromJsonString(
	Schema.Union([checkUrlReachableSchema, checkUrlInvalidSchema, checkUrlUnreachableSchema]),
);
const encodeCheckUrlResult = Schema.encodeSync(checkUrlResultJsonSchema);

const listDocsArgsSchema = Schema.Struct({
	repoPath: Schema.String,
	glob: Schema.String,
});
const listDocsResultJsonSchema = Schema.fromJsonString(
	Schema.Struct({
		files: Schema.Array(Schema.String),
	}),
);
const encodeListDocsResult = Schema.encodeSync(listDocsResultJsonSchema);

const readDocArgsSchema = Schema.Struct({
	repoPath: Schema.String,
	path: Schema.String,
});
const encodeReadDocResult = Schema.encodeSync(readDocResultJsonSchema);

const githubHistoryArgsSchema = Schema.Struct({
	owner: Schema.String,
	repo: Schema.String,
	ref: Schema.String,
	paths: Schema.Array(Schema.String),
});
const encodeGithubHistoryResult = Schema.encodeSync(githubHistoryResultJsonSchema);
const encodeFreshnessReviewResult = Schema.encodeSync(freshnessReviewJsonSchema);

const invalidGithubConfig = (
	paths: ReadonlyArray<string>,
	reason: string,
): ReadonlyArray<GitHubHistoryEntry> =>
	paths.map((filePath) => makeHistoryUnavailable(filePath, reason));

const githubHistoryTokenIssue = (token: string | undefined) =>
	Match.value(token === undefined || token.length === 0).pipe(
		Match.when(true, () => "GH_TOKEN or GITHUB_TOKEN is not configured"),
		Match.orElse(() => undefined),
	);

const githubHistoryRepositoryIssue = (owner: string, repo: string, ref: string) =>
	Match.value(owner.length === 0 || repo.length === 0 || ref.length === 0).pipe(
		Match.when(true, () => "GitHub owner, repo, or ref is missing"),
		Match.orElse(() => undefined),
	);

const githubHistoryConfigIssue = (
	token: string | undefined,
	owner: string,
	repo: string,
	ref: string,
) =>
	Option.fromNullishOr(
		githubHistoryTokenIssue(token) ?? githubHistoryRepositoryIssue(owner, repo, ref),
	);

const listDocs: ToolDef = {
	name: "list-docs",
	description:
		"List markdown documentation files for a repository glob. Returns schema-encoded JSON with repo-relative file paths.",
	parameters: Type.Object({
		repoPath: Type.String({ description: "Absolute repository root path" }),
		glob: Type.String({ description: "Markdown glob relative to repo root or absolute" }),
	}),
	execute: (args) =>
		Effect.gen(function* () {
			const { repoPath, glob } = yield* Schema.decodeUnknownEffect(listDocsArgsSchema)(args);
			const root = globBaseDirectory(repoPath, glob);
			const extensions = globExtensions(glob);
			const files = yield* Effect.promise(() => listMarkdownFiles(root, extensions));

			return listDocsResultJsonSchema.to.make({
				files: files
					.map((filePath) => path.relative(repoPath, filePath).replaceAll(path.sep, "/"))
					.sort(),
			});
		}).pipe(Effect.map(encodeListDocsResult), Effect.runPromise),
};

const readDoc: ToolDef = {
	name: "read-doc",
	description:
		"Read and parse a Starlight Markdown document. Returns schema-encoded JSON with frontmatter, body, internal links, external links, and code references.",
	parameters: Type.Object({
		repoPath: Type.String({ description: "Absolute repository root path" }),
		path: Type.String({ description: "Repo-relative Markdown path to read" }),
	}),
	execute: (args) =>
		Effect.gen(function* () {
			const { repoPath, path: filePath } =
				yield* Schema.decodeUnknownEffect(readDocArgsSchema)(args);
			const fullPath = path.resolve(repoPath, filePath);
			return yield* Effect.tryPromise({
				try: () =>
					fs.readFile(fullPath, "utf8").then((content) => parseMarkdownDoc(filePath, content)),
				catch: (cause) => makeDocUnavailable(filePath, cause),
			});
		}).pipe(Effect.map(encodeReadDocResult), Effect.runPromise),
};

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

const makeGithubHistoryResult = (
	token: string | undefined,
	owner: string,
	repo: string,
	ref: string,
	paths: ReadonlyArray<string>,
) =>
	Option.match(githubHistoryConfigIssue(token, owner, repo, ref), {
		onNone: () =>
			Effect.gen(function* () {
				const client = new Octokit({ auth: token });
				const histories = yield* Effect.promise(() =>
					fetchGithubHistoryEntries(githubHistoryClient(client), {
						owner,
						repo,
						ref,
						paths,
					}),
				);

				return githubHistoryResultJsonSchema.to.make({ histories });
			}),
		onSome: (reason) =>
			Effect.succeed(
				githubHistoryResultJsonSchema.to.make({
					histories: invalidGithubConfig(paths, reason),
				}),
			),
	});

const githubHistory: ToolDef = {
	name: "github-history",
	description:
		"Fetch latest GitHub commit metadata for repository paths. Returns schema-encoded JSON with tagged history entries.",
	parameters: Type.Object({
		owner: Type.String({ description: "GitHub repository owner" }),
		repo: Type.String({ description: "GitHub repository name" }),
		ref: Type.String({ description: "Branch, tag, or commit SHA to query" }),
		paths: Type.Array(Type.String({ description: "Repo-relative paths to inspect" })),
	}),
	execute: (args) =>
		Effect.gen(function* () {
			const { owner, repo, ref, paths } =
				yield* Schema.decodeUnknownEffect(githubHistoryArgsSchema)(args);
			const token = yield* githubToken;
			return yield* makeGithubHistoryResult(token, owner, repo, ref, paths);
		}).pipe(Effect.map(encodeGithubHistoryResult), Effect.provide(AppConfigLive), Effect.runPromise),
};

const reviewFreshnessTool: ToolDef = {
	name: "review-freshness",
	description:
		"Deterministically assign freshness status, priority, summary counts, and shouldFail from structured stale/warning evidence.",
	parameters: Type.Object({
		pageviewThreshold: Type.Number({ description: "High-demand threshold for 30-day page views" }),
		files: Type.Array(
			Type.Object({
				path: Type.String({ description: "Repo-relative documentation path" }),
				lastDocCommit: Type.String({ description: "Latest documentation commit timestamp" }),
				staleReasons: Type.Array(Type.String({ description: "Git-backed stale evidence" })),
				warningReasons: Type.Array(Type.String({ description: "Link or availability warnings" })),
				pageViews30d: Type.Optional(
					Type.Number({ description: "Optional 30-day page view count for this doc" }),
				),
			}),
		),
	}),
	execute: (args) =>
		Effect.gen(function* () {
			const input = yield* Schema.decodeUnknownEffect(freshnessReviewInputSchema)(args);
			return reviewFreshness(input);
		}).pipe(Effect.map(encodeFreshnessReviewResult), Effect.runPromise),
};

const checkUrl: ToolDef = {
	name: "check-url",
	description:
		"Check if a URL is reachable via HTTP HEAD. Returns a JSON tagged result: Reachable with statusCode, InvalidUrl with reason, or Unreachable with reason.",
	parameters: Type.Object({
		url: Type.String({ description: "The URL to check" }),
	}),
	execute: (args) =>
		Effect.gen(function* () {
			const { url: rawUrl } = yield* Schema.decodeUnknownEffect(checkUrlArgsSchema)(args);
			const url = yield* Effect.fromResult(httpUrl.getResult(rawUrl)).pipe(
				Effect.mapError((reason) => new InvalidToolUrl({ reason })),
			);
			const checker = yield* UrlChecker;
			const code = yield* checker.check(url);
			return checkUrlReachableSchema.make({ _tag: "Reachable", statusCode: code });
		}).pipe(
			Effect.catchTags({
				InvalidToolUrl: (error) =>
					Effect.succeed(checkUrlInvalidSchema.make({ _tag: "InvalidUrl", reason: error.reason })),
				UrlCheckError: (error) =>
					Effect.succeed(
						checkUrlUnreachableSchema.make({
							_tag: "Unreachable",
							reason: String(error.cause),
						}),
					),
			}),
			Effect.map(encodeCheckUrlResult),
			Effect.provide(UrlCheckerDefault),
			Effect.runPromise,
		),
};

const odsPageviewResultSchema = Schema.Struct({
	dimensions: Schema.Array(Schema.String),
	metrics: Schema.Array(pageViewsSchema),
});
const odsPageviewsSchema = Schema.Struct({
	results: Schema.Array(odsPageviewResultSchema),
});
const analyticsUnavailableSchema = Schema.Struct({
	error: Schema.String,
});
const analyticsToolResultJsonSchema = Schema.fromJsonString(
	Schema.Union([odsPageviewsSchema, analyticsUnavailableSchema]),
);
const encodeAnalyticsToolResult = Schema.encodeSync(analyticsToolResultJsonSchema);

const requireAnalyticsConfig = (
	value: string | undefined,
	variable: "ONE_DOLLAR_STATS_API_KEY" | "ODS_SITE_ID",
) =>
	Schema.decodeUnknownEffect(Schema.NonEmptyString)(value).pipe(
		Effect.mapError(() => new MissingAnalyticsConfig({ variable })),
	);

const fetchAnalytics: ToolDef = {
	name: "fetch-analytics",
	description:
		"Fetch 30-day page-view data from One Dollar Stats. Returns schema-encoded JSON with a results array of {dimensions: [urlPath], metrics: [viewCount]}, or an error field if ODS is not configured.",
	parameters: Type.Object({}),
	execute: () =>
		Effect.gen(function* () {
			const config = yield* AppConfig;
			const apiKey = yield* requireAnalyticsConfig(
				Redacted.value(config.oneDollarStatsApiKey),
				"ONE_DOLLAR_STATS_API_KEY",
			);
			const siteId = yield* requireAnalyticsConfig(config.odsSiteId, "ODS_SITE_ID");
			const ods = yield* OdsClient;
			const data = yield* ods.fetchPageviews(apiKey, siteId);

			return yield* Schema.decodeUnknownEffect(odsPageviewsSchema)(data);
		}).pipe(
			Effect.catchTag("MissingAnalyticsConfig", () =>
				Effect.succeed(
					analyticsUnavailableSchema.make({
						error: "ONE_DOLLAR_STATS_API_KEY or ODS_SITE_ID not configured",
					}),
				),
			),
			Effect.catchTag("OdsClientError", (e) =>
				Effect.succeed(analyticsUnavailableSchema.make({ error: String(e.cause) })),
			),
			Effect.catchTag("SchemaError", (e) =>
				Effect.succeed(analyticsUnavailableSchema.make({ error: String(e) })),
			),
			Effect.map(encodeAnalyticsToolResult),
			Effect.provide(Layer.mergeAll(OdsClientDefault, AppConfigLive)),
			Effect.runPromise,
		),
};

// -----------------------------------------------------------------------------
// Result schemas (valibot — Flue boundary)
// -----------------------------------------------------------------------------

const freshnessSchema = v.object({
	files: v.array(
		v.object({
			path: v.string(),
			status: v.picklist(["fresh", "stale", "warning"]),
			priority: v.optional(v.picklist(["critical", "medium", "low"])),
			pageViews30d: v.optional(v.number()),
			lastDocCommit: v.string(),
			issues: v.array(v.string()),
		}),
	),
	summary: v.object({
		total: v.number(),
		fresh: v.number(),
		stale: v.number(),
		warnings: v.number(),
		critical: v.number(),
	}),
	report: v.string(),
	shouldFail: v.boolean(),
});

const analyticsResultSchema = Schema.Struct({
	report: Schema.String,
	pageCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
	totalViews: pageViewsSchema,
});

const makeAnalyticsUnavailable = (error: string) =>
	analyticsResultSchema.make({
		report: `## One Dollar Stats — 30d Page Views\n\n> ODS not configured: ${error}`,
		pageCount: 0,
		totalViews: 0,
	});

const makeAnalyticsResult = Effect.gen(function* () {
	const config = yield* AppConfig;
	const apiKey = yield* requireAnalyticsConfig(
		Redacted.value(config.oneDollarStatsApiKey),
		"ONE_DOLLAR_STATS_API_KEY",
	);
	const siteId = yield* requireAnalyticsConfig(config.odsSiteId, "ODS_SITE_ID");
	const ods = yield* OdsClient;
	const data = yield* ods.fetchPageviews(apiKey, siteId);
	const pageviews = yield* Schema.decodeUnknownEffect(odsPageviewsSchema)(data);
	const rows = pageviews.results.toSorted(
		(left, right) => (right.metrics[0] ?? 0) - (left.metrics[0] ?? 0),
	);
	const totalViews = pageViewsSchema.make(
		rows.reduce((total, row) => total + (row.metrics[0] ?? 0), 0),
	);
	const tableRows = rows.map(
		(row) => `| ${row.dimensions[0] ?? "(unknown)"} | ${row.metrics[0] ?? 0} |`,
	);
	const report = [
		"## One Dollar Stats — 30d Page Views",
		"",
		"| Page | Views |",
		"| --- | --- |",
		...tableRows,
		"",
		`**Total: ${totalViews} views across ${rows.length} pages**`,
	].join("\n");

	return analyticsResultSchema.make({
		report,
		pageCount: rows.length,
		totalViews,
	});
}).pipe(
	Effect.catchTag("MissingAnalyticsConfig", () =>
		Effect.succeed(
			makeAnalyticsUnavailable("ONE_DOLLAR_STATS_API_KEY or ODS_SITE_ID not configured"),
		),
	),
	Effect.catchTag("OdsClientError", (e) =>
		Effect.succeed(makeAnalyticsUnavailable(String(e.cause))),
	),
	Effect.catchTag("SchemaError", (e) => Effect.succeed(makeAnalyticsUnavailable(String(e)))),
	Effect.provide(Layer.mergeAll(OdsClientDefault, AppConfigLive)),
);

const checkStalenessArgsSchema = Schema.Struct({
	repoPath: Schema.String,
	glob: Schema.String,
	owner: Schema.String,
	repo: Schema.String,
	ref: Schema.String,
	pageviews: Schema.String,
	repoTraffic: Schema.String,
	pageviewThreshold: Schema.String,
});

const makeCheckStalenessArgs = (
	repoPath: string,
	glob: string,
	owner: string,
	repo: string,
	ref: string,
	signals: Option.Option<Signals>,
) => {
	const defaultArgs = checkStalenessArgsSchema.make({
		repoPath,
		glob,
		owner,
		repo,
		ref,
		pageviews: encodeNullableSignalMap(null),
		repoTraffic: encodeNullableSignalMap(null),
		pageviewThreshold: encodePageviewThreshold(defaultPageviewThreshold),
	});

	return checkStalenessArgsSchema.make(
		Option.match(signals, {
			onNone: () => defaultArgs,
			onSome: (availableSignals) =>
				Struct.evolve(defaultArgs, {
					pageviews: () => encodeNullableSignalMap(availableSignals.pageviews),
					repoTraffic: () => encodeNullableSignalMap(availableSignals.repoTraffic),
					pageviewThreshold: () => encodePageviewThreshold(availableSignals.pageviewThreshold),
				}),
		}),
	);
};

const preferredRef = (sha: string, refName: string) =>
	Match.value(sha.length > 0).pipe(
		Match.when(true, () => sha),
		Match.orElse(() => refName),
	);

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

export default async function ({ init, payload }: FlueContext) {
	const config = await Effect.runPromise(
		Effect.gen(function* () {
			return yield* AppConfig;
		}).pipe(Effect.provide(AppConfigLive)),
	);
	const mode = (payload.mode as string | undefined) ?? "check-staleness";

	if (mode === "analytics") return await Effect.runPromise(makeAnalyticsResult);

	const agent = await init({
		sandbox: "local",
		model: "openai/gpt-4o",
		tools: [listDocs, readDoc, githubHistory, reviewFreshnessTool, checkUrl, fetchAnalytics],
	});

	const session = await agent.session();

	const repoPath = (payload.repoPath as string | undefined) ?? "/workspace";
	const glob = (payload.glob as string | undefined) ?? "**/*.md";
	const repository = (payload.repository as string | undefined) ?? config.githubRepository;
	const [repositoryOwner = "", repositoryName = ""] = repository.split("/");
	const owner = (payload.owner as string | undefined) ?? repositoryOwner;
	const repo = (payload.repo as string | undefined) ?? repositoryName;
	const ref = (payload.ref as string | undefined) ?? preferredRef(config.githubSha, config.githubRef);
	const rawSignals = v.parse(signalsPayloadSchema, payload.signals);
	const signals = Option.map(Option.fromNullishOr(rawSignals), makeSignals);
	const checkStalenessArgs = makeCheckStalenessArgs(repoPath, glob, owner, repo, ref, signals);

	return await Match.value(mode).pipe(
		Match.orElse(() =>
			session.skill("check-staleness", {
				args: checkStalenessArgs,
				result: freshnessSchema,
			}),
		),
	);
}
