import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Schema } from "effect";
import { aiAdvisoryReportSchema } from "../AiAdvisory";

const decodeAdvisoryReport = Schema.decodeUnknownSync(
	Schema.UnknownFromJsonString.pipe(Schema.decodeTo(aiAdvisoryReportSchema)),
);
const packageRoot = path.resolve(import.meta.dir, "../..");
const freshnessJson = [
	'{"files":[',
	'{"path":"docs/fresh.md","status":"fresh","issues":[]},',
	'{"path":"docs/stale.md","status":"stale","priority":"critical",',
	'"pageViews30d":75,"issues":["src/stale.ts updated after this doc"]}',
	"]}",
].join("");

const runGenerator = (freshnessPath: string, outputPath: string) =>
	Bun.spawnSync(
		[
			"bun",
			"scripts/generate-ai-advisory.ts",
			"--freshness",
			freshnessPath,
			"--output",
			outputPath,
		],
		{
			cwd: packageRoot,
			env: {
				...process.env,
				OPENAI_API_KEY: "",
				DOC_FRESHNESS_ADVISORY_MODEL: "gpt-4.1-mini",
			},
		},
	);

const withTempDir = async <A>(run: (directory: string) => Promise<A>) => {
	const directory = await mkdtemp(path.join(tmpdir(), "doc-freshness-advisory-"));

	try {
		return await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
};

describe("generate-ai-advisory CLI", () => {
	test("writes fallback semantic reviews when OPENAI_API_KEY is absent", async () => {
		await withTempDir(async (directory) => {
			const freshnessPath = path.join(directory, "freshness.json");
			const outputPath = path.join(directory, "advisory.json");
			await writeFile(freshnessPath, freshnessJson);

			const result = runGenerator(freshnessPath, outputPath);

			expect(result.exitCode).toBe(0);
			const report = decodeAdvisoryReport(await readFile(outputPath, "utf8"));
			expect(report.semanticReviews).toHaveLength(1);
			expect(report.semanticReviews[0]).toMatchObject({
				path: "docs/stale.md",
				semanticImpact: "low",
				confidence: "low",
				staleClassification: "needs-review",
			});
			expect(report.rankings[0]).toMatchObject({
				path: "docs/stale.md",
				finalScore: 76,
			});
			expect(report.risks?.[0]).toMatchObject({
				path: "docs/stale.md",
				severity: "high",
			});
			expect(report.actions?.[0]).toMatchObject({
				path: "docs/stale.md",
				action: "Review the deterministic freshness evidence manually.",
			});
			expect(report.issueBodyDrafts?.[0]).toMatchObject({
				path: "docs/stale.md",
				title: "Critical doc freshness: docs/stale.md",
				marker: "<!-- doc-freshness:docs/stale.md -->",
			});
			expect(report.librarianPick).toMatchObject({
				path: "docs/stale.md",
				finalScore: 76,
			});
			expect(report.patchProposal).toMatchObject({
				path: "docs/stale.md",
				status: "skipped",
			});
			expect(report.draftPr).toMatchObject({
				status: "not-ready",
			});
			expect(report.implicitRelationships).toEqual([]);
			expect(report.provenance[0]).toMatchObject({
				feature: "semantic-impact",
				source: "fallback",
				provider: "none",
				model: "gpt-4.1-mini",
				itemCount: 1,
				note: "OPENAI_API_KEY not set",
			});
			expect(report.provenance[1]).toMatchObject({
				feature: "docs-librarian-pick",
				source: "fallback",
				provider: "none",
				model: "deterministic-docs-librarian",
				itemCount: 1,
			});
			expect(report.provenance.map((entry) => entry.feature)).toContain("implicit-relationships");
			expect(report.provenance.map((entry) => entry.feature)).toContain("patch-proposal");
		});
	});
});
