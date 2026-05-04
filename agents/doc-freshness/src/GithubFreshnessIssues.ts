import { Match, Option, Schema } from "effect";
import { type IssueBodyDraft, issueBodyDraftSchema } from "./AiAdvisory";
import { freshnessReviewedFileSchema } from "./FreshnessReview";

const githubFreshnessIssueInputSchema = Schema.Struct({
	files: Schema.Array(freshnessReviewedFileSchema),
});

export const githubFreshnessIssueInputJsonSchema = Schema.fromJsonString(
	githubFreshnessIssueInputSchema,
);

export const githubOpenIssueSchema = Schema.Struct({
	number: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
	title: Schema.String,
	body: Schema.optional(Schema.String),
});

const githubFreshnessIssueAdvisorySchema = Schema.Struct({
	issueBodyDrafts: Schema.optional(Schema.Array(issueBodyDraftSchema)),
});

export const githubFreshnessIssueAdvisoryJsonSchema = Schema.fromJsonString(
	githubFreshnessIssueAdvisorySchema,
);

const githubCreateFreshnessIssueSchema = Schema.Struct({
	_tag: Schema.Literal("CreateGithubFreshnessIssue"),
	title: Schema.String,
	body: Schema.String,
});

const githubUpdateFreshnessIssueSchema = Schema.Struct({
	_tag: Schema.Literal("UpdateGithubFreshnessIssue"),
	number: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
	title: Schema.String,
	body: Schema.String,
});

type GithubFreshnessIssueInput = typeof githubFreshnessIssueInputSchema.Type;
type GithubFreshnessIssueAdvisory = typeof githubFreshnessIssueAdvisorySchema.Type;
type GithubOpenIssue = typeof githubOpenIssueSchema.Type;
export type GithubFreshnessIssueAction =
	| typeof githubCreateFreshnessIssueSchema.Type
	| typeof githubUpdateFreshnessIssueSchema.Type;

const issueMarker = (path: string) => `<!-- doc-freshness:${path} -->`;

const issueTitle = (path: string) => `Critical doc freshness: ${path}`;

const deterministicIssueBody = (
	file: typeof freshnessReviewedFileSchema.Type,
) => `${issueMarker(file.path)}

## Critical documentation freshness issue

Document: \`${file.path}\`

30-day page views: ${(file.pageViews30d ?? 0).toLocaleString("en-GB")}

Last doc commit: \`${file.lastDocCommit}\`

### Evidence

${file.issues.map((issue) => `- ${issue}`).join("\n") || "- Review the freshness report."}

### Remediation

Update the document so it reflects the referenced source files, then rerun the doc freshness
workflow.`;

const draftForFile = (
	file: typeof freshnessReviewedFileSchema.Type,
	drafts: ReadonlyArray<IssueBodyDraft>,
) => Option.fromNullishOr(drafts.find((draft) => draft.path === file.path));

const draftBodyWithMarker = (
	file: typeof freshnessReviewedFileSchema.Type,
	draft: IssueBodyDraft,
) =>
	Match.value(draft.body.includes(issueMarker(file.path))).pipe(
		Match.when(true, () => draft.body),
		Match.orElse(() => `${issueMarker(file.path)}\n${draft.body}`),
	);

const issueBody = (
	file: typeof freshnessReviewedFileSchema.Type,
	drafts: ReadonlyArray<IssueBodyDraft>,
) =>
	Option.match(draftForFile(file, drafts), {
		onNone: () => deterministicIssueBody(file),
		onSome: (draft) => draftBodyWithMarker(file, draft),
	});

const isCriticalFile = (file: typeof freshnessReviewedFileSchema.Type) =>
	file.priority === "critical";

const issueMatchesPath = (path: string, issue: GithubOpenIssue) =>
	(issue.body ?? "").includes(issueMarker(path)) || issue.title === issueTitle(path);

const existingIssueForPath = (path: string, issues: ReadonlyArray<GithubOpenIssue>) =>
	Option.fromNullishOr(issues.find((issue) => issueMatchesPath(path, issue)));

const actionForFile = (
	file: typeof freshnessReviewedFileSchema.Type,
	issues: ReadonlyArray<GithubOpenIssue>,
	drafts: ReadonlyArray<IssueBodyDraft>,
): Option.Option<GithubFreshnessIssueAction> =>
	Option.match(existingIssueForPath(file.path, issues), {
		onNone: () =>
			Option.some(
				githubCreateFreshnessIssueSchema.make({
					_tag: "CreateGithubFreshnessIssue",
					title: issueTitle(file.path),
					body: issueBody(file, drafts),
				}),
			),
		onSome: (issue) =>
			Match.value(
				issue.body === issueBody(file, drafts) && issue.title === issueTitle(file.path),
			).pipe(
				Match.when(true, () => Option.none<GithubFreshnessIssueAction>()),
				Match.orElse(() =>
					Option.some(
						githubUpdateFreshnessIssueSchema.make({
							_tag: "UpdateGithubFreshnessIssue",
							number: issue.number,
							title: issueTitle(file.path),
							body: issueBody(file, drafts),
						}),
					),
				),
			),
	});

export const planGithubFreshnessIssues = (
	input: GithubFreshnessIssueInput,
	openIssues: ReadonlyArray<GithubOpenIssue>,
	advisory: GithubFreshnessIssueAdvisory = {},
): ReadonlyArray<GithubFreshnessIssueAction> =>
	input.files.filter(isCriticalFile).flatMap((file) =>
		Option.match(actionForFile(file, openIssues, advisory.issueBodyDrafts ?? []), {
			onNone: () => [],
			onSome: (action) => [action],
		}),
	);
