import { Effect, Result } from "effect";
import { Type, type FlueContext, type ToolDef } from "@flue/sdk/client";
import * as v from "valibot";
import { UrlChecker, UrlCheckerDefault } from "../../src/UrlChecker";
import {
	type GitHubRepoPath,
	type PageViews,
	type PageviewThreshold,
	type RelativeFilePath,
	httpUrl,
} from "../../src/Domain";

export const triggers = { webhook: true };

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type Signals = {
	pageviews: Record<RelativeFilePath, PageViews>;
	repoTraffic: Record<GitHubRepoPath, PageViews>;
	pageviewThreshold: PageviewThreshold;
};

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
		const rawUrl = args.url as string;
		const urlResult = httpUrl.getResult(rawUrl);
		if (!Result.isSuccess(urlResult)) return Promise.resolve("invalid-url");

		return Effect.gen(function* () {
			const checker = yield* UrlChecker;
			const code = yield* checker.check(urlResult.success);
			return String(code);
		}).pipe(
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
	execute: async () => {
		const apiKey = process.env.ODS_API_KEY;
		const siteId = process.env.ODS_SITE_ID;
		if (!apiKey || !siteId) {
			return JSON.stringify({ error: "ODS_API_KEY or ODS_SITE_ID not configured" });
		}
		try {
			const res = await fetch("https://api.onedollarstats.com/api", {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-api-key": apiKey },
				body: JSON.stringify({
					site_id: siteId,
					metrics: ["pageviews"],
					date_range: "30d",
					dimensions: ["event:page"],
				}),
			});
			return JSON.stringify(await res.json());
		} catch (e) {
			return JSON.stringify({ error: String(e) });
		}
	},
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

	if (mode === "analytics") {
		return await session.skill("analytics-report", {
			result: analyticsSchema,
		});
	}

	// --- check-staleness mode (default) ---

	const repoPath = (payload.repoPath as string | undefined) ?? "/workspace";
	const glob = (payload.glob as string | undefined) ?? "**/*.md";

	const rawSignals = payload.signals as
		| {
				pageviews: Record<string, number>;
				repoTraffic: Record<string, number>;
				pageviewThreshold: number;
		  }
		| undefined;

	const signals: Signals | null = rawSignals
		? {
				pageviews: rawSignals.pageviews as Record<RelativeFilePath, PageViews>,
				repoTraffic: rawSignals.repoTraffic as Record<GitHubRepoPath, PageViews>,
				pageviewThreshold: rawSignals.pageviewThreshold as PageviewThreshold,
		  }
		: null;

	return await session.skill("check-staleness", {
		args: {
			repoPath,
			glob,
			pageviews: JSON.stringify(signals?.pageviews ?? null),
			repoTraffic: JSON.stringify(signals?.repoTraffic ?? null),
			pageviewThreshold: String(signals?.pageviewThreshold ?? 50),
		},
		result: freshnessSchema,
	});
}
