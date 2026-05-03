import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";

const decodeJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);
const packageRoot = path.resolve(import.meta.dir, "../..");

const runExtractor = (inputPath: string, outputPath: string) =>
	Bun.spawnSync(
		["bun", "scripts/extract-flue-json.ts", "--input", inputPath, "--output", outputPath],
		{ cwd: packageRoot },
	);

const withTempDir = async <A>(run: (directory: string) => Promise<A>) => {
	const directory = await mkdtemp(path.join(tmpdir(), "doc-freshness-"));

	try {
		return await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
};

describe("extract-flue-json CLI", () => {
	test("extracts the marked Flue result block through Effect Schema JSON decoding", async () => {
		await withTempDir(async (directory) => {
			const inputPath = path.join(directory, "flue-output.txt");
			const outputPath = path.join(directory, "result.json");
			await writeFile(
				inputPath,
				[
					"[flue] Building workspace",
					"---RESULT_START---",
					"```json",
					'{ "report": "ok", "shouldFail": false }',
					"```",
					"---RESULT_END---",
					"[flue] Done",
				].join("\n"),
			);

			const result = runExtractor(inputPath, outputPath);

			expect(result.exitCode).toBe(0);
			const output = decodeJson(await readFile(outputPath, "utf8"));
			expect(output).toEqual({ report: "ok", shouldFail: false });
		});
	});

	test("falls back to a clean final JSON suffix when result markers are unavailable", async () => {
		await withTempDir(async (directory) => {
			const inputPath = path.join(directory, "flue-output.txt");
			const outputPath = path.join(directory, "result.json");
			await writeFile(
				inputPath,
				["[flue] Build complete. Output: /tmp/out", '{"pageCount":0,"totalViews":0}'].join("\n"),
			);

			const result = runExtractor(inputPath, outputPath);

			expect(result.exitCode).toBe(0);
			const output = decodeJson(await readFile(outputPath, "utf8"));
			expect(output).toEqual({ pageCount: 0, totalViews: 0 });
		});
	});
});
