import { type Brand, Match, Optic, Result } from "effect";

// --- HttpUrl ---

export type HttpUrl = Brand.Branded<string, "HttpUrl">;

export const httpUrl = Optic.makePrism<string, HttpUrl>(
	(s) =>
		Match.value(s).pipe(
			Match.when(
				(str) => /^https?:\/\/.+/i.test(str),
				(str) => Result.succeed(str as HttpUrl),
			),
			Match.orElse((str) => Result.fail(`not a valid HTTP URL: ${str}`)),
		),
	(u: HttpUrl): string => u,
);

// --- HttpStatusCode ---

export type HttpStatusCode = Brand.Branded<number, "HttpStatusCode">;
