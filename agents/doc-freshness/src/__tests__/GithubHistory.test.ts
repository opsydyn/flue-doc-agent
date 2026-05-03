import { describe, expect, test } from "bun:test";
import {
	fetchGithubHistoryEntries,
	type GitHubHistoryClient,
	type GitHubHistoryCommit,
} from "../GithubHistory";

const commitForPath = (path: string): GitHubHistoryCommit => ({
	sha: `sha-${path}`,
	html_url: `https://github.com/opsydyn/flue-doc-agent/commit/sha-${path}`,
	commit: {
		committer: { date: "2026-05-03T08:00:00Z" },
	},
});

const recordPath = (calls: Array<string>, path: string) => {
	calls.push(path);
	return path;
};

describe("fetchGithubHistoryEntries", () => {
	test("returns one history entry per requested path while looking up each unique path once", async () => {
		const calls: Array<string> = [];
		const client: GitHubHistoryClient = {
			listCommits: async ({ path }) => ({ data: [commitForPath(recordPath(calls, path))] }),
		};

		const histories = await fetchGithubHistoryEntries(client, {
			owner: "opsydyn",
			repo: "flue-doc-agent",
			ref: "main",
			paths: ["docs/a.md", "docs/a.md", "docs/b.md"],
		});

		expect(calls).toEqual(["docs/a.md", "docs/b.md"]);
		expect(histories.map((entry) => entry.path)).toEqual(["docs/a.md", "docs/a.md", "docs/b.md"]);
		expect(histories.map((entry) => entry._tag)).toEqual([
			"CommitFound",
			"CommitFound",
			"CommitFound",
		]);
	});
});
