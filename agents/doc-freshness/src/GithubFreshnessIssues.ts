import { Match, Option, Schema } from "effect";
import { freshnessReviewedFileSchema } from "./FreshnessReview";

export const githubFreshnessIssueInputSchema = Schema.Struct({
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

export const githubCreateFreshnessIssueSchema = Schema.Struct({
	_tag: Schema.Literal("CreateGithubFreshnessIssue"),
	title: Schema.String,
	body: Schema.String,
});

export const githubUpdateFreshnessIssueSchema = Schema.Struct({
	_tag: Schema.Literal("UpdateGithubFreshnessIssue"),
	number: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
	title: Schema.String,
	body: Schema.String,
});

export type GithubFreshnessIssueInput = typeof githubFreshnessIssueInputSchema.Type;
export type GithubOpenIssue = typeof githubOpenIssueSchema.Type;
export type GithubFreshnessIssueAction =
	| typeof githubCreateFreshnessIssueSchema.Type
	| typeof githubUpdateFreshnessIssueSchema.Type;

const issueMarker = (path: string) => `<!-- doc-freshness:${path} -->`;

const issueTitle = (path: string) => `Critical doc freshness: ${path}`;

const issueBody = (file: typeof freshnessReviewedFileSchema.Type) => `${issueMarker(file.path)}

## Critical documentation freshness issue

Document: \`${file.path}\`

30-day page views: ${(file.pageViews30d ?? 0).toLocaleString("en-GB")}

Last doc commit: \`${file.lastDocCommit}\`

### Evidence

${file.issues.map((issue) => `- ${issue}`).join("\n") || "- Review the freshness report."}

### Remediation

Update the document so it reflects the referenced source files, then rerun the doc freshness
workflow.`;

const isCriticalFile = (file: typeof freshnessReviewedFileSchema.Type) =>
	file.priority === "critical";

const issueMatchesPath = (path: string, issue: GithubOpenIssue) =>
	(issue.body ?? "").includes(issueMarker(path)) || issue.title === issueTitle(path);

const existingIssueForPath = (path: string, issues: ReadonlyArray<GithubOpenIssue>) =>
	Option.fromNullishOr(issues.find((issue) => issueMatchesPath(path, issue)));

const actionForFile = (
	file: typeof freshnessReviewedFileSchema.Type,
	issues: ReadonlyArray<GithubOpenIssue>,
): Option.Option<GithubFreshnessIssueAction> =>
	Option.match(existingIssueForPath(file.path, issues), {
		onNone: () =>
			Option.some(
				githubCreateFreshnessIssueSchema.make({
					_tag: "CreateGithubFreshnessIssue",
					title: issueTitle(file.path),
					body: issueBody(file),
				}),
			),
		onSome: (issue) =>
			Match.value(issue.body === issueBody(file) && issue.title === issueTitle(file.path)).pipe(
				Match.when(true, () => Option.none<GithubFreshnessIssueAction>()),
				Match.orElse(() =>
					Option.some(
						githubUpdateFreshnessIssueSchema.make({
							_tag: "UpdateGithubFreshnessIssue",
							number: issue.number,
							title: issueTitle(file.path),
							body: issueBody(file),
						}),
					),
				),
			),
	});

export const planGithubFreshnessIssues = (
	input: GithubFreshnessIssueInput,
	openIssues: ReadonlyArray<GithubOpenIssue>,
): ReadonlyArray<GithubFreshnessIssueAction> =>
	input.files.filter(isCriticalFile).flatMap((file) =>
		Option.match(actionForFile(file, openIssues), {
			onNone: () => [],
			onSome: (action) => [action],
		}),
	);
