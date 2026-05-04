import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Effect, Match, Option, Record, Schema } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import {
	type AdvisoryAction,
	type AdvisoryRisk,
	type AiAdvisoryReport,
	type AiFeatureProvenance,
	aiAdvisoryReportSchema,
	aiFeatureProvenanceSchema,
	type DocsLibrarianPick,
	type DraftPrRecommendation,
	type ImplicitDocCodeRelationship,
	type IssueBodyDraft,
	type PatchProposal,
} from "../src/AiAdvisory";
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

type ExecutiveSummary = {
	readonly text: string;
	readonly provenance: AiFeatureProvenance;
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
const decodeOdsOption = Schema.decodeUnknownOption(OdsResponseSchema);
const decodeFreshnessOption = Schema.decodeUnknownOption(FreshnessResultSchema);
const decodeAdvisoryOption = Schema.decodeUnknownOption(aiAdvisoryReportSchema);
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

const emptyAdvisoryReport = (): AiAdvisoryReport =>
	aiAdvisoryReportSchema.make({
		semanticReviews: [],
		rankings: [],
		risks: [],
		actions: [],
		issueBodyDrafts: [],
		implicitRelationships: [],
		provenance: [],
	});

const readAdvisoryJsonFromFile = async (filePath: string) =>
	readFile(filePath, "utf8")
		.then((content) =>
			Option.getOrElse(Option.flatMap(decodeJsonOption(content), decodeAdvisoryOption), () =>
				emptyAdvisoryReport(),
			),
		)
		.catch(emptyAdvisoryReport);

const readAdvisoryJson = async (filePath: string) =>
	Match.value(filePath.trim().length > 0).pipe(
		Match.when(true, () => readAdvisoryJsonFromFile(filePath)),
		Match.orElse(() => Promise.resolve(emptyAdvisoryReport())),
	);

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

const fallbackProvenance = (model: string, note: string): AiFeatureProvenance =>
	aiFeatureProvenanceSchema.make({
		feature: "executive-summary",
		source: "fallback",
		provider: "none",
		model,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		itemCount: 1,
		generatedAt: new Date().toISOString(),
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
				provenance: aiFeatureProvenanceSchema.make({
					feature: "executive-summary",
					source: "openai",
					provider: "openai",
					model: response.model ?? requestedModel,
					inputTokens: tokenCount(response.usage?.prompt_tokens),
					outputTokens: tokenCount(response.usage?.completion_tokens),
					totalTokens: tokenCount(response.usage?.total_tokens),
					itemCount: 1,
					generatedAt: new Date().toISOString(),
				}),
			}) satisfies ExecutiveSummary,
	});
};

const openAiExecutiveSummaryFromText = (freshness: FreshnessResult, model: string, text: string) =>
	Option.match(Option.flatMap(decodeJsonOption(text), decodeOpenAiSummaryOption), {
		onNone: () => fallbackExecutiveSummary(freshness, model, "OpenAI response was not decodable"),
		onSome: (response) => openAiExecutiveSummaryFromResponse(freshness, model, response),
	});

const openAiSummaryRequestBody = (freshness: FreshnessResult, model: string) => ({
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
});

const fetchOpenAiExecutiveSummaryEffect = Effect.fn(
	"WriteStarlightReports.fetchOpenAiExecutiveSummary",
)(function* (freshness: FreshnessResult, model: string, apiKey: string) {
	const client = yield* HttpClient.HttpClient;
	const request = HttpClientRequest.post("https://api.openai.com/v1/chat/completions").pipe(
		HttpClientRequest.bearerToken(apiKey),
		HttpClientRequest.accept("application/json"),
		HttpClientRequest.bodyJsonUnsafe(openAiSummaryRequestBody(freshness, model)),
	);
	const response = yield* client.execute(request).pipe(Effect.timeout("10 seconds"));
	const text = yield* response.text;

	return Match.value(response.status >= 200 && response.status < 300).pipe(
		Match.when(true, () => openAiExecutiveSummaryFromText(freshness, model, text)),
		Match.orElse(() =>
			fallbackExecutiveSummary(freshness, model, `OpenAI request failed: ${response.status}`),
		),
	);
});

const executiveSummary = (freshness: FreshnessResult) => {
	const model = summaryModel();

	return Option.match(openAiApiKey(), {
		onNone: () =>
			Promise.resolve(fallbackExecutiveSummary(freshness, model, "OPENAI_API_KEY not set")),
		onSome: (apiKey) =>
			Effect.runPromise(
				fetchOpenAiExecutiveSummaryEffect(freshness, model, apiKey).pipe(
					Effect.catchCause((cause) =>
						Effect.succeed(
							fallbackExecutiveSummary(freshness, model, `OpenAI request error: ${String(cause)}`),
						),
					),
					Effect.provide(FetchHttpClient.layer),
				),
			),
	});
};

const provenanceNote = (provenance: AiFeatureProvenance) =>
	Option.getOrElse(Option.fromNullishOr(provenance.note), () => "n/a");

const provenanceRow = (provenance: AiFeatureProvenance) =>
	`| ${escapeTableCell(provenance.feature)} | ${escapeTableCell(
		provenance.source,
	)} | ${escapeTableCell(provenance.provider)} | ${escapeTableCell(
		provenance.model,
	)} | ${provenance.itemCount.toLocaleString("en-GB")} | ${provenance.inputTokens.toLocaleString(
		"en-GB",
	)} | ${provenance.outputTokens.toLocaleString("en-GB")} | ${provenance.totalTokens.toLocaleString(
		"en-GB",
	)} | ${escapeTableCell(provenance.generatedAt)} | ${escapeTableCell(provenanceNote(provenance))} |`;

const provenanceTable = (provenances: ReadonlyArray<AiFeatureProvenance>) => `## AI Provenance

**Audit engine:** deterministic Effect pipeline; audit model tokens 0.

| Feature | Source | Provider | Model | Items | Input tokens | Output tokens | Total tokens | Generated at | Note |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
${provenances.map(provenanceRow).join("\n") || "| No AI features ran | fallback | none | n/a | 0 | 0 | 0 | 0 | n/a | n/a |"}`;

const rankingScoreForPath = (advisory: AiAdvisoryReport, path: string) =>
	Option.match(Option.fromNullishOr(advisory.rankings.find((ranking) => ranking.path === path)), {
		onNone: () => "n/a",
		onSome: (ranking) => ranking.finalScore.toLocaleString("en-GB"),
	});

const advisoryReviewRow =
	(advisory: AiAdvisoryReport) => (review: AiAdvisoryReport["semanticReviews"][number]) =>
		`| ${escapeTableCell(review.path)} | ${escapeTableCell(
			review.staleClassification,
		)} | ${escapeTableCell(review.semanticImpact)} | ${escapeTableCell(
			review.confidence,
		)} | ${rankingScoreForPath(advisory, review.path)} | ${escapeTableCell(
			review.rationale,
		)} | ${escapeTableCell(review.affectedSections.join("; ") || "n/a")} | ${escapeTableCell(
			review.suggestedFixes.join("; ") || "n/a",
		)} |`;

const advisoryReviewMarkdown = (advisory: AiAdvisoryReport) => `## AI Advisory Review

| Document | Classification | Semantic impact | Confidence | Score | Rationale | Affected sections | Suggested fixes |
| --- | --- | --- | --- | ---: | --- | --- | --- |
${advisory.semanticReviews.map(advisoryReviewRow(advisory)).join("\n") || "| No semantic advisory review generated | needs-review | none | low | 0 | No stale or warning documents were reviewed. | n/a | n/a |"}`;

const advisoryRiskRow = (risk: AdvisoryRisk) =>
	`| ${escapeTableCell(risk.path)} | ${escapeTableCell(risk.severity)} | ${escapeTableCell(
		risk.reason,
	)} |`;

const advisoryActionRow = (action: AdvisoryAction) =>
	`| ${escapeTableCell(action.path)} | ${escapeTableCell(action.priority)} | ${escapeTableCell(
		action.action,
	)} |`;

const advisoryExecutiveMarkdown = (advisory: AiAdvisoryReport) => {
	const risks = advisory.risks ?? [];
	const actions = advisory.actions ?? [];

	return `### Top Advisory Risks

| Document | Severity | Reason |
| --- | --- | --- |
${risks.map(advisoryRiskRow).join("\n") || "| No advisory risks ranked | low | Advisory data unavailable. |"}

### Top Next Actions

| Document | Priority | Action |
| --- | --- | --- |
${actions.map(advisoryActionRow).join("\n") || "| No advisory actions ranked | low | Advisory data unavailable. |"}`;
};

const librarianPickTable = (pick: DocsLibrarianPick) => `> ${escapeTableCell(pick.note)}

| Document | Score | Why | Suggested action |
| --- | ---: | --- | --- |
| ${escapeTableCell(pick.path)} | ${pick.finalScore.toLocaleString("en-GB")} | ${escapeTableCell(
	pick.reason,
)} | ${escapeTableCell(pick.action)} |`;

const docsLibrarianPickMarkdown = (advisory: AiAdvisoryReport) => `## Docs Librarian's Pick

${Option.match(Option.fromNullishOr(advisory.librarianPick), {
	onNone: () => "No ranked advisory candidate was available for a librarian pick.",
	onSome: librarianPickTable,
})}`;

const issueBodyDraftRow = (draft: IssueBodyDraft) =>
	`| ${escapeTableCell(draft.path)} | ${escapeTableCell(draft.title)} | ${escapeTableCell(
		draft.marker,
	)} |`;

const issueBodyDraftMarkdown = (advisory: AiAdvisoryReport) => {
	const drafts = advisory.issueBodyDrafts ?? [];

	return `## AI Issue Body Drafts

| Document | Title | Stable marker |
| --- | --- | --- |
${drafts.map(issueBodyDraftRow).join("\n") || "| No critical issue body drafts generated | n/a | n/a |"}`;
};

const patchProposalTable = (proposal: PatchProposal) =>
	`| ${escapeTableCell(proposal.path)} | ${escapeTableCell(proposal.status)} | ${escapeTableCell(
		proposal.title,
	)} | ${escapeTableCell(proposal.rationale)} | ${escapeTableCell(
		proposal.proposedChanges.join("; ") || "n/a",
	)} | ${escapeTableCell(String(proposal.requiresHumanReview))} |`;

const patchProposalMarkdown = (advisory: AiAdvisoryReport) => `## Patch Proposal Artifact

${Option.match(Option.fromNullishOr(advisory.patchProposal), {
	onNone: () => "No patch proposal artifact was generated.",
	onSome: (proposal) => `| Document | Status | Title | Rationale | Proposed changes | Human review |
| --- | --- | --- | --- | --- | --- |
${patchProposalTable(proposal)}

${proposal.markdownArtifact}`,
})}`;

const draftPrTable = (draftPr: DraftPrRecommendation) =>
	`| ${escapeTableCell(
		draftPr.status,
	)} | ${escapeTableCell(draftPr.branchName)} | ${escapeTableCell(
		draftPr.title,
	)} | ${escapeTableCell(draftPr.reason)} | ${escapeTableCell(draftPr.comment)} |`;

const draftPrMarkdown = (advisory: AiAdvisoryReport) => `## Draft PR Recommendation

${Option.match(Option.fromNullishOr(advisory.draftPr), {
	onNone: () => "No draft PR recommendation was generated.",
	onSome: (draftPr) => `| Status | Branch | Title | Reason | Proposed comment |
| --- | --- | --- | --- | --- |
${draftPrTable(draftPr)}`,
})}`;

const implicitRelationshipRow = (relationship: ImplicitDocCodeRelationship) =>
	`| ${escapeTableCell(relationship.docPath)} | ${escapeTableCell(
		relationship.codePath,
	)} | ${escapeTableCell(relationship.relationshipType)} | ${escapeTableCell(
		relationship.confidence,
	)} | ${escapeTableCell(relationship.reason)} |`;

const implicitRelationshipsMarkdown = (advisory: AiAdvisoryReport) => {
	const relationships = advisory.implicitRelationships ?? [];

	return `## Implicit Doc/Code Relationship Suggestions

These suggestions are advisory only and do not affect freshness scoring.

| Document | Code path | Type | Confidence | Reason |
| --- | --- | --- | --- | --- |
${relationships.map(implicitRelationshipRow).join("\n") || "| No implicit relationships suggested | n/a | implicit-ai-suggested | low | n/a |"}`;
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
	advisory: AiAdvisoryReport,
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

## Executive Summary

${executive.text}

${advisoryExecutiveMarkdown(advisory)}

${docsLibrarianPickMarkdown(advisory)}

${advisoryReviewMarkdown(advisory)}

${issueBodyDraftMarkdown(advisory)}

${patchProposalMarkdown(advisory)}

${draftPrMarkdown(advisory)}

${implicitRelationshipsMarkdown(advisory)}

${provenanceTable([executive.provenance, ...advisory.provenance])}

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
const advisory = await readAdvisoryJson(argValue("advisory", ""));
const pageviewRows = pageviewsFromOds(ods);
const routes = starlightRouteMap(docsRoot, await listMarkdownFiles(docsRoot));
const summary = await executiveSummary(freshness);

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "pageviews.md"), pageviewsMarkdown(pageviewRows));
await writeFile(
	path.join(outDir, "freshness.md"),
	freshnessMarkdown(freshness, pageviewRows, routes, summary, advisory),
);
