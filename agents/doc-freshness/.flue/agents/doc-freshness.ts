import { type FlueContext, type ToolDef, Type } from "@flue/sdk/client";
import { Effect, Match, Option, Result } from "effect";
import * as v from "valibot";
import {
	type GitHubRepoPath,
	httpUrl,
	type PageViews,
	type PageviewThreshold,
	type RelativeFilePath,
} from "../../src/Domain";
import { OdsClient, OdsClientDefault } from "../../src/OdsClient";
import { UrlChecker, UrlCheckerDefault } from "../../src/UrlChecker";

export const triggers = { webhook: true };

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type Signals = {
	pageviews: Record<RelativeFilePath, PageViews>;
	repoTraffic: Record<GitHubRepoPath, PageViews>;
	pageviewThreshold: PageviewThreshold;
};

// Valibot schema for the signals block injected from the CI workflow.
const signalsPayloadSchema = v.nullish(
	v.object({
		pageviews: v.record(v.string(), v.number()),
		repoTraffic: v.record(v.string(), v.number()),
		pageviewThreshold: v.number(),
	}),
);

// -----------------------------------------------------------------------------
// Tools
// -----------------------------------------------------------------------------

const checkUrl: ToolDef = {
	name: "check-url",
	description:
		"Check if a URL is reachable via HTTP HEAD. Returns the HTTP status code as a string, or 'unreachable' on network error or timeout.",
	parameters: Type.Object({
		url: Type.String({ description: "The URL to check" }),
	}),
	execute: (args) => {
		const rawUrl = String(args.url);
		const urlResult = httpUrl.getResult(rawUrl);
		if (!Result.isSuccess(urlResult)) return Promise.resolve("invalid-url");

		return Effect.gen(function* () {
			const checker = yield* UrlChecker;
			const code = yield* checker.check(urlResult.success);
			return String(code);
		}).pipe(
			// biome-ignore lint/plugin: ToolDef boundary — execute must return string; "unreachable" is a literal the LLM reads, not a control-flow token
			Effect.catchTag("UrlCheckError", () => Effect.succeed("unreachable")),
			Effect.provide(UrlCheckerDefault),
			Effect.runPromise,
		);
	},
};

const fetchAnalytics: ToolDef = {
	name: "fetch-analytics",
	description:
		"Fetch 30-day page-view data from One Dollar Stats. Returns a JSON string with a results array of {dimensions: [urlPath], metrics: [viewCount]}, or an error field if ODS is not configured.",
	parameters: Type.Object({}),
	execute: () =>
		Effect.gen(function* () {
			const apiKey = yield* Effect.fromNullishOr(process.env.ODS_API_KEY);
			const siteId = yield* Effect.fromNullishOr(process.env.ODS_SITE_ID);
			const ods = yield* OdsClient;
			const data = yield* ods.fetchPageviews(apiKey, siteId);
			// biome-ignore lint/plugin: ToolDef boundary — Flue execute must return a JSON string
			return JSON.stringify(data);
		}).pipe(
			Effect.catchTag("NoSuchElementError", () =>
				Effect.succeed(JSON.stringify({ error: "ODS_API_KEY or ODS_SITE_ID not configured" })),
			),
			Effect.catchTag("OdsClientError", (e) =>
				Effect.succeed(JSON.stringify({ error: String(e.cause) })),
			),
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
	const signals: Signals | null = Option.getOrNull(
		Option.map(
			Option.fromNullishOr(rawSignals),
			(s): Signals => ({
				pageviews: s.pageviews as Record<RelativeFilePath, PageViews>,
				repoTraffic: s.repoTraffic as Record<GitHubRepoPath, PageViews>,
				pageviewThreshold: s.pageviewThreshold as PageviewThreshold,
			}),
		),
	);

	return await Match.value(mode).pipe(
		Match.when("analytics", () => session.skill("analytics-report", { result: analyticsSchema })),
		Match.orElse(() =>
			session.skill("check-staleness", {
				args: {
					repoPath,
					glob,
					pageviews: JSON.stringify(signals?.pageviews ?? null),
					repoTraffic: JSON.stringify(signals?.repoTraffic ?? null),
					pageviewThreshold: String(signals?.pageviewThreshold ?? 50),
				},
				result: freshnessSchema,
			}),
		),
	);
}
