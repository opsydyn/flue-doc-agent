import { Effect, Layer } from "effect";
import {
	HttpClient,
	HttpClientError,
	HttpClientResponse,
} from "effect/unstable/http";
import { UrlChecker, UrlCheckerLayer } from "../UrlChecker";

export const mockHttpLayer = (status: number) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((req) =>
			Effect.succeed(HttpClientResponse.fromWeb(req, new Response(null, { status }))),
		),
	);

export const networkErrorLayer = (cause: string) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((req) =>
			Effect.fail(
				new HttpClientError.HttpClientError({
					reason: new HttpClientError.TransportError({
						request: req,
						cause: new Error(cause),
					}),
				}),
			),
		),
	);

export const runCheck = (url: string, httpLayer: Layer.Layer<HttpClient.HttpClient>) =>
	Effect.gen(function* () {
		const checker = yield* UrlChecker;
		return yield* checker.check(url);
	}).pipe(Effect.provide(UrlCheckerLayer.pipe(Layer.provide(httpLayer))));
