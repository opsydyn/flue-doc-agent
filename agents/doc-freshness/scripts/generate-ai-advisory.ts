import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Effect, Match, Option, Record, Schema } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import {
	type AdvisoryFreshnessCandidate,
	type AiAdvisoryReport,
	addImplicitRelationshipsToReport,
	addPatchProposalToReport,
	advisoryFreshnessCandidateSchema,
	aiFeatureProvenanceSchema,
	buildAiAdvisoryReport,
	fallbackPatchProposalForReport,
	implicitDocCodeRelationshipSchema,
	patchProposalBatchSchema,
	semanticImpactReviewBatchSchema,
} from "../src/AiAdvisory";

const FreshnessFileSchema = Schema.Struct({
	path: Schema.String,
	status: Schema.Literals(["fresh", "stale", "warning"]),
	priority: Schema.optional(Schema.Literals(["critical", "medium", "low"])),
	pageViews30d: Schema.optional(
		Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
	),
	lastDocCommit: Schema.optional(Schema.String),
	issues: Schema.optional(Schema.Array(Schema.String)),
});
const FreshnessResultSchema = Schema.Struct({
	files: Schema.Array(FreshnessFileSchema),
});
const OpenAiUsageSchema = Schema.Struct({
	prompt_tokens: Schema.optional(Schema.Number),
	completion_tokens: Schema.optional(Schema.Number),
	total_tokens: Schema.optional(Schema.Number),
});
const OpenAiSemanticReviewResponseSchema = Schema.Struct({
	model: Schema.optional(Schema.String),
	usage: Schema.optional(OpenAiUsageSchema),
	choices: Schema.Array(
		Schema.Struct({
			message: Schema.Struct({
				content: Schema.optional(Schema.String),
			}),
		}),
	),
});

const decodeJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const encodeJson = Schema.encodeSync(Schema.UnknownFromJsonString);
const decodeFreshnessOption = Schema.decodeUnknownOption(FreshnessResultSchema);
const decodeOpenAiResponseOption = Schema.decodeUnknownOption(OpenAiSemanticReviewResponseSchema);
const decodeSemanticBatchOption = Schema.decodeUnknownOption(semanticImpactReviewBatchSchema);
const decodePatchProposalBatchOption = Schema.decodeUnknownOption(patchProposalBatchSchema);

const args = process.argv.slice(2).reduce<Record.ReadonlyRecord<string, string>>(
	(state, arg, index, all) =>
		Match.value(arg.startsWith("--")).pipe(
			Match.when(true, () => Record.set(state, arg.slice(2), all[index + 1] ?? "")),
			Match.orElse(() => state),
		),
	Record.empty<string, string>(),
);

const failMissing = (name: string): never => {
	process.stderr.write(`Missing required ${name} argument.\n`);
	process.exit(1);
};

const requiredArg = (name: string) =>
	Option.getOrElse(Record.get(args, name), () => failMissing(name));

const argValue = (name: string, fallback: string) =>
	Option.getOrElse(Record.get(args, name), () => fallback);

const defaultAdvisoryModel = () => "gpt-4.1-mini";

const advisoryModel = () => process.env.DOC_FRESHNESS_ADVISORY_MODEL ?? defaultAdvisoryModel();

const openAiApiKey = () =>
	Option.filter(
		Option.fromNullishOr(process.env.OPENAI_API_KEY),
		(value) => value.trim().length > 0 && value !== "sk-test",
	);

const tokenCount = (value: number | undefined) => value ?? 0;

const candidateWithStatus = (
	file: typeof FreshnessFileSchema.Type,
	status: AdvisoryFreshnessCandidate["status"],
) =>
	advisoryFreshnessCandidateSchema.make({
		path: file.path,
		status,
		priority: file.priority,
		pageViews30d: file.pageViews30d,
		lastDocCommit: file.lastDocCommit,
		issues: file.issues,
	});

const candidateForFile = (file: typeof FreshnessFileSchema.Type) =>
	Match.value(file.status).pipe(
		Match.when("fresh", () => []),
		Match.when("stale", () => [candidateWithStatus(file, "stale")]),
		Match.orElse(() => [candidateWithStatus(file, "warning")]),
	);

const candidatesFromFreshness = (freshness: typeof FreshnessResultSchema.Type) =>
	freshness.files.flatMap(candidateForFile);

const semanticReviewJsonSchema = Schema.toJsonSchemaDocument(
	semanticImpactReviewBatchSchema,
).schema;
const patchProposalJsonSchema = Schema.toJsonSchemaDocument(patchProposalBatchSchema).schema;

const advisoryPrompt = (candidates: ReadonlyArray<AdvisoryFreshnessCandidate>) =>
	[
		"Review documentation freshness candidates semantically.",
		"Return one review for each candidate path. Do not invent paths.",
		"The deterministic status and priority are authoritative; do not try to override them.",
		"Classify stale evidence as real-stale, needs-review, or probably-harmless.",
		"When uncertain, choose needs-review with low confidence.",
		"Keep rationales and fixes concise and actionable.",
		"Candidates:",
		encodeJson({ candidates }),
	].join("\n");

const fallbackProvenance = (
	model: string,
	candidates: ReadonlyArray<AdvisoryFreshnessCandidate>,
	note: string,
) =>
	aiFeatureProvenanceSchema.make({
		feature: "semantic-impact",
		source: "fallback",
		provider: "none",
		model,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		itemCount: candidates.length,
		generatedAt: new Date().toISOString(),
		note,
	});

const fallbackFeatureProvenance = (
	feature: "implicit-relationships" | "patch-proposal",
	model: string,
	itemCount: number,
	note: string,
) =>
	aiFeatureProvenanceSchema.make({
		feature,
		source: "fallback",
		provider: "none",
		model,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		itemCount,
		generatedAt: new Date().toISOString(),
		note,
	});

const fallbackReport = (
	candidates: ReadonlyArray<AdvisoryFreshnessCandidate>,
	model: string,
	note: string,
) => buildAiAdvisoryReport(candidates, [], [fallbackProvenance(model, candidates, note)]);

const reportFromSemanticBatch = (
	candidates: ReadonlyArray<AdvisoryFreshnessCandidate>,
	model: string,
	response: typeof OpenAiSemanticReviewResponseSchema.Type,
	batch: typeof semanticImpactReviewBatchSchema.Type,
) =>
	buildAiAdvisoryReport(candidates, batch.reviews, [
		aiFeatureProvenanceSchema.make({
			feature: "semantic-impact",
			source: "openai",
			provider: "openai",
			model: response.model ?? model,
			inputTokens: tokenCount(response.usage?.prompt_tokens),
			outputTokens: tokenCount(response.usage?.completion_tokens),
			totalTokens: tokenCount(response.usage?.total_tokens),
			itemCount: candidates.length,
			generatedAt: new Date().toISOString(),
		}),
	]);

const patchProposalOpenAiProvenance = (
	model: string,
	response: typeof OpenAiSemanticReviewResponseSchema.Type,
) =>
	aiFeatureProvenanceSchema.make({
		feature: "patch-proposal",
		source: "openai",
		provider: "openai",
		model: response.model ?? model,
		inputTokens: tokenCount(response.usage?.prompt_tokens),
		outputTokens: tokenCount(response.usage?.completion_tokens),
		totalTokens: tokenCount(response.usage?.total_tokens),
		itemCount: 1,
		generatedAt: new Date().toISOString(),
	});

const responseContent = (response: typeof OpenAiSemanticReviewResponseSchema.Type) =>
	Option.filter(
		Option.fromNullishOr(response.choices[0]?.message.content),
		(value) => value.trim().length > 0,
	);

const reportFromOpenAiResponse = (
	candidates: ReadonlyArray<AdvisoryFreshnessCandidate>,
	model: string,
	response: typeof OpenAiSemanticReviewResponseSchema.Type,
) =>
	Option.match(responseContent(response), {
		onNone: () => fallbackReport(candidates, model, "OpenAI returned no content"),
		onSome: (availableContent) =>
			Option.match(Option.flatMap(decodeJsonOption(availableContent), decodeSemanticBatchOption), {
				onNone: () => fallbackReport(candidates, model, "OpenAI review JSON failed validation"),
				onSome: (batch) => reportFromSemanticBatch(candidates, model, response, batch),
			}),
	});

const reportFromOpenAiText = (
	candidates: ReadonlyArray<AdvisoryFreshnessCandidate>,
	model: string,
	text: string,
) =>
	Option.match(Option.flatMap(decodeJsonOption(text), decodeOpenAiResponseOption), {
		onNone: () => fallbackReport(candidates, model, "OpenAI response was not decodable"),
		onSome: (response) => reportFromOpenAiResponse(candidates, model, response),
	});

const requestBody = (candidates: ReadonlyArray<AdvisoryFreshnessCandidate>, model: string) => ({
	model,
	temperature: 0.2,
	max_tokens: 1800,
	response_format: {
		type: "json_schema",
		json_schema: {
			name: "semantic_impact_reviews",
			strict: true,
			schema: semanticReviewJsonSchema,
		},
	},
	messages: [
		{
			role: "system",
			content:
				"You review documentation freshness evidence. Return only schema-valid JSON. Treat deterministic evidence as authoritative and label your conclusions as advisory.",
		},
		{ role: "user", content: advisoryPrompt(candidates) },
	],
});

const selectedPatchDocumentPath = (report: AiAdvisoryReport) =>
	report.patchProposal?.path ?? report.librarianPick?.path ?? "";

const readDocumentText = (repoRoot: string, documentPath: string) =>
	Match.value(documentPath.length > 0).pipe(
		Match.when(true, () => readFile(path.join(repoRoot, documentPath), "utf8").catch(() => "")),
		Match.orElse(() => Promise.resolve("")),
	);

const patchProposalPrompt = (report: AiAdvisoryReport, documentText: string) =>
	[
		"Generate a non-mutating documentation patch proposal artifact.",
		"Return exactly one proposal for the Docs Librarian pick path.",
		"Do not claim that source files were edited. Mark requiresHumanReview true.",
		"Use concise, practical Markdown in markdownArtifact.",
		"Advisory report:",
		encodeJson(report),
		"Current document text excerpt:",
		documentText.slice(0, 12_000),
	].join("\n");

const patchProposalRequestBody = (
	report: AiAdvisoryReport,
	model: string,
	documentText: string,
) => ({
	model,
	temperature: 0.2,
	max_tokens: 1400,
	response_format: {
		type: "json_schema",
		json_schema: {
			name: "patch_proposal_batch",
			strict: true,
			schema: patchProposalJsonSchema,
		},
	},
	messages: [
		{
			role: "system",
			content:
				"You produce safe documentation patch proposal artifacts. Return only schema-valid JSON. Never say changes were applied.",
		},
		{ role: "user", content: patchProposalPrompt(report, documentText) },
	],
});

const patchProposalFromResponse = (
	report: AiAdvisoryReport,
	response: typeof OpenAiSemanticReviewResponseSchema.Type,
) =>
	Option.match(responseContent(response), {
		onNone: () => fallbackPatchProposalForReport(report, "OpenAI patch response was empty"),
		onSome: (content) =>
			Option.match(Option.flatMap(decodeJsonOption(content), decodePatchProposalBatchOption), {
				onNone: () =>
					fallbackPatchProposalForReport(report, "OpenAI patch proposal failed validation"),
				onSome: (batch) =>
					Option.getOrElse(Option.fromNullishOr(batch.proposals[0]), () =>
						fallbackPatchProposalForReport(report, "OpenAI returned no patch proposal"),
					),
			}),
	});

const patchProposalResultFromOpenAiResponse = (
	report: AiAdvisoryReport,
	model: string,
	response: typeof OpenAiSemanticReviewResponseSchema.Type,
) => {
	const proposal = patchProposalFromResponse(report, response);
	const provenance = patchProposalOpenAiProvenance(model, response);

	return { proposal, provenance };
};

const undecodablePatchProposalResult = (report: AiAdvisoryReport, model: string) => ({
	proposal: fallbackPatchProposalForReport(report, "OpenAI patch response was not decodable"),
	provenance: fallbackFeatureProvenance(
		"patch-proposal",
		model,
		0,
		"OpenAI patch response was not decodable",
	),
});

const patchProposalResultFromOpenAiText = (report: AiAdvisoryReport, model: string, text: string) =>
	Option.match(Option.flatMap(decodeJsonOption(text), decodeOpenAiResponseOption), {
		onNone: () => undecodablePatchProposalResult(report, model),
		onSome: (response) => patchProposalResultFromOpenAiResponse(report, model, response),
	});

const fetchSemanticReviewsEffect = Effect.fn("GenerateAiAdvisory.fetchSemanticReviews")(function* (
	candidates: ReadonlyArray<AdvisoryFreshnessCandidate>,
	model: string,
	apiKey: string,
) {
	const client = yield* HttpClient.HttpClient;
	const request = HttpClientRequest.post("https://api.openai.com/v1/chat/completions").pipe(
		HttpClientRequest.bearerToken(apiKey),
		HttpClientRequest.accept("application/json"),
		HttpClientRequest.bodyJsonUnsafe(requestBody(candidates, model)),
	);
	const response = yield* client.execute(request).pipe(Effect.timeout("20 seconds"));
	const text = yield* response.text;

	return Match.value(response.status >= 200 && response.status < 300).pipe(
		Match.when(true, () => reportFromOpenAiText(candidates, model, text)),
		Match.orElse(() =>
			fallbackReport(candidates, model, `OpenAI request failed: ${response.status}`),
		),
	);
});

const fetchPatchProposalEffect = Effect.fn("GenerateAiAdvisory.fetchPatchProposal")(function* (
	report: AiAdvisoryReport,
	model: string,
	apiKey: string,
	documentText: string,
) {
	const client = yield* HttpClient.HttpClient;
	const request = HttpClientRequest.post("https://api.openai.com/v1/chat/completions").pipe(
		HttpClientRequest.bearerToken(apiKey),
		HttpClientRequest.accept("application/json"),
		HttpClientRequest.bodyJsonUnsafe(patchProposalRequestBody(report, model, documentText)),
	);
	const response = yield* client.execute(request).pipe(Effect.timeout("20 seconds"));
	const text = yield* response.text;

	return Match.value(response.status >= 200 && response.status < 300).pipe(
		Match.when(true, () => patchProposalResultFromOpenAiText(report, model, text)),
		Match.orElse(() => ({
			proposal: fallbackPatchProposalForReport(
				report,
				`OpenAI patch request failed: ${response.status}`,
			),
			provenance: fallbackFeatureProvenance(
				"patch-proposal",
				model,
				0,
				`OpenAI patch request failed: ${response.status}`,
			),
		})),
	);
});

const readFreshness = (filePath: string) =>
	readFile(filePath, "utf8").then((content) =>
		Option.getOrElse(Option.flatMap(decodeJsonOption(content), decodeFreshnessOption), () => ({
			files: [],
		})),
	);

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".astro"]);
const ignoredDirectories = new Set([".astro", ".git", "dist", "node_modules", "public", "target"]);

const sourceRoots = (repoRoot: string) =>
	["agents", "packages"].map((segment) => path.join(repoRoot, segment));

const sourceFilePath = (repoRoot: string, filePath: string) =>
	path.relative(repoRoot, filePath).replaceAll(path.sep, "/");

const sourceFileNameToken = (filePath: string) =>
	path.basename(filePath, path.extname(filePath)).toLowerCase();

const filesForDirectoryEntry = (repoRoot: string, entryPath: string, entryName: string) =>
	Match.value(ignoredDirectories.has(entryName)).pipe(
		Match.when(true, () => Promise.resolve([])),
		Match.orElse(() => listSourceFiles(repoRoot, entryPath)),
	);

const filesForSourceEntry = (
	repoRoot: string,
	directory: string,
	entry: { readonly name: string; isDirectory(): boolean },
) => {
	const entryPath = path.join(directory, entry.name);
	const isSourceFile = sourceExtensions.has(path.extname(entry.name));

	return Match.value([entry.isDirectory(), isSourceFile]).pipe(
		Match.when([true, Match.any], () => filesForDirectoryEntry(repoRoot, entryPath, entry.name)),
		Match.when([false, true], () => Promise.resolve([sourceFilePath(repoRoot, entryPath)])),
		Match.orElse(() => Promise.resolve([])),
	);
};

const listSourceFiles = async (
	repoRoot: string,
	directory: string,
): Promise<ReadonlyArray<string>> =>
	readdir(directory, { withFileTypes: true })
		.then((entries) =>
			Promise.all(entries.map((entry) => filesForSourceEntry(repoRoot, directory, entry))),
		)
		.then((groups) => groups.flat())
		.catch(() => []);

const allSourceFiles = async (repoRoot: string) =>
	Promise.all(sourceRoots(repoRoot).map((directory) => listSourceFiles(repoRoot, directory))).then(
		(groups) => groups.flat(),
	);

const docTokens = (content: string) =>
	new Set(
		[...content.matchAll(/[A-Z][A-Za-z0-9]{3,}|`([A-Za-z][A-Za-z0-9]+)`/g)]
			.map((match) => (match[1] ?? match[0]).toLowerCase())
			.filter((token) => token.length >= 4),
	);

const issueMentionsPath = (candidate: AdvisoryFreshnessCandidate, codePath: string) =>
	(candidate.issues ?? []).some((issue) => issue.includes(codePath));

const implicitRelationshipsFromContent = (
	candidate: AdvisoryFreshnessCandidate,
	codePaths: ReadonlyArray<string>,
	content: string,
) => {
	const tokens = docTokens(content);

	return codePaths.flatMap((codePath) =>
		implicitRelationshipForSource(candidate, tokens, codePath),
	);
};

const implicitRelationshipForSource = (
	candidate: AdvisoryFreshnessCandidate,
	tokens: ReadonlySet<string>,
	codePath: string,
) =>
	Match.value(
		tokens.has(sourceFileNameToken(codePath)) && !issueMentionsPath(candidate, codePath),
	).pipe(
		Match.when(true, () => [
			implicitDocCodeRelationshipSchema.make({
				docPath: candidate.path,
				codePath,
				relationshipType: "implicit-ai-suggested",
				confidence: "low",
				reason: `Document text mentions ${sourceFileNameToken(codePath)}, and ${codePath} exists in the repository. Treat as advisory until confirmed.`,
			}),
		]),
		Match.orElse(() => []),
	);

const implicitRelationshipsForCandidate = async (
	repoRoot: string,
	codePaths: ReadonlyArray<string>,
	candidate: AdvisoryFreshnessCandidate,
) =>
	readFile(path.join(repoRoot, candidate.path), "utf8")
		.then((content) => implicitRelationshipsFromContent(candidate, codePaths, content))
		.then((relationships) => relationships.slice(0, 5))
		.catch(() => []);

const implicitRelationships = async (
	repoRoot: string,
	candidates: ReadonlyArray<AdvisoryFreshnessCandidate>,
) => {
	const codePaths = await allSourceFiles(repoRoot);
	const relationships = await Promise.all(
		candidates.map((candidate) =>
			implicitRelationshipsForCandidate(repoRoot, codePaths, candidate),
		),
	);

	return relationships.flat();
};

async function runSemanticReviews(
	candidates: ReadonlyArray<AdvisoryFreshnessCandidate>,
	model: string,
	apiKey: string,
) {
	const requested = fetchSemanticReviewsEffect(candidates, model, apiKey);
	const recovered = Effect.catchCause(requested, () =>
		Effect.succeed(fallbackReport(candidates, model, "OpenAI request error")),
	);
	const provided = Effect.provide(recovered, FetchHttpClient.layer);

	return await Effect.runPromise(provided);
}

const patchFallback = (report: AiAdvisoryReport, model: string, note: string) => {
	const proposal = fallbackPatchProposalForReport(report, note);
	const itemCount = Match.value(proposal.status).pipe(
		Match.when("generated", () => 1),
		Match.orElse(() => 0),
	);
	const provenance = fallbackFeatureProvenance("patch-proposal", model, itemCount, note);

	return addPatchProposalToReport(report, proposal, provenance);
};

async function runPatchProposal(
	report: AiAdvisoryReport,
	model: string,
	apiKey: string,
	repoRoot: string,
) {
	const fallback = fallbackPatchProposalForReport(report, "OpenAI patch proposal unavailable");

	return await Match.value(fallback.status).pipe(
		Match.when("skipped", () => Promise.resolve(patchFallback(report, model, fallback.rationale))),
		Match.orElse(() => runRequestedPatchProposal(report, model, apiKey, repoRoot)),
	);
}

async function runRequestedPatchProposal(
	report: AiAdvisoryReport,
	model: string,
	apiKey: string,
	repoRoot: string,
) {
	const documentText = await readDocumentText(repoRoot, selectedPatchDocumentPath(report));
	const requested = fetchPatchProposalEffect(report, model, apiKey, documentText);
	const recovered = Effect.catchCause(requested, () =>
		Effect.succeed({
			proposal: fallbackPatchProposalForReport(report, "OpenAI patch request error"),
			provenance: fallbackFeatureProvenance(
				"patch-proposal",
				model,
				1,
				"OpenAI patch request error",
			),
		}),
	);
	const provided = Effect.provide(recovered, FetchHttpClient.layer);
	const result = await Effect.runPromise(provided);

	return addPatchProposalToReport(report, result.proposal, result.provenance);
}

const reportWithPatchProposal = (report: AiAdvisoryReport, model: string, repoRoot: string) =>
	Option.match(openAiApiKey(), {
		onNone: () => Promise.resolve(patchFallback(report, model, "OPENAI_API_KEY not set")),
		onSome: (apiKey) => runPatchProposal(report, model, apiKey, repoRoot),
	});

const reportWithImplicitRelationships = async (
	report: AiAdvisoryReport,
	repoRoot: string,
	candidates: ReadonlyArray<AdvisoryFreshnessCandidate>,
) => {
	const relationships = await implicitRelationships(repoRoot, candidates);
	const provenance = fallbackFeatureProvenance(
		"implicit-relationships",
		"deterministic-implicit-relationship-scanner",
		relationships.length,
		"Heuristic advisory relationships only; not used for gate scoring",
	);

	return addImplicitRelationshipsToReport(report, relationships, provenance);
};

const advisoryReport = (candidates: ReadonlyArray<AdvisoryFreshnessCandidate>, model: string) =>
	Match.value(candidates.length).pipe(
		Match.when(0, () =>
			Promise.resolve(fallbackReport(candidates, model, "No stale or warning documents to review")),
		),
		Match.orElse(() =>
			Option.match(openAiApiKey(), {
				onNone: () => Promise.resolve(fallbackReport(candidates, model, "OPENAI_API_KEY not set")),
				onSome: (apiKey) => runSemanticReviews(candidates, model, apiKey),
			}),
		),
	);

const freshnessPath = requiredArg("freshness");
const outputPath = requiredArg("output");
const repoRoot = argValue("repoRoot", process.cwd());
const freshness = await readFreshness(freshnessPath);
const model = advisoryModel();
const candidates = candidatesFromFreshness(freshness);
const semanticReport = await advisoryReport(candidates, model);
const relationshipReport = await reportWithImplicitRelationships(
	semanticReport,
	repoRoot,
	candidates,
);
const report = await reportWithPatchProposal(relationshipReport, model, repoRoot);

await writeFile(outputPath, `${encodeJson(report)}\n`);

process.stdout.write(
	`Generated semantic advisory review for ${candidates.length.toLocaleString("en-GB")} candidate(s).\n`,
);
