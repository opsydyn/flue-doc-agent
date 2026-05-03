import path from "node:path";
import { Match, Option, Record } from "effect";

export type StarlightRouteMap = Record.ReadonlyRecord<string, string>;

const markdownExtension = /\.(?:md|mdx)$/iu;

const normalizeSlashes = (value: string) => value.replaceAll(path.sep, "/");

const withoutMarkdownExtension = (value: string) => value.replace(markdownExtension, "");

const stripIndexSegment = (route: string) =>
	Match.value(route).pipe(
		Match.when("index", () => ""),
		Match.when(
			(value) => value.endsWith("/index"),
			(value) => value.slice(0, -"/index".length),
		),
		Match.orElse(() => route),
	);

const routeFromSourcePath = (docsRoot: string, filePath: string) =>
	stripIndexSegment(
		withoutMarkdownExtension(normalizeSlashes(path.relative(docsRoot, filePath))).toLowerCase(),
	);

const pageRoute = (page: string, basePath = "/flue-doc-agent") => {
	const cleanPath = page.split(/[?#]/u)[0] ?? "";
	const withoutBase = cleanPath.replace(new RegExp(`^${basePath}/?`, "u"), "");
	return withoutBase.replace(/^\//u, "").replace(/\/$/u, "").toLowerCase();
};

const routeEntry = (docsRoot: string, filePath: string) =>
	[routeFromSourcePath(docsRoot, filePath), normalizeSlashes(filePath)] as const;

export const starlightRouteMap = (
	docsRoot: string,
	files: ReadonlyArray<string>,
): StarlightRouteMap =>
	files.reduce<StarlightRouteMap>((state, filePath) => {
		const [route, sourcePath] = routeEntry(docsRoot, filePath);
		return Record.set(state, route, sourcePath);
	}, Record.empty<string, string>());

export const sourcePathForPage = (
	routes: StarlightRouteMap,
	page: string,
	basePath = "/flue-doc-agent",
) => Option.getOrElse(Record.get(routes, pageRoute(page, basePath)), () => "n/a");
