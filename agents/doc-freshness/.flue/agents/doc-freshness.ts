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
			lastDocCommit: v.string(),
			issues: v.array(v.string()),
		}),
	),
	summary: v.object({
		total: v.number(),
		fresh: v.number(),
		stale: v.number(),
		warnings: v.number(),
	}),
});

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

export default async function ({ init, payload }: FlueContext) {
	const repoPath = (payload.repoPath as string | undefined) ?? "/workspace";
	const glob = (payload.glob as string | undefined) ?? "**/*.md";

	const agent = await init({
		sandbox: "local",
		model: "openai/gpt-4o",
		tools: [checkUrl],
	});

	const session = await agent.session();

	return await session.skill("check-staleness", {
		args: { repoPath, glob },
		result: resultSchema,
	});
}
