import { describe, test } from "bun:test";
import { Effect } from "effect";
import * as FastCheck from "effect/testing/FastCheck";
import { UrlCheckError } from "../UrlChecker";
import { mockHttpLayer, networkErrorLayer, runCheck } from "./mock-layers";

describe("UrlChecker properties", () => {
	test("status code passthrough: check always returns String(status) for any valid HTTP status", async () => {
		await FastCheck.assert(
			FastCheck.asyncProperty(
				FastCheck.integer({ min: 200, max: 599 }),
				FastCheck.webUrl(),
				async (status, url) => {
					const result = await Effect.runPromise(runCheck(url, mockHttpLayer(status)));
					return result === String(status);
				},
			),
		);
	});

	test("error context: UrlCheckError always captures the exact url that was checked", async () => {
		await FastCheck.assert(
			FastCheck.asyncProperty(
				FastCheck.string(),
				FastCheck.string(),
				async (url, cause) => {
					const error = await Effect.runPromise(
						runCheck(url, networkErrorLayer(cause)).pipe(Effect.flip),
					);
					return error instanceof UrlCheckError && error.url === url;
				},
			),
		);
	});
});
