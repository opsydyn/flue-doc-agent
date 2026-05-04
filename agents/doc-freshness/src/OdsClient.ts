import { Context, Data, Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

class OdsClientError extends Data.TaggedError("OdsClientError")<{
	readonly cause: unknown;
}> {}

// -----------------------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------------------

const make = Effect.gen(function* () {
	const client = yield* HttpClient.HttpClient;

	const fetchPageviews = Effect.fn("OdsClient.fetchPageviews")(function* (
		apiKey: string,
		siteId: string,
	) {
		const req = HttpClientRequest.post("https://api.onedollarstats.com/api").pipe(
			HttpClientRequest.setHeader("x-api-key", apiKey),
			HttpClientRequest.bodyJsonUnsafe({
				site_id: siteId,
				metrics: ["pageviews"],
				date_range: "30d",
				dimensions: ["event:page"],
			}),
		);
		return yield* client.execute(req).pipe(
			Effect.flatMap((res) => res.json),
			Effect.timeout("10 seconds"),
			Effect.mapError((cause) => new OdsClientError({ cause })),
		);
	});

	return { fetchPageviews } as const;
});

type OdsClientShape = Effect.Success<typeof make>;

export class OdsClient extends Context.Service<OdsClient, OdsClientShape>()("OdsClient") {}

// Pure layer — depends on HttpClient.HttpClient. Provide your own HttpClient to test.
const OdsClientLayer = Layer.effect(OdsClient, make);

// Production layer — wires in the global fetch-based HttpClient.
export const OdsClientDefault = OdsClientLayer.pipe(Layer.provide(FetchHttpClient.layer));
