import { readFile } from "node:fs/promises";
import { Match, Option, Record, Schema } from "effect";
import {
	annotationsForFreshness,
	formatGithubActionsAnnotation,
	githubActionsAnnotationInputJsonSchema,
} from "../src/GithubActionsAnnotations";

const args = process.argv.slice(2).reduce<Record.ReadonlyRecord<string, string>>(
	(state, arg, index, all) =>
		Match.value(arg.startsWith("--")).pipe(
			Match.when(true, () => Record.set(state, arg.slice(2), all[index + 1] ?? "")),
			Match.orElse(() => state),
		),
	Record.empty<string, string>(),
);

const inputPath = Record.get(args, "input");

const failMissingInput = (): never => {
	process.stderr.write("Missing required --input argument.\n");
	process.exit(1);
};

const resolvedInputPath = Option.getOrElse(inputPath, failMissingInput);

const decodeFreshnessResult = Schema.decodeUnknownSync(githubActionsAnnotationInputJsonSchema);

const content = await readFile(resolvedInputPath, "utf8");
const result = decodeFreshnessResult(content);
const output = annotationsForFreshness(result).map(formatGithubActionsAnnotation).join("\n");

process.stdout.write(
	Match.value(output.length > 0).pipe(
		Match.when(true, () => `${output}\n`),
		Match.orElse(() => ""),
	),
);
