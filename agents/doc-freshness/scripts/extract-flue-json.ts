import { readFile, writeFile } from "node:fs/promises";
import { Array as EffectArray, Match, Option, Record, Schema } from "effect";

const flueJsonSchema = Schema.UnknownFromJsonString;
const cliArgsSchema = Schema.Struct({
	input: Schema.NonEmptyString,
	output: Schema.NonEmptyString,
});
const decodeJsonOption = (value: string) =>
	Schema.decodeOption(flueJsonSchema)(stripCodeFence(value));
const encodeJson = Schema.encodeSync(flueJsonSchema);

const collectArgs = (args: ReadonlyArray<string>) =>
	args.reduce<Record.ReadonlyRecord<string, string>>(
		(state, arg, index, all) =>
			Match.value(arg.startsWith("--")).pipe(
				Match.when(true, () => Record.set(state, arg.slice(2), all[index + 1] ?? "")),
				Match.orElse(() => state),
			),
		Record.empty<string, string>(),
	);

const parseArgs = (args: ReadonlyArray<string>) =>
	Schema.decodeUnknownOption(cliArgsSchema)(collectArgs(args));

const exitWithUsage = () => {
	process.stderr.write("Usage: bun extract-flue-json.ts --input <file> --output <file>\n");
	process.exit(2);
};

const exitWithMissingResult = (input: string) => {
	process.stderr.write(input);
	process.stderr.write("\nNo JSON result found in Flue output.\n");
	process.exit(1);
};

const stripCodeFence = (value: string) =>
	value
		.trim()
		.replace(/^```(?:json)?\s*/u, "")
		.replace(/\s*```$/u, "")
		.trim();

const resultBlocks = (input: string) =>
	Array.from(
		input.matchAll(/---RESULT_START---([\s\S]*?)---RESULT_END---/gu),
		(match) => match[1] ?? "",
	);

const jsonSuffixCandidates = (input: string) => {
	const trimmed = input.trim();
	const lastJsonStart = trimmed.lastIndexOf("\n{");

	return Match.value(lastJsonStart >= 0).pipe(
		Match.when(true, () => [trimmed.slice(lastJsonStart + 1), trimmed]),
		Match.orElse(() => [trimmed]),
	);
};

const resultCandidates = (input: string) =>
	EffectArray.appendAll(resultBlocks(input).reverse(), jsonSuffixCandidates(input));

const firstDecodedJson = (candidates: ReadonlyArray<string>) =>
	candidates.reduce<Option.Option<unknown>>(
		(state, candidate) =>
			Option.match(state, {
				onNone: () => decodeJsonOption(candidate),
				onSome: () => state,
			}),
		Option.none(),
	);

await Option.match(parseArgs(process.argv.slice(2)), {
	onNone: () => exitWithUsage(),
	onSome: async ({ input: inputPath, output: outputPath }) => {
		const input = await readFile(inputPath, "utf8");
		const result = firstDecodedJson(resultCandidates(input));

		await Option.match(result, {
			onNone: () => exitWithMissingResult(input),
			onSome: (decoded) => writeFile(outputPath, `${encodeJson(decoded)}\n`),
		});
	},
});
