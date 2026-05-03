import { describe, expect, test } from "bun:test";
import { parseMarkdownDoc } from "../MarkdownDoc";

describe("parseMarkdownDoc", () => {
	test("extracts frontmatter links, Markdown source links, and fenced-code metadata as evidence", () => {
		const doc = parseMarkdownDoc(
			"packages/docs/src/content/docs/guides/example.md",
			[
				"---",
				"title: Example",
				"source: agents/doc-freshness/src/UrlChecker.ts",
				"related:",
				"  - https://example.com/runbook",
				"  - packages/docs/astro.config.mjs",
				"---",
				"",
				"See [reference](../reference/example) and [source](../../../../agents/doc-freshness/src/MarkdownDoc.ts).",
				"",
				"```ts file=packages/docs/src/components/FreshnessPanel.tsx",
				"export const panel = true;",
				"```",
			].join("\n"),
		);

		expect(doc).toEqual({
			_tag: "DocRead",
			path: "packages/docs/src/content/docs/guides/example.md",
			frontmatter: {
				related: "https://example.com/runbook, packages/docs/astro.config.mjs",
				source: "agents/doc-freshness/src/UrlChecker.ts",
				title: "Example",
			},
			body: [
				"",
				"See [reference](../reference/example) and [source](../../../../agents/doc-freshness/src/MarkdownDoc.ts).",
				"",
				"```ts file=packages/docs/src/components/FreshnessPanel.tsx",
				"export const panel = true;",
				"```",
			].join("\n"),
			internalLinks: [
				"../../../../agents/doc-freshness/src/MarkdownDoc.ts",
				"../reference/example",
			],
			externalLinks: ["https://example.com/runbook"],
			codeReferences: [
				"agents/doc-freshness/src/MarkdownDoc.ts",
				"agents/doc-freshness/src/UrlChecker.ts",
				"packages/docs/astro.config.mjs",
				"packages/docs/src/components/FreshnessPanel.tsx",
			],
		});
	});
});
