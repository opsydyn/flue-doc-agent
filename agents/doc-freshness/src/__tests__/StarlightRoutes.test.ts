import { describe, expect, test } from "bun:test";
import { sourcePathForPage, starlightRouteMap } from "../StarlightRoutes";

describe("Starlight route mapping", () => {
	const routeMap = starlightRouteMap("packages/docs/src/content/docs", [
		"packages/docs/src/content/docs/index.mdx",
		"packages/docs/src/content/docs/decisions/ADR-001-bun-monorepo.md",
		"packages/docs/src/content/docs/diataxis/index.mdx",
		"packages/docs/src/content/docs/reference/example.md",
	]);

	test("maps Starlight page paths to deterministic source files", () => {
		expect(sourcePathForPage(routeMap, "/flue-doc-agent/")).toBe(
			"packages/docs/src/content/docs/index.mdx",
		);
		expect(sourcePathForPage(routeMap, "/flue-doc-agent/decisions/adr-001-bun-monorepo/")).toBe(
			"packages/docs/src/content/docs/decisions/ADR-001-bun-monorepo.md",
		);
		expect(sourcePathForPage(routeMap, "/flue-doc-agent/diataxis")).toBe(
			"packages/docs/src/content/docs/diataxis/index.mdx",
		);
		expect(sourcePathForPage(routeMap, "/flue-doc-agent/reference/example?utm=docs")).toBe(
			"packages/docs/src/content/docs/reference/example.md",
		);
	});

	test("returns n/a when analytics contains a page outside the Starlight docs collection", () => {
		expect(sourcePathForPage(routeMap, "/flue-doc-agent/not-a-doc")).toBe("n/a");
	});
});
