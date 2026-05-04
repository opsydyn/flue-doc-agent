import { Context, Data, Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type { HttpStatusCode, HttpUrl } from "./Domain";

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export class UrlCheckError extends Data.TaggedError("UrlCheckError")<{
	readonly url: HttpUrl;
	readonly cause: unknown;
}> {}

// -----------------------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------------------

const make = Effect.gen(function* () {
	const baseClient = yield* HttpClient.HttpClient;
	const client = baseClient.pipe(HttpClient.followRedirects());
	// No filterStatusOk — we want to capture 4xx/5xx status codes, not fail on them.

	const check = Effect.fn("UrlChecker.check")(function* (url: HttpUrl) {
		return yield* client.execute(HttpClientRequest.head(url)).pipe(
			Effect.map((res) => res.status as HttpStatusCode),
			Effect.timeout("5 seconds"),
			Effect.mapError((cause) => new UrlCheckError({ url, cause })),
		);
	});

	return { check } as const;
});

type UrlCheckerShape = Effect.Success<typeof make>;

export class UrlChecker extends Context.Service<UrlChecker, UrlCheckerShape>()("UrlChecker") {}

// Pure layer — depends on HttpClient.HttpClient. Provide your own HttpClient to test.
export const UrlCheckerLayer = Layer.effect(UrlChecker, make);

// Production layer — wires in the global fetch-based HttpClient.
export const UrlCheckerDefault = UrlCheckerLayer.pipe(Layer.provide(FetchHttpClient.layer));
