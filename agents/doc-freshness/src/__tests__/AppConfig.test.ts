import { describe, expect, test } from "bun:test";
import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import { AppConfig, AppConfigLive, type AppConfigShape } from "../config/AppConfig";

const testConfig: AppConfigShape = {
	appEnv: "test",
	openAiApiKey: Redacted.make("sk-test"),
	githubToken: Redacted.make("ghs_test"),
	githubRepository: "opsydyn/flue-doc-agent",
	githubRef: "main",
	githubSha: "abc123",
	oneDollarStatsApiKey: Redacted.make("ods-test"),
	odsSiteId: "site-test",
	publicOdsSiteId: "site-public",
	pageviewThreshold: 7,
	docsBasePath: "/flue-doc-agent",
};

describe("AppConfig", () => {
	test("can be overridden in tests with Layer.succeed", async () => {
		const result = await Effect.service(AppConfig).pipe(
			Effect.map((config) => ({
				appEnv: config.appEnv,
				pageviewThreshold: config.pageviewThreshold,
				openAiApiKey: config.openAiApiKey.toString(),
			})),
			Effect.provide(Layer.succeed(AppConfig, testConfig)),
			Effect.runPromise,
		);

		expect(result).toEqual({
			appEnv: "test",
			pageviewThreshold: 7,
			openAiApiKey: "<redacted>",
		});
	});

	test("loads typed values from an explicit ConfigProvider", async () => {
		const provider = ConfigProvider.fromEnv({
			env: {
				APP_ENV: "production",
				OPENAI_API_KEY: "sk-prod",
				GITHUB_TOKEN: "ghs_prod",
				GITHUB_REPOSITORY: "opsydyn/flue-doc-agent",
				GITHUB_REF_NAME: "main",
				GITHUB_SHA: "def456",
				ONE_DOLLAR_STATS_API_KEY: "ods-prod",
				ODS_SITE_ID: "site-prod",
				PUBLIC_ODS_SITE_ID: "site-prod",
				PAGEVIEW_THRESHOLD: "11",
				DOCS_BASE_PATH: "/flue-doc-agent",
			},
		});

		const config = await Effect.service(AppConfig).pipe(
			Effect.provide(AppConfigLive),
			Effect.provideService(ConfigProvider.ConfigProvider, provider),
			Effect.runPromise,
		);

		expect(config.appEnv).toBe("production");
		expect(config.pageviewThreshold).toBe(11);
		expect(config.openAiApiKey.toString()).toBe("<redacted>");
		expect(config.githubToken.toString()).toBe("<redacted>");
	});
});
