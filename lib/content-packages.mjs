// Which packages a hand-written page is about. A page declares them in its frontmatter:
//
//   packages: [UBotSensor]            # or "UBotSensor@^0.1" with a version range
//
// or inherits the default of the nearest folder whose _group.yml sets `packages:` (guides/sensors/
// _group.yml -> UBotSensor). A page's own list replaces the folder default. The declaration drives
// the "需要" line under the title, the package filter of the search, the "相关指南" list on the
// package's reference page and the dependency rule of `npm run check`.
//
// Pure functions: npm run check, the reference generator and the PageTitle component share them.

/** Folder of a page path relative to src/content/docs ("guides/sensors/imu.mdx" -> "guides/sensors"). */
const dirOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

/**
 * Folder defaults from _group.yml files: Map dir -> packages (array as written). `groups` is
 * [{ dir, meta }] with dir relative to src/content/docs, e.g. "guides/sensors".
 */
export function groupDefaults(groups) {
  const out = new Map();
  for (const { dir, meta } of groups) if (meta && meta.packages !== undefined) out.set(dir.toLowerCase(), meta.packages);
  return out;
}

/**
 * The packages that apply to a page: { specs, source } where source is "page", the folder ("guides/sensors")
 * whose _group.yml gave the default, or null when nothing applies (specs is then []).
 */
export function effectivePackages(rel, frontmatter, defaults) {
  if (frontmatter && frontmatter.packages !== undefined) return { specs: Array.isArray(frontmatter.packages) ? frontmatter.packages : [], source: "page" };
  for (let dir = dirOf(rel); ; dir = dirOf(dir)) {
    const key = dir.toLowerCase();
    if (defaults?.has(key)) {
      const specs = defaults.get(key);
      return { specs: Array.isArray(specs) ? specs : [], source: dir };
    }
    if (!dir) break;
  }
  return { specs: [], source: null };
}

/** URL of a page from its path relative to src/content/docs ("guides/sensors/imu.mdx" -> "/guides/sensors/imu/"). */
export function pageUrl(rel) {
  const bare = rel.replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "").toLowerCase();
  return bare ? `/${bare}/` : "/";
}

/** Sidebar section of a page ("guides/..." -> "指南"). */
export const SECTION_LABELS = { start: "开始", guides: "指南", concepts: "概念" };
export const sectionOf = (rel) => SECTION_LABELS[rel.split("/")[0]] ?? "";
