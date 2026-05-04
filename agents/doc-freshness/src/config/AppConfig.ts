import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect";

type AppEnv = "development" | "preview" | "production" | "test";

export interface AppConfigShape {
	readonly appEnv: AppEnv;
	readonly openAiApiKey: Redacted.Redacted<string>;
	readonly githubToken: Redacted.Redacted<string>;
	readonly githubRepository: string;
	readonly githubRef: string;
	readonly githubSha: string;
	readonly oneDollarStatsApiKey: Redacted.Redacted<string>;
	readonly odsSiteId: string;
	readonly publicOdsSiteId: string;
	readonly pageviewThreshold: number;
	readonly docsBasePath: string;
}

export class AppConfig extends Context.Service<AppConfig, AppConfigShape>()("AppConfig") {}

const appEnv = Config.schema(
	Schema.Literals(["development", "preview", "production", "test"]),
	"APP_ENV",
).pipe(Config.withDefault("development"));

const openAiApiKey = Config.redacted("OPENAI_API_KEY");
const oneDollarStatsApiKey = Config.redacted("ONE_DOLLAR_STATS_API_KEY");

const githubToken = Config.option(
	Config.redacted("GH_TOKEN").pipe(Config.orElse(() => Config.redacted("GITHUB_TOKEN"))),
).pipe(Config.map(Option.getOrElse(() => Redacted.make("", { label: "GITHUB_TOKEN" }))));

const githubRepository = Config.string("GITHUB_REPOSITORY").pipe(Config.withDefault(""));
const githubRef = Config.string("GITHUB_REF_NAME").pipe(Config.withDefault("main"));
const githubSha = Config.string("GITHUB_SHA").pipe(Config.withDefault(""));
const odsSiteId = Config.string("ODS_SITE_ID");
const publicOdsSiteId = Config.string("PUBLIC_ODS_SITE_ID").pipe(Config.withDefault(""));
const pageviewThreshold = Config.int("PAGEVIEW_THRESHOLD").pipe(Config.withDefault(50));
const docsBasePath = Config.string("DOCS_BASE_PATH").pipe(Config.withDefault("/flue-doc-agent"));

const loadAppConfig = Effect.gen(function* () {
	const config = yield* Config.all({
		appEnv,
		openAiApiKey,
		githubToken,
		githubRepository,
		githubRef,
		githubSha,
		oneDollarStatsApiKey,
		odsSiteId,
		publicOdsSiteId,
		pageviewThreshold,
		docsBasePath,
	});

	return config satisfies AppConfigShape;
});

export const AppConfigLive = Layer.effect(AppConfig, loadAppConfig);
