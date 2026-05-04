import { Match, Option, Schema } from "effect";
import { freshnessReviewedFileSchema } from "./FreshnessReview";

const githubActionsAnnotationInputSchema = Schema.Struct({
	files: Schema.Array(freshnessReviewedFileSchema),
});

export const githubActionsAnnotationInputJsonSchema = Schema.fromJsonString(
	githubActionsAnnotationInputSchema,
);

const githubActionsErrorAnnotationSchema = Schema.Struct({
	_tag: Schema.Literal("GithubActionsErrorAnnotation"),
	file: Schema.String,
	title: Schema.String,
	message: Schema.String,
});

const githubActionsWarningAnnotationSchema = Schema.Struct({
	_tag: Schema.Literal("GithubActionsWarningAnnotation"),
	file: Schema.String,
	title: Schema.String,
	message: Schema.String,
});

type GithubActionsAnnotationInput = typeof githubActionsAnnotationInputSchema.Type;
type GithubActionsAnnotation =
	| typeof githubActionsErrorAnnotationSchema.Type
	| typeof githubActionsWarningAnnotationSchema.Type;

const annotationTitle = (file: typeof freshnessReviewedFileSchema.Type) =>
	Match.value(file.priority).pipe(
		Match.when("critical", () => "Critical documentation freshness issue"),
		Match.when("medium", () => "Documentation freshness warning"),
		Match.orElse(() => "Documentation freshness issue"),
	);

const annotationMessage = (file: typeof freshnessReviewedFileSchema.Type) =>
	Match.value(file.issues.length > 0).pipe(
		Match.when(true, () => file.issues.join("; ")),
		Match.orElse(() => "Review the generated documentation freshness report for details."),
	);

const annotationForFreshnessIssue = (
	file: typeof freshnessReviewedFileSchema.Type,
): GithubActionsAnnotation =>
	Match.value(file.priority).pipe(
		Match.when("critical", () =>
			githubActionsErrorAnnotationSchema.make({
				_tag: "GithubActionsErrorAnnotation",
				file: file.path,
				title: annotationTitle(file),
				message: annotationMessage(file),
			}),
		),
		Match.orElse(() =>
			githubActionsWarningAnnotationSchema.make({
				_tag: "GithubActionsWarningAnnotation",
				file: file.path,
				title: annotationTitle(file),
				message: annotationMessage(file),
			}),
		),
	);

const annotationForFile = (file: typeof freshnessReviewedFileSchema.Type) =>
	Match.value(file.status).pipe(
		Match.when("fresh", () => Option.none<GithubActionsAnnotation>()),
		Match.orElse(() => Option.some(annotationForFreshnessIssue(file))),
	);

export const annotationsForFreshness = (
	input: GithubActionsAnnotationInput,
): ReadonlyArray<GithubActionsAnnotation> =>
	input.files.flatMap((file) =>
		Option.match(annotationForFile(file), {
			onNone: () => [],
			onSome: (annotation) => [annotation],
		}),
	);

const escapeCommandData = (value: string) =>
	value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

const escapeCommandProperty = (value: string) =>
	escapeCommandData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");

export const formatGithubActionsAnnotation = (annotation: GithubActionsAnnotation) => {
	const command = Match.value(annotation._tag).pipe(
		Match.when("GithubActionsErrorAnnotation", () => "error"),
		Match.orElse(() => "warning"),
	);

	return `::${command} file=${escapeCommandProperty(annotation.file)},title=${escapeCommandProperty(
		annotation.title,
	)}::${escapeCommandData(annotation.message)}`;
};
