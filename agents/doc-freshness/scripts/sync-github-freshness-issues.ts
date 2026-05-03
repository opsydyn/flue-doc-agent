import { readFile } from "node:fs/promises";
import { Octokit } from "@octokit/rest";
import { Effect, Match, Option, Record, Redacted, Schema } from "effect";
import {
	type GithubFreshnessIssueAction,
	githubFreshnessIssueInputJsonSchema,
	githubOpenIssueSchema,
	planGithubFreshnessIssues,
} from "../src/GithubFreshnessIssues";
import {
	GithubActionsConfig,
	GithubActionsConfigLive,
	githubRepositoryParts,
} from "../src/config/GithubActionsConfig";

const args = process.argv.slice(2).reduce<Record.ReadonlyRecord<string, string>>(
	(state, arg, index, all) =>
		Match.value(arg.startsWith("--")).pipe(
			Match.when(true, () => Record.set(state, arg.slice(2), all[index + 1] ?? "")),
			Match.orElse(() => state),
		),
	Record.empty<string, string>(),
);

const nonEmpty = (value: string | undefined) =>
	Match.value(value !== undefined && value.length > 0).pipe(
		Match.when(true, () => Option.some(value ?? "")),
		Match.orElse(() => Option.none<string>()),
	);

const failMissing = (name: string): never => {
	process.stderr.write(`Missing required ${name}.\n`);
	process.exit(1);
};

const requiredOption = (name: string, value: Option.Option<string>) =>
	Option.getOrElse(value, () => failMissing(name));

const inputPath = requiredOption("--input", Record.get(args, "input"));
const config = await Effect.runPromise(
	Effect.gen(function* () {
		return yield* GithubActionsConfig;
	}).pipe(Effect.provide(GithubActionsConfigLive)),
);
const repositoryParts = githubRepositoryParts(config.githubRepository);
const owner = requiredOption("repository owner", nonEmpty(repositoryParts[0]));
const repo = requiredOption("repository name", nonEmpty(repositoryParts[1]));
const token = Redacted.value(config.githubToken);

const octokit = new Octokit({ auth: token });
const decodeFreshnessResult = Schema.decodeUnknownSync(githubFreshnessIssueInputJsonSchema);

const issueFromOctokit = (issue: {
	readonly number: number;
	readonly title: string;
	readonly body?: string | null;
}) =>
	githubOpenIssueSchema.make({
		number: issue.number,
		title: issue.title,
		body: issue.body ?? undefined,
	});

const openIssues = await octokit.paginate(octokit.rest.issues.listForRepo, {
	owner,
	repo,
	state: "open",
	per_page: 100,
});

const content = await readFile(inputPath, "utf8");
const freshness = decodeFreshnessResult(content);
const actions = planGithubFreshnessIssues(freshness, openIssues.map(issueFromOctokit));

const createAction = (action: GithubFreshnessIssueAction) =>
	action as Extract<GithubFreshnessIssueAction, { readonly _tag: "CreateGithubFreshnessIssue" }>;

const updateAction = (action: GithubFreshnessIssueAction) =>
	action as Extract<GithubFreshnessIssueAction, { readonly _tag: "UpdateGithubFreshnessIssue" }>;

const executeIssueAction = (action: GithubFreshnessIssueAction) =>
	Match.value(action._tag).pipe(
		Match.when("CreateGithubFreshnessIssue", () =>
			octokit.rest.issues.create({
				owner,
				repo,
				title: createAction(action).title,
				body: createAction(action).body,
			}),
		),
		Match.orElse(() =>
			octokit.rest.issues.update({
				owner,
				repo,
				issue_number: updateAction(action).number,
				title: updateAction(action).title,
				body: updateAction(action).body,
			}),
		),
	);

await Promise.all(actions.map(executeIssueAction));

process.stdout.write(
	Match.value(actions.length).pipe(
		Match.when(0, () => "No critical freshness issues to sync.\n"),
		Match.orElse((count) => `Synced ${count.toLocaleString("en-GB")} freshness issue(s).\n`),
	),
);
