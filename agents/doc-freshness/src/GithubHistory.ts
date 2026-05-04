import { Data, Match, Option, Record, Schema } from "effect";

const githubHistoryFoundSchema = Schema.Struct({
	_tag: Schema.Literal("CommitFound"),
	path: Schema.String,
	sha: Schema.String,
	committedAt: Schema.String,
	url: Schema.String,
});
const githubHistoryNoneSchema = Schema.Struct({
	_tag: Schema.Literal("NoCommitFound"),
	path: Schema.String,
});
const githubHistoryUnavailableSchema = Schema.Struct({
	_tag: Schema.Literal("HistoryUnavailable"),
	path: Schema.String,
	reason: Schema.String,
});
const githubHistoryEntrySchema = Schema.Union([
	githubHistoryFoundSchema,
	githubHistoryNoneSchema,
	githubHistoryUnavailableSchema,
]);
export const githubHistoryResultJsonSchema = Schema.fromJsonString(
	Schema.Struct({
		histories: Schema.Array(githubHistoryEntrySchema),
	}),
);

export type GitHubHistoryEntry = typeof githubHistoryEntrySchema.Type;

export type GitHubHistoryCommit = {
	readonly sha: string;
	readonly html_url: string;
	readonly commit: {
		readonly committer?: { readonly date?: string | null } | null;
		readonly author?: { readonly date?: string | null } | null;
	};
};

export type GitHubHistoryClient = {
	readonly listCommits: (request: {
		readonly owner: string;
		readonly repo: string;
		readonly ref: string;
		readonly path: string;
	}) => Promise<{ readonly data: ReadonlyArray<GitHubHistoryCommit> }>;
};

type GitHubHistoryRequest = {
	readonly owner: string;
	readonly repo: string;
	readonly ref: string;
	readonly paths: ReadonlyArray<string>;
};

class GitHubHistoryError extends Data.TaggedError("GitHubHistoryError")<{
	readonly path: string;
	readonly cause: unknown;
}> {}

const errorMessage = (cause: unknown) =>
	Match.value(cause instanceof Error).pipe(
		Match.when(true, () => (cause as Error).stack ?? (cause as Error).message),
		Match.orElse(() => String(cause)),
	);

const errorStatus = (cause: unknown) =>
	Match.value(typeof cause === "object" && cause !== null && "status" in cause).pipe(
		Match.when(true, () => (cause as { readonly status: unknown }).status),
		Match.orElse(() => undefined),
	);

export const makeHistoryUnavailable = (path: string, reason: string): GitHubHistoryEntry =>
	githubHistoryUnavailableSchema.make({
		_tag: "HistoryUnavailable",
		path,
		reason,
	});

const uniqueStrings = (values: ReadonlyArray<string>) =>
	values.filter((value, index, allValues) => allValues.indexOf(value) === index);

const makeHistoryForCommit = (filePath: string, commit: GitHubHistoryCommit): GitHubHistoryEntry =>
	Match.value(commit.commit.committer?.date ?? commit.commit.author?.date).pipe(
		Match.when(
			(date): date is string => typeof date === "string" && date.length > 0,
			(date) =>
				githubHistoryFoundSchema.make({
					_tag: "CommitFound",
					path: filePath,
					sha: commit.sha,
					committedAt: date,
					url: commit.html_url,
				}),
		),
		Match.orElse(() => makeHistoryUnavailable(filePath, "commit date unavailable")),
	);

const makeHistoryForOptionalCommit = (
	filePath: string,
	commit: GitHubHistoryCommit | undefined,
): GitHubHistoryEntry =>
	Option.match(Option.fromNullishOr(commit), {
		onNone: () => githubHistoryNoneSchema.make({ _tag: "NoCommitFound", path: filePath }),
		onSome: (availableCommit) => makeHistoryForCommit(filePath, availableCommit),
	});

const makeHistoryForError = (error: GitHubHistoryError): GitHubHistoryEntry =>
	Match.value(errorStatus(error.cause)).pipe(
		Match.when(404, () =>
			githubHistoryNoneSchema.make({ _tag: "NoCommitFound", path: error.path }),
		),
		Match.orElse(() => makeHistoryUnavailable(error.path, errorMessage(error.cause))),
	);

const fetchGithubHistoryEntry = (
	client: GitHubHistoryClient,
	owner: string,
	repo: string,
	ref: string,
	filePath: string,
): Promise<GitHubHistoryEntry> =>
	client
		.listCommits({
			owner,
			repo,
			ref,
			path: filePath,
		})
		.then((response) => makeHistoryForOptionalCommit(filePath, response.data[0]))
		.catch((cause) => makeHistoryForError(new GitHubHistoryError({ path: filePath, cause })));

const cacheEntry = (path: string, entry: GitHubHistoryEntry) => [path, entry] as const;

const historyFromCache = (cache: Record.ReadonlyRecord<string, GitHubHistoryEntry>, path: string) =>
	Option.getOrElse(Record.get(cache, path), () =>
		makeHistoryUnavailable(path, "history cache miss"),
	);

const historyCacheFromEntries = (
	fetchedEntries: ReadonlyArray<readonly [string, GitHubHistoryEntry]>,
) =>
	fetchedEntries.reduce<Record.ReadonlyRecord<string, GitHubHistoryEntry>>(
		(state, [filePath, entry]) => Record.set(state, filePath, entry),
		Record.empty<string, GitHubHistoryEntry>(),
	);

const historyEntriesFromCache = (
	paths: ReadonlyArray<string>,
	cache: Record.ReadonlyRecord<string, GitHubHistoryEntry>,
) => paths.map((filePath) => historyFromCache(cache, filePath));

export function fetchGithubHistoryEntries(
	client: GitHubHistoryClient,
	request: GitHubHistoryRequest,
): Promise<ReadonlyArray<GitHubHistoryEntry>> {
	return Promise.all(
		uniqueStrings(request.paths).map((filePath) =>
			fetchGithubHistoryEntry(client, request.owner, request.repo, request.ref, filePath).then(
				(entry) => cacheEntry(filePath, entry),
			),
		),
	).then((fetchedEntries) =>
		historyEntriesFromCache(request.paths, historyCacheFromEntries(fetchedEntries)),
	);
}
