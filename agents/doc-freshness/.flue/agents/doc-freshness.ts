import { type FlueContext, type ToolDef, Type } from "@flue/sdk/client";
import { Data, Effect, Match, Option, Schema, Struct } from "effect";
import * as Record from "effect/Record";
import * as v from "valibot";
import { httpUrl } from "../../src/Domain";
import { OdsClient, OdsClientDefault } from "../../src/OdsClient";
import { UrlChecker, UrlCheckerDefault } from "../../src/UrlChecker";

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

const pageViewsSchema = Schema.Number.check(
	Schema.isInt(),
	Schema.isGreaterThanOrEqualTo(0),
);
const pageviewThresholdSchema = Schema.Number.check(
	Schema.isInt(),
	Schema.isGreaterThan(0),
);
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

// -----------------------------------------------------------------------------
// Tools
// -----------------------------------------------------------------------------

class InvalidToolUrl extends Data.TaggedError("InvalidToolUrl")<{
	readonly reason: string;
}> {}

class MissingAnalyticsConfig extends Data.TaggedError("MissingAnalyticsConfig")<{
	readonly variable: "ODS_API_KEY" | "ODS_SITE_ID";
}> {}

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
					Effect.succeed(
						checkUrlInvalidSchema.make({ _tag: "InvalidUrl", reason: error.reason }),
					),
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
	variable: "ODS_API_KEY" | "ODS_SITE_ID",
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
			const apiKey = yield* requireAnalyticsConfig(process.env.ODS_API_KEY, "ODS_API_KEY");
			const siteId = yield* requireAnalyticsConfig(process.env.ODS_SITE_ID, "ODS_SITE_ID");
			const ods = yield* OdsClient;
			const data = yield* ods.fetchPageviews(apiKey, siteId);

			return yield* Schema.decodeUnknownEffect(odsPageviewsSchema)(data);
		}).pipe(
			Effect.catchTag("MissingAnalyticsConfig", () =>
				Effect.succeed(
					analyticsUnavailableSchema.make({
						error: "ODS_API_KEY or ODS_SITE_ID not configured",
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
			Effect.provide(OdsClientDefault),
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

const analyticsSchema = v.object({
	report: v.string(),
	pageCount: v.number(),
	totalViews: v.number(),
});

const checkStalenessArgsSchema = Schema.Struct({
	repoPath: Schema.String,
	glob: Schema.String,
	pageviews: Schema.String,
	repoTraffic: Schema.String,
	pageviewThreshold: Schema.String,
});

const makeCheckStalenessArgs = (
	repoPath: string,
	glob: string,
	signals: Option.Option<Signals>,
) => {
	const defaultArgs = checkStalenessArgsSchema.make({
		repoPath,
		glob,
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
					pageviewThreshold: () =>
						encodePageviewThreshold(availableSignals.pageviewThreshold),
				}),
		}),
	);
};

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

export default async function ({ init, payload }: FlueContext) {
	const mode = (payload.mode as string | undefined) ?? "check-staleness";

	const agent = await init({
		sandbox: "local",
		model: "openai/gpt-4o",
		tools: [checkUrl, fetchAnalytics],
	});

	const session = await agent.session();

	const repoPath = (payload.repoPath as string | undefined) ?? "/workspace";
	const glob = (payload.glob as string | undefined) ?? "**/*.md";
	const rawSignals = v.parse(signalsPayloadSchema, payload.signals);
	const signals = Option.map(Option.fromNullishOr(rawSignals), makeSignals);
	const checkStalenessArgs = makeCheckStalenessArgs(repoPath, glob, signals);

	return await Match.value(mode).pipe(
		Match.when("analytics", () => session.skill("analytics-report", { result: analyticsSchema })),
		Match.orElse(() =>
			session.skill("check-staleness", {
				args: checkStalenessArgs,
				result: freshnessSchema,
			}),
		),
	);
}
