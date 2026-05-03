import matter from "gray-matter";
import { Array as EffectArray, Match, Record, Schema } from "effect";

type FrontmatterData = { readonly [key: string]: unknown };
type StringMap = { readonly [key: string]: string };

export const readDocParsedSchema = Schema.Struct({
	_tag: Schema.Literal("DocRead"),
	path: Schema.String,
	frontmatter: Schema.Record(Schema.String, Schema.String),
	body: Schema.String,
	internalLinks: Schema.Array(Schema.String),
	externalLinks: Schema.Array(Schema.String),
	codeReferences: Schema.Array(Schema.String),
});
export const readDocUnavailableSchema = Schema.Struct({
	_tag: Schema.Literal("DocUnavailable"),
	path: Schema.String,
	reason: Schema.String,
});
export const readDocResultJsonSchema = Schema.fromJsonString(
	Schema.Union([readDocParsedSchema, readDocUnavailableSchema]),
);

export type ReadDocResult = typeof readDocResultJsonSchema.to.Type;

const isRecord = (value: unknown): value is FrontmatterData =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const uniqueStrings = (values: ReadonlyArray<string>) =>
	values.filter((value, index, allValues) => allValues.indexOf(value) === index).sort();

const markdownLinkTargets = (body: string) =>
	Array.from(body.matchAll(/\[[^\]]*\]\(([^)#?]+)(?:[#?][^)]*)?\)/gu), (match) => match[1] ?? "");

const externalUrlsFromText = (text: string) =>
	Array.from(text.matchAll(/https?:\/\/[^\s)"']+/gu), (match) => match[0]);

const sourceReferencesFromText = (text: string) =>
	Array.from(
		text.matchAll(
			/(?:^|[^A-Za-z0-9._-])((?:src|lib|packages|agents)\/[A-Za-z0-9._/-]+\.(?:astro|cjs|css|jsx|json|mjs|tsx|ts|yaml|yml|js))/gmu,
		),
		(match) => match[1] ?? "",
	).filter((target) => target.length > 0);

const frontmatterStrings = (value: unknown): ReadonlyArray<string> =>
	Match.value(value).pipe(
		Match.when(
			(input: unknown): input is string => typeof input === "string",
			(input) => [input],
		),
		Match.when(
			(input: unknown): input is ReadonlyArray<unknown> => Array.isArray(input),
			(input) =>
				input.reduce<ReadonlyArray<string>>(
					(state, item) => EffectArray.appendAll(state, frontmatterStrings(item)),
					[],
				),
		),
		Match.when(isRecord, (input) =>
			Record.reduce(input, [] as ReadonlyArray<string>, (state, item) =>
				EffectArray.appendAll(state, frontmatterStrings(item)),
			),
		),
		Match.when(
			(input: unknown): input is number | boolean =>
				typeof input === "number" || typeof input === "boolean",
			(input) => [String(input)],
		),
		Match.orElse(() => []),
	);

const frontmatterValue = (value: unknown) => frontmatterStrings(value).join(", ");

const frontmatterRecord = (data: FrontmatterData) =>
	Record.reduce(data, {} as StringMap, (state, value, key) =>
		Record.set(state, key, frontmatterValue(value)),
	);

const frontmatterEvidence = (data: FrontmatterData) =>
	Record.reduce(data, [] as ReadonlyArray<string>, (state, value) =>
		EffectArray.appendAll(state, frontmatterStrings(value)),
	);

const bodyEvidence = (body: string) => EffectArray.append(markdownLinkTargets(body), body);

const allEvidence = (body: string, data: FrontmatterData) =>
	EffectArray.appendAll(bodyEvidence(body), frontmatterEvidence(data));

const externalLinksFromEvidence = (evidence: ReadonlyArray<string>) =>
	uniqueStrings(
		evidence.reduce<ReadonlyArray<string>>(
			(state, text) => EffectArray.appendAll(state, externalUrlsFromText(text)),
			[],
		),
	);

const internalLinksFromBody = (body: string) =>
	uniqueStrings(
		markdownLinkTargets(body).filter(
			(target) => target.length > 0 && !/^https?:\/\//u.test(target) && !target.startsWith("#"),
		),
	);

const codeReferencesFromEvidence = (evidence: ReadonlyArray<string>) =>
	uniqueStrings(
		evidence.reduce<ReadonlyArray<string>>(
			(state, text) => EffectArray.appendAll(state, sourceReferencesFromText(text)),
			[],
		),
	);

const errorMessage = (cause: unknown) =>
	Match.value(cause instanceof Error).pipe(
		Match.when(true, () => (cause as Error).stack ?? (cause as Error).message),
		Match.orElse(() => String(cause)),
	);

export const makeDocUnavailable = (filePath: string, cause: unknown): ReadDocResult =>
	readDocUnavailableSchema.make({
		_tag: "DocUnavailable",
		path: filePath,
		reason: errorMessage(cause),
	});

export const parseMarkdownDoc = (filePath: string, content: string): ReadDocResult => {
	const parsed = matter(content);
	const evidence = allEvidence(parsed.content, parsed.data);

	return readDocParsedSchema.make({
		_tag: "DocRead",
		path: filePath,
		frontmatter: frontmatterRecord(parsed.data),
		body: parsed.content,
		internalLinks: internalLinksFromBody(parsed.content),
		externalLinks: externalLinksFromEvidence(evidence),
		codeReferences: codeReferencesFromEvidence(evidence),
	});
};
