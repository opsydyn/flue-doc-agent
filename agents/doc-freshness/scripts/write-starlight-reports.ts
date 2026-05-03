import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Match, Option, Record, Schema } from "effect";

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
};

type PageviewRow = {
	readonly page: string;
	readonly views: number;
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
});
const decodeJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodeOdsOption = Schema.decodeUnknownOption(OdsResponseSchema);
const decodeFreshnessOption = Schema.decodeUnknownOption(FreshnessResultSchema);

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
					relativePathFromPage(row.page),
				)} |`,
		);

	return `---
title: Documentation Freshness
description: Generated by the doc-freshness Flue agent.
---

# Documentation Freshness

_Generated: ${formatDate()} UTC._

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

| Page | Views | Approximate doc slug |
| --- | ---: | --- |
${popularRows.join("\n") || "| No page views returned | 0 | n/a |"}

## Agent Report

${freshness.report}
`;
};

const relativePathFromPage = (page: string) =>
	page
		.replace(/^\/flue-doc-agent\/?/, "")
		.replace(/\/$/, "")
		.replace(/^$/, "index");

const outDir = argValue("out", "packages/docs/src/content/docs/analytics");
const ods = await readOdsJson(argValue("ods", "/tmp/ods-pageviews.json"));
const freshness = await readFreshnessJson(argValue("freshness", "/tmp/freshness-result.json"));
const pageviewRows = pageviewsFromOds(ods);

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "pageviews.md"), pageviewsMarkdown(pageviewRows));
await writeFile(path.join(outDir, "freshness.md"), freshnessMarkdown(freshness, pageviewRows));
