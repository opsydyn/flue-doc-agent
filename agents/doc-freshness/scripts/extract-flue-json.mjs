import { readFile, writeFile } from "node:fs/promises";

const args = new Map(
	process.argv.slice(2).flatMap((arg, index, all) =>
		arg.startsWith("--") ? [[arg.slice(2), all[index + 1]]] : [],
	),
);

const stripCodeFence = (value) =>
	value
		.trim()
		.replace(/^```(?:json)?\s*/u, "")
		.replace(/\s*```$/u, "")
		.trim();

const parseJson = (value) => JSON.parse(stripCodeFence(value));

const resultBlocks = (input) =>
	[...input.matchAll(/---RESULT_START---([\s\S]*?)---RESULT_END---/gu)].map(
		(match) => match[1],
	);

const parseLastResultBlock = (input) => {
	const blocks = resultBlocks(input);

	for (const block of blocks.reverse()) {
		try {
			return parseJson(block);
		} catch {
			// Fall back to full output scanning below.
		}
	}

	return undefined;
};

const parseLastJsonObject = (input) => {
	let last;

	for (let start = input.indexOf("{"); start !== -1; start = input.indexOf("{", start + 1)) {
		let depth = 0;
		let inString = false;
		let escaped = false;

		for (let end = start; end < input.length; end += 1) {
			const char = input[end];

			if (inString) {
				if (escaped) {
					escaped = false;
				} else if (char === "\\") {
					escaped = true;
				} else if (char === '"') {
					inString = false;
				}
				continue;
			}

			if (char === '"') {
				inString = true;
			} else if (char === "{") {
				depth += 1;
			} else if (char === "}") {
				depth -= 1;
				if (depth === 0) {
					try {
						last = parseJson(input.slice(start, end + 1));
					} catch {
						// Keep scanning for a later complete JSON object.
					}
					break;
				}
			}
		}
	}

	return last;
};

const inputPath = args.get("input");
const outputPath = args.get("output");

if (!inputPath || !outputPath) {
	process.stderr.write("Usage: node extract-flue-json.mjs --input <file> --output <file>\n");
	process.exit(2);
}

const input = await readFile(inputPath, "utf8");
const result = parseLastResultBlock(input) ?? parseLastJsonObject(input);

if (result === undefined) {
	process.stderr.write(input);
	process.stderr.write("\nNo JSON result found in Flue output.\n");
	process.exit(1);
}

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
