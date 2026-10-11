// Which packages a hand-written page is about. A page declares them in its frontmatter:
//
//   packages: [UBotSensor]            # or "UBotSensor@^0.1" with a version range
//
// or inherits the default of the nearest folder whose _group.yml sets `packages:` (sensor/_group.yml
// -> UBotSensor). A page's own list replaces the folder default. The declaration drives the "需要"
// line under the title, the package filter of the search ("插件"), the "相关页面" list on the
// package's reference page and the dependency rule of `npm run check`.
//
// Pure functions: npm run check, the reference generator and the PageTitle component share them.

/** Folder of a page path relative to src/content/docs ("sensor/imu.mdx" -> "sensor"). */
const dirOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

/**
 * Folder defaults from _group.yml files: Map dir -> packages (array as written). `groups` is
 * [{ dir, meta }] with dir relative to src/content/docs, e.g. "sensor".
 */
export function groupDefaults(groups) {
  const out = new Map();
  for (const { dir, meta } of groups) if (meta && meta.packages !== undefined) out.set(dir.toLowerCase(), meta.packages);
  return out;
}

/**
 * The packages that apply to a page: { specs, source } where source is "page", the folder ("sensor")
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

/**
 * Name of the Pagefind filter that narrows the search to one package. The search UI shows filter
 * names as they are, so it is Chinese like the rest of the UI; the values are package names.
 */
export const PACKAGE_FILTER = "插件";

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The "需要" line under a page title as HTML, from requirementsOf() (lib/packages.mjs), or "" when the
 * page declares nothing: "需要：uBotVehicles 0.1.x（含依赖 uBotCore），并启用引擎插件 ChaosVehiclesPlugin".
 * Declared packages carry the search filter; packages link to their reference page when released.
 */
export function requiresLine({ declared = [], dependencies = [], enginePlugins = [] }) {
  if (!declared.length) return "";
  const name = (d, filter) => {
    const attr = filter ? ` data-pagefind-filter="${escHtml(`${PACKAGE_FILTER}:${d.name}`)}"` : "";
    const text = escHtml(d.label ?? d.friendlyName);
    return d.href ? `<a href="${escHtml(d.href)}"${attr}>${text}</a>` : `<span${attr}>${text}</span>`;
  };
  const main = declared.map((d) => `${name(d, true)}${d.version ? ` ${escHtml(d.version)}` : ""}`).join("、");
  const deps = dependencies.length ? `（含依赖 ${dependencies.map((d) => name(d, false)).join("、")}）` : "";
  const engine = enginePlugins.length ? `，并启用引擎插件 ${enginePlugins.map(escHtml).join("、")}` : "";
  return `需要：${main}${deps}${engine}`;
}

/** URL of a page from its path relative to src/content/docs ("sensor/imu.mdx" -> "/sensor/imu/"). */
export function pageUrl(rel) {
  const bare = rel.replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "").toLowerCase();
  return bare ? `/${bare}/` : "/";
}

/**
 * The fixed sections of the site, in sidebar order: the folder under src/content/docs and the sidebar
 * group. Every released plugin adds its own group after 核心概念 and every planned plugin one link
 * (lib/sidebar.mjs); the generated 参考 comes after 开发者. A plugin's docs folder may not be one of
 * these (validateIndex).
 */
export const SECTIONS = [
  { dir: "start", label: "开始" },
  { dir: "concepts", label: "核心概念" },
  { dir: "manager", label: "uBot Manager" },
  { dir: "develop", label: "开发者" },
  { dir: "appendix", label: "附录" },
];
/** Top-level folders a package's docs folder may not use: the fixed sections and the generated reference. */
export const SITE_FOLDERS = [...SECTIONS.map((s) => s.dir), "reference"];

/** Section label of a page ("sensor/imu.mdx" -> "uBotSensor 手册"); `packages` is the registry. */
export function sectionOf(rel, packages = null) {
  const first = rel.split("/")[0];
  const fixed = SECTIONS.find((s) => s.dir === first);
  if (fixed) return fixed.label;
  const pkg = packages?.byDocsSlug(first);
  return pkg ? `${pkg.label} 手册` : "";
}

/** Page kinds (frontmatter `pageKind`), the structure of each is in docs-templates/. */
export const PAGE_KINDS = ["overview", "feature", "concept", "guide", "settings", "faq", "placeholder"];
