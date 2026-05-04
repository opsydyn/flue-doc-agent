import { Config, Context, Effect, Layer, type Redacted } from "effect";

interface GithubActionsConfigShape {
	readonly githubRepository: string;
	readonly githubToken: Redacted.Redacted<string>;
}

export class GithubActionsConfig extends Context.Service<
	GithubActionsConfig,
	GithubActionsConfigShape
>()("GithubActionsConfig") {}

const githubRepository = Config.string("GITHUB_REPOSITORY");

const githubToken = Config.redacted("GH_TOKEN").pipe(
	Config.orElse(() => Config.redacted("GITHUB_TOKEN")),
);

const loadGithubActionsConfig = Effect.gen(function* () {
	const config = yield* Config.all({
		githubRepository,
		githubToken,
	});

	return config satisfies GithubActionsConfigShape;
});

export const GithubActionsConfigLive = Layer.effect(GithubActionsConfig, loadGithubActionsConfig);

export const githubRepositoryParts = (repository: string) => repository.split("/", 2);
