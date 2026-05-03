import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Match, Option, Record, Schema } from "effect";
import {
	type StarlightRouteMap,
	sourcePathForPage,
	starlightRouteMap,
} from "../src/StarlightRoutes";

type OdsRow = {
	readonly dimensions: ReadonlyArray<string>;
	readonly metrics: ReadonlyArray<number>;
};

type OdsResponse = {
	readonly results: ReadonlyArray<OdsRow>;
};

type FreshnessFile = {
	readonly path: string;
	readonly status: "fresh" | "stale" | "warning";
	readonly priority?: "critical" | "medium" | "low" | undefined;
	readonly pageViews30d?: number | undefined;
	readonly issues?: ReadonlyArray<string> | undefined;
};

type FreshnessResult = {
	readonly files: ReadonlyArray<FreshnessFile>;
	readonly summary: {
		readonly total?: number | undefined;
		readonly fresh?: number | undefined;
		readonly stale?: number | undefined;
		readonly warnings?: number | undefined;
		readonly critical?: number | undefined;
	};
	readonly report: string;
	readonly shouldFail?: boolean | undefined;
};

type PageviewRow = {
	readonly page: string;
	readonly views: number;
};

type AiSummaryProvenance = {
	readonly source: "openai" | "fallback";
	readonly provider: "openai" | "none";
	readonly model: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens: number;
	readonly note?: string | undefined;
};

type ExecutiveSummary = {
	readonly text: string;
	readonly provenance: AiSummaryProvenance;
};

const OdsRowSchema = Schema.Struct({
	dimensions: Schema.Array(Schema.String),
	metrics: Schema.Array(Schema.Number),
});
const OdsResponseSchema = Schema.Struct({
	results: Schema.Array(OdsRowSchema),
});
const FreshnessFileSchema = Schema.Struct({
	path: Schema.String,
	status: Schema.Literals(["fresh", "stale", "warning"]),
	priority: Schema.optional(Schema.Literals(["critical", "medium", "low"])),
	pageViews30d: Schema.optional(Schema.Number),
	issues: Schema.optional(Schema.Array(Schema.String)),
});
const FreshnessResultSchema = Schema.Struct({
	files: Schema.Array(FreshnessFileSchema),
	summary: Schema.Struct({
		total: Schema.optional(Schema.Number),
		fresh: Schema.optional(Schema.Number),
		stale: Schema.optional(Schema.Number),
		warnings: Schema.optional(Schema.Number),
		critical: Schema.optional(Schema.Number),
	}),
	report: Schema.String,
	shouldFail: Schema.optional(Schema.Boolean),
});
const OpenAiUsageSchema = Schema.Struct({
	prompt_tokens: Schema.optional(Schema.Number),
	completion_tokens: Schema.optional(Schema.Number),
	total_tokens: Schema.optional(Schema.Number),
});
const OpenAiSummaryResponseSchema = Schema.Struct({
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
const decodeOdsOption = Schema.decodeUnknownOption(OdsResponseSchema);
const decodeFreshnessOption = Schema.decodeUnknownOption(FreshnessResultSchema);
const decodeOpenAiSummaryOption = Schema.decodeUnknownOption(OpenAiSummaryResponseSchema);

const args = process.argv.slice(2).reduce<Record.ReadonlyRecord<string, string>>(
	(state, arg, index, all) =>
		Match.value(arg.startsWith("--")).pipe(
			Match.when(true, () => Record.set(state, arg.slice(2), all[index + 1] ?? "")),
			Match.orElse(() => state),
		),
	Record.empty<string, string>(),
);

const argValue = (key: string, fallback: string) =>
	Option.getOrElse(Record.get(args, key), () => fallback);

const markdownExtensions: ReadonlyArray<string> = [".md", ".mdx"];

const matchedMarkdownFile = (filePath: string, isMatch: boolean) =>
	Match.value(isMatch).pipe(
		Match.when(true, () => [filePath]),
		Match.orElse(() => []),
	);

const listMarkdownEntry = (directory: string, entry: Dirent<string>) => {
	const filePath = path.join(directory, entry.name);

	return Match.value(entry.isDirectory()).pipe(
		Match.when(true, () => listMarkdownFiles(filePath)),
		Match.orElse(() =>
			Promise.resolve(
				matchedMarkdownFile(
					filePath,
					markdownExtensions.some((extension) => entry.name.endsWith(extension)),
				),
			),
		),
	);
};

const listMarkdownFiles = async (directory: string): Promise<ReadonlyArray<string>> =>
	readdir(directory, { withFileTypes: true })
		.then((entries) => Promise.all(entries.map((entry) => listMarkdownEntry(directory, entry))))
		.then((groups) => groups.flat())
		.catch(() => []);

const readOdsJson = async (filePath: string) =>
	readFile(filePath, "utf8")
		.then((content) =>
			Option.getOrElse(Option.flatMap(decodeJsonOption(content), decodeOdsOption), () => ({
				results: [],
			})),
		)
		.catch(() => ({ results: [] }));

const readFreshnessJson = async (filePath: string) =>
	readFile(filePath, "utf8")
		.then((content) =>
			Option.getOrElse(Option.flatMap(decodeJsonOption(content), decodeFreshnessOption), () => ({
				files: [],
				summary: {},
				report: "No freshness report was returned.",
			})),
		)
		.catch(() => ({
			files: [],
			summary: {},
			report: "No freshness report was returned.",
		}));

const escapeTableCell = (value: unknown) =>
	String(value ?? "")
		.replaceAll("|", "\\|")
		.replaceAll("\n", " ");

const formatDate = () =>
	new Intl.DateTimeFormat("en-GB", {
		dateStyle: "full",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(new Date());

const pageviewsFromOds = (ods: OdsResponse) =>
	ods.results
		.map((row) => ({
			page: row.dimensions[0] ?? "(unknown)",
			views: Number(row.metrics[0] ?? 0),
		}))
		.filter((row) => Number.isFinite(row.views))
		.sort((left, right) => right.views - left.views || left.page.localeCompare(right.page));

const defaultSummaryModel = () => "gpt-4.1-nano";

const summaryModel = () => process.env.DOC_FRESHNESS_SUMMARY_MODEL ?? defaultSummaryModel();

const openAiApiKey = () =>
	Option.filter(
		Option.fromNullishOr(process.env.OPENAI_API_KEY),
		(value) => value.trim().length > 0 && value !== "sk-test",
	);

const summaryNumber = (value: number | undefined) => value ?? 0;

const topAttentionFiles = (freshness: FreshnessResult) =>
	freshness.files
		.filter((file) => file.status !== "fresh")
		.sort(
			(left, right) =>
				(right.pageViews30d ?? 0) - (left.pageViews30d ?? 0) || left.path.localeCompare(right.path),
		)
		.slice(0, 6);

const attentionLine = (file: FreshnessFile) =>
	`- ${file.path}: ${file.status}/${file.priority ?? "low"}, ${file.pageViews30d ?? 0} views, ${(file.issues ?? []).join("; ") || "no listed issues"}`;

const executiveSummaryPrompt = (freshness: FreshnessResult) => {
	const summary = freshness.summary;
	const attentionLines = topAttentionFiles(freshness).map(attentionLine);

	return [
		"Write an executive summary for this documentation freshness report.",
		"Use an original voice: calm, practical, stubborn, scholarly, protective of documents, dryly funny, and faintly banana-adjacent.",
		"Do not imitate Terry Pratchett, Discworld, or any named character. Do not quote or use copyrighted catchphrases.",
		"Keep it useful for executives: 2 short paragraphs, 80-130 words total.",
		"Mention whether anything is critical, what needs attention, and what should happen next.",
		`Counts: total=${summaryNumber(summary.total)}, fresh=${summaryNumber(summary.fresh)}, stale=${summaryNumber(summary.stale)}, warnings=${summaryNumber(summary.warnings)}, critical=${summaryNumber(summary.critical)}.`,
		`Freshness gate shouldFail=${String(freshness.shouldFail ?? summaryNumber(summary.critical) > 0)}.`,
		"Top attention items:",
		attentionLines.join("\n") || "- None; the shelves are quiet.",
	].join("\n");
};

const fallbackProvenance = (model: string, note: string): AiSummaryProvenance => ({
	source: "fallback",
	provider: "none",
	model,
	inputTokens: 0,
	outputTokens: 0,
	totalTokens: 0,
	note,
});

const fallbackExecutiveSummary = (freshness: FreshnessResult, model: string, note: string) => {
	const summary = freshness.summary;
	const total = summaryNumber(summary.total);
	const fresh = summaryNumber(summary.fresh);
	const stale = summaryNumber(summary.stale);
	const warnings = summaryNumber(summary.warnings);
	const critical = summaryNumber(summary.critical);
	const warningPhrase = Match.value(warnings).pipe(
		Match.when(1, () => "1 carries a warning"),
		Match.orElse(() => `${warnings} carry warnings`),
	);
	const criticalSentence = Match.value(critical > 0).pipe(
		Match.when(true, () => `${critical} critical document needs immediate shelving discipline.`),
		Match.orElse(() => "No critical documents are currently biting the furniture."),
	);

	return {
		text: [
			`The catalogue has been inspected with practical calm: ${fresh} of ${total} documents are fresh, while ${stale} are stale and ${warningPhrase}. ${criticalSentence}`,
			"Next action: tidy the attention queue before it learns bad habits, starting with the stale documents that still receive readers. A modest banana may be issued after the links stop grumbling.",
		].join("\n\n"),
		provenance: fallbackProvenance(model, note),
	} satisfies ExecutiveSummary;
};

const tokenCount = (value: number | undefined) => summaryNumber(value);

const openAiExecutiveSummaryFromResponse = (
	freshness: FreshnessResult,
	requestedModel: string,
	response: typeof OpenAiSummaryResponseSchema.Type,
) => {
	const content = Option.filter(
		Option.fromNullishOr(response.choices[0]?.message.content),
		(value) => value.trim().length > 0,
	);

	return Option.match(content, {
		onNone: () => fallbackExecutiveSummary(freshness, requestedModel, "OpenAI returned no content"),
		onSome: (text) =>
			({
				text: text.trim(),
				provenance: {
					source: "openai",
					provider: "openai",
					model: response.model ?? requestedModel,
					inputTokens: tokenCount(response.usage?.prompt_tokens),
					outputTokens: tokenCount(response.usage?.completion_tokens),
					totalTokens: tokenCount(response.usage?.total_tokens),
				},
			}) satisfies ExecutiveSummary,
	});
};

const openAiExecutiveSummaryFromText = (freshness: FreshnessResult, model: string, text: string) =>
	Option.match(Option.flatMap(decodeJsonOption(text), decodeOpenAiSummaryOption), {
		onNone: () => fallbackExecutiveSummary(freshness, model, "OpenAI response was not decodable"),
		onSome: (response) => openAiExecutiveSummaryFromResponse(freshness, model, response),
	});

const fetchOpenAiExecutiveSummary = async (
	freshness: FreshnessResult,
	model: string,
	apiKey: string,
) =>
	fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: encodeJson({
			model,
			temperature: 0.6,
			max_tokens: 220,
			messages: [
				{
					role: "system",
					content:
						"You write concise executive summaries for engineering documentation reports. Be useful, original, and safe.",
				},
				{ role: "user", content: executiveSummaryPrompt(freshness) },
			],
		}),
	})
		.then((response) =>
			response.text().then((text) =>
				Match.value(response.ok).pipe(
					Match.when(true, () => openAiExecutiveSummaryFromText(freshness, model, text)),
					Match.orElse(() =>
						fallbackExecutiveSummary(freshness, model, `OpenAI request failed: ${response.status}`),
					),
				),
			),
		)
		.catch((error: unknown) =>
			fallbackExecutiveSummary(freshness, model, `OpenAI request error: ${String(error)}`),
		);

const executiveSummary = (freshness: FreshnessResult) => {
	const model = summaryModel();

	return Option.match(openAiApiKey(), {
		onNone: () =>
			Promise.resolve(fallbackExecutiveSummary(freshness, model, "OPENAI_API_KEY not set")),
		onSome: (apiKey) => fetchOpenAiExecutiveSummary(freshness, model, apiKey),
	});
};

const provenanceText = (summary: ExecutiveSummary) => {
	const provenance = summary.provenance;
	const modelLabel = Match.value(provenance.source).pipe(
		Match.when("openai", () => `${provenance.provider}/${provenance.model}`),
		Match.orElse(() => `fallback; requested model ${provenance.model}`),
	);
	const note = Option.match(Option.fromNullishOr(provenance.note), {
		onNone: () => "",
		onSome: (availableNote) => `; note: ${availableNote}`,
	});

	return `AI provenance: executive summary ${modelLabel}; input ${provenance.inputTokens.toLocaleString("en-GB")} tokens, output ${provenance.outputTokens.toLocaleString("en-GB")} tokens, total ${provenance.totalTokens.toLocaleString("en-GB")} tokens${note}. Audit engine: deterministic Effect pipeline; audit model tokens 0.`;
};

const pageviewsMarkdown = (rows: ReadonlyArray<PageviewRow>) => {
	const totalViews = rows.reduce((total, row) => total + row.views, 0);
	const tableRows = rows.map(
		(row) => `| ${escapeTableCell(row.page)} | ${row.views.toLocaleString("en-GB")} |`,
	);

	return `---
title: One Dollar Stats 30d Page Views
description: Generated from One Dollar Stats analytics by the doc-freshness workflow.
---

# One Dollar Stats 30d Page Views

_Generated: ${formatDate()} UTC._

| Page | Views |
| --- | ---: |
${tableRows.join("\n") || "| No page views returned | 0 |"}

**Total: ${totalViews.toLocaleString("en-GB")} views across ${rows.length.toLocaleString("en-GB")} pages**
`;
};

const freshnessMarkdown = (
	freshness: FreshnessResult,
	pageviewRows: ReadonlyArray<PageviewRow>,
	routes: StarlightRouteMap,
	executive: ExecutiveSummary,
) => {
	const files = freshness.files;
	const summary = freshness.summary;
	const attentionQueue = files
		.filter((file) => file.status !== "fresh")
		.sort(
			(left, right) =>
				(right.pageViews30d ?? 0) - (left.pageViews30d ?? 0) || left.path.localeCompare(right.path),
		);
	const attentionRows = attentionQueue.map(
		(file) =>
			`| ${escapeTableCell(file.path)} | ${escapeTableCell(file.status)} | ${escapeTableCell(
				file.priority ?? "low",
			)} | ${(file.pageViews30d ?? 0).toLocaleString("en-GB")} | ${escapeTableCell(
				(file.issues ?? []).join("; "),
			)} |`,
	);
	const popularRows = pageviewRows
		.slice(0, 10)
		.map(
			(row) =>
				`| ${escapeTableCell(row.page)} | ${row.views.toLocaleString("en-GB")} | ${escapeTableCell(
					sourcePathForPage(routes, row.page),
				)} |`,
		);

	return `---
title: Documentation Freshness
description: Generated by the doc-freshness Flue agent.
---

# Documentation Freshness

_Generated: ${formatDate()} UTC._  
_${provenanceText(executive)}_

## Executive Summary

${executive.text}

## Overview

| Status | Count |
| --- | ---: |
| Total | ${summary.total ?? 0} |
| Fresh | ${summary.fresh ?? 0} |
| Stale | ${summary.stale ?? 0} |
| Warnings | ${summary.warnings ?? 0} |
| Critical | ${summary.critical ?? 0} |

## Attention Queue

| Document | Status | Priority | 30d views | Issues |
| --- | --- | --- | ---: | --- |
${attentionRows.join("\n") || "| No stale or warning docs | fresh | low | 0 | None |"}

## High-Traffic Pages

| Page | Views | Source file |
| --- | ---: | --- |
${popularRows.join("\n") || "| No page views returned | 0 | n/a |"}

## Agent Report

${freshness.report}
`;
};

const outDir = argValue("out", "packages/docs/src/content/docs/analytics");
const docsRoot = argValue("docsRoot", "packages/docs/src/content/docs");
const ods = await readOdsJson(argValue("ods", "/tmp/ods-pageviews.json"));
const freshness = await readFreshnessJson(argValue("freshness", "/tmp/freshness-result.json"));
const pageviewRows = pageviewsFromOds(ods);
const routes = starlightRouteMap(docsRoot, await listMarkdownFiles(docsRoot));
const summary = await executiveSummary(freshness);

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "pageviews.md"), pageviewsMarkdown(pageviewRows));
await writeFile(
	path.join(outDir, "freshness.md"),
	freshnessMarkdown(freshness, pageviewRows, routes, summary),
);
