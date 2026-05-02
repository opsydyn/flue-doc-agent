import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { HttpStatusCode, HttpUrl } from "../Domain";
import { UrlCheckError } from "../UrlChecker";
import { mockHttpLayer, networkErrorLayer, runCheck } from "./mock-layers";

describe("UrlChecker.check", () => {
	test("returns the HTTP status code as a number on success", async () => {
		const result = await Effect.runPromise(
			runCheck("https://example.com" as HttpUrl, mockHttpLayer(200)),
		);
		expect(result).toBe(200 as HttpStatusCode);
	});

	test("returns the status code for non-2xx responses (no filterStatusOk)", async () => {
		const result = await Effect.runPromise(
			runCheck("https://example.com/missing" as HttpUrl, mockHttpLayer(404)),
		);
		expect(result).toBe(404 as HttpStatusCode);
	});

	test("fails with UrlCheckError carrying the original url on network error", async () => {
		const url = "https://unreachable.example.com" as HttpUrl;
		const error = await Effect.runPromise(
			runCheck(url, networkErrorLayer("connection refused")).pipe(Effect.flip),
		);
		expect(error).toBeInstanceOf(UrlCheckError);
		expect(error.url).toBe(url);
	});
});
