import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { Octokit } from "@octokit/rest";
import { Effect, Match, Option, Record, Redacted, Schema } from "effect";
import {
	GithubActionsConfig,
	GithubActionsConfigLive,
	githubRepositoryParts,
} from "../src/config/GithubActionsConfig";
import {
	type GithubDraftPrAction,
	githubDraftPrSyncAdvisoryJsonSchema,
	githubOpenPullRequestSchema,
	planGithubDraftPr,
} from "../src/GithubDraftPr";

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

const optionalArg = (name: string, fallback: string) =>
	Option.getOrElse(Record.get(args, name), () => fallback);

const advisoryPath = requiredOption("--advisory", Record.get(args, "advisory"));
const config = await Effect.runPromise(
	Effect.gen(function* () {
		return yield* GithubActionsConfig;
	}).pipe(Effect.provide(GithubActionsConfigLive)),
);
const repositoryParts = githubRepositoryParts(config.githubRepository);
const owner = requiredOption("repository owner", nonEmpty(repositoryParts[0]));
const repo = requiredOption("repository name", nonEmpty(repositoryParts[1]));
const baseBranch = optionalArg("base", process.env.GITHUB_REF_NAME ?? "main");
const token = Redacted.value(config.githubToken);

const octokit = new Octokit({ auth: token });
const decodeAdvisory = Schema.decodeUnknownSync(githubDraftPrSyncAdvisoryJsonSchema);

const advisory = decodeAdvisory(await readFile(advisoryPath, "utf8"));
const pullRequests = await octokit.paginate(octokit.rest.pulls.list, {
	owner,
	repo,
	state: "open",
	per_page: 100,
});
const openPullRequests = pullRequests.map((pullRequest) =>
	githubOpenPullRequestSchema.make({
		number: pullRequest.number,
		title: pullRequest.title,
		body: pullRequest.body ?? undefined,
		headRef: pullRequest.head.ref,
	}),
);
const actions = planGithubDraftPr(advisory, openPullRequests);

const createAction = (action: GithubDraftPrAction) =>
	action as Extract<GithubDraftPrAction, { readonly _tag: "CreateGithubDraftPr" }>;

const updateAction = (action: GithubDraftPrAction) =>
	action as Extract<GithubDraftPrAction, { readonly _tag: "UpdateGithubDraftPr" }>;

const branchRef = (branchName: string) => `heads/${branchName}`;

const createBranchFromBase = async (branchName: string) => {
	const baseRef = await octokit.rest.git.getRef({
		owner,
		repo,
		ref: branchRef(baseBranch),
	});
	await octokit.rest.git.createRef({
		owner,
		repo,
		ref: `refs/${branchRef(branchName)}`,
		sha: baseRef.data.object.sha,
	});

	return baseRef.data.object.sha;
};

const getRefOption = (ref: string) =>
	octokit.rest.git
		.getRef({ owner, repo, ref })
		.then((response) => Option.some(response.data.object.sha))
		.catch(() => Option.none<string>());

const ensureBranch = async (branchName: string) => {
	const existingBranch = await getRefOption(branchRef(branchName));

	return await Option.match(existingBranch, {
		onNone: () => createBranchFromBase(branchName),
		onSome: (sha) => Promise.resolve(sha),
	});
};

const contentBase64 = (content: string) => Buffer.from(content, "utf8").toString("base64");

const contentFromBase64 = (content: string) =>
	Buffer.from(content.replaceAll("\n", ""), "base64").toString("utf8");

const isFileContentData = (
	data: unknown,
): data is { readonly sha: string; readonly content: string } =>
	typeof data === "object" && data !== null && "sha" in data && "content" in data;

const fileContentData = (data: unknown) =>
	Match.value([Array.isArray(data), isFileContentData(data)]).pipe(
		Match.when([true, Match.any], () =>
			Option.none<{ readonly sha: string; readonly content: string }>(),
		),
		Match.when([false, true], () =>
			Option.some(data as { readonly sha: string; readonly content: string }),
		),
		Match.orElse(() => Option.none<{ readonly sha: string; readonly content: string }>()),
	);

const existingFile = (branchName: string, proposalPath: string) =>
	octokit.rest.repos
		.getContent({ owner, repo, path: proposalPath, ref: branchName })
		.then((response) => fileContentData(response.data))
		.catch(() => Option.none<{ readonly sha: string; readonly content: string }>());

const fileUpdateBase = (action: GithubDraftPrAction) => ({
	owner,
	repo,
	branch: action.branchName,
	path: action.proposalPath,
	message: `Add Docs Librarian draft PR proposal for ${action.branchName}`,
	content: contentBase64(action.proposalContent),
});

const fileUpdatePayload = (
	action: GithubDraftPrAction,
	existing: Option.Option<{ readonly sha: string; readonly content: string }>,
) => {
	const base = fileUpdateBase(action);

	return Option.match(existing, {
		onNone: () => base,
		onSome: (file) => ({ ...base, sha: file.sha }),
	});
};

const upsertProposalFile = async (action: GithubDraftPrAction) => {
	await ensureBranch(action.branchName);
	const existing = await existingFile(action.branchName, action.proposalPath);
	const sameContent = Option.match(existing, {
		onNone: () => false,
		onSome: (file) => contentFromBase64(file.content) === action.proposalContent,
	});

	return await Match.value(sameContent).pipe(
		Match.when(true, () => Promise.resolve()),
		Match.orElse(() =>
			octokit.rest.repos
				.createOrUpdateFileContents(fileUpdatePayload(action, existing))
				.then(() => undefined),
		),
	);
};

const createDraftPr = async (action: ReturnType<typeof createAction>) => {
	await upsertProposalFile(action);
	const pullRequest = await octokit.rest.pulls.create({
		owner,
		repo,
		head: action.branchName,
		base: baseBranch,
		title: action.title,
		body: action.body,
		draft: true,
		maintainer_can_modify: true,
	});
	await octokit.rest.issues.createComment({
		owner,
		repo,
		issue_number: pullRequest.data.number,
		body: action.comment,
	});
};

const updateDraftPr = async (action: ReturnType<typeof updateAction>) => {
	await upsertProposalFile(action);
	await octokit.rest.pulls.update({
		owner,
		repo,
		pull_number: action.number,
		title: action.title,
		body: action.body,
	});
};

const executeAction = (action: GithubDraftPrAction) =>
	Match.value(action._tag).pipe(
		Match.when("CreateGithubDraftPr", () => createDraftPr(createAction(action))),
		Match.orElse(() => updateDraftPr(updateAction(action))),
	);

await Promise.all(actions.map(executeAction));

process.stdout.write(
	Match.value(actions.length).pipe(
		Match.when(0, () => "No Docs Librarian draft PR to sync.\n"),
		Match.orElse(
			(count) => `Synced ${count.toLocaleString("en-GB")} Docs Librarian draft PR action(s).\n`,
		),
	),
);
