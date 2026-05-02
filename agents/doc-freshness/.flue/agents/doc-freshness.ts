import { Effect } from "effect";
import { Type, type FlueContext, type ToolDef } from "@flue/sdk/client";
import * as v from "valibot";
import { UrlChecker, UrlCheckerDefault } from "../../src/UrlChecker";

export const triggers = { webhook: true };

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
	execute: (args) =>
		Effect.gen(function* () {
			const checker = yield* UrlChecker;
			return yield* checker.check(args.url as string);
		}).pipe(
			Effect.catchTag("UrlCheckError", () => Effect.succeed("unreachable")),
			Effect.provide(UrlCheckerDefault),
			Effect.runPromise,
		),
};

// -----------------------------------------------------------------------------
// Result schema (valibot)
// -----------------------------------------------------------------------------

const resultSchema = v.object({
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
});

// -----------------------------------------------------------------------------
// Signals type
// -----------------------------------------------------------------------------

type Signals = {
	// relative-file-path → 30-day page views from One Dollar Stats
	pageviews: Record<string, number>;
	// github.com path → 14-day view count from GitHub Traffic API (top 10 only)
	repoTraffic: Record<string, number>;
	pageviewThreshold: number;
};

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

export default async function ({ init, payload }: FlueContext) {
	const repoPath = (payload.repoPath as string | undefined) ?? "/workspace";
	const glob = (payload.glob as string | undefined) ?? "**/*.md";
	const signals = (payload.signals as Signals | undefined) ?? null;

	const agent = await init({
		sandbox: "local",
		model: "openai/gpt-4o",
		tools: [checkUrl],
	});

	const session = await agent.session();

	return await session.skill("check-staleness", {
		args: {
			repoPath,
			glob,
			pageviews: JSON.stringify(signals?.pageviews ?? null),
			repoTraffic: JSON.stringify(signals?.repoTraffic ?? null),
			pageviewThreshold: String(signals?.pageviewThreshold ?? 50),
		},
		result: resultSchema,
	});
}
