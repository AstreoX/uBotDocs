// The GitHub repositories of the project, and which one a page of the site belongs to.
//
// The plugin repositories come from the package registry (data/index.json through lib/packages.mjs):
// a released plugin whose `repository` is a GitHub URL is listed, a planned one is not (its repository
// does not exist yet). Two repositories are not in the index and are fixed here: uBot Manager and this
// site. Components (RepositoryOverview, SocialIcons) and the tests read this module; no page lists
// repositories.
//
//   repositoryOverview(registry)                       // rows for the repository overview
//   repositoryForPage("sensor/imu", registry)          // { name, url, label } for the header link
import { parseGitHubRepository } from "./packages.mjs";

/** uBot Manager: the desktop app that installs and updates the plugins. Its manual is /manager/. */
export const MANAGER_REPOSITORY = {
  name: "uBotManager",
  url: "https://github.com/AstreoX/uBotManager",
  description: "安装、更新和管理 uBot 插件的桌面程序。",
  docsPath: "/manager/",
  manualLabel: "手册",
};
export const MANAGER_RELEASES_URL = `${MANAGER_REPOSITORY.url}/releases`;

/** This site: the documentation and the page-to-repository fallback of the header link. */
export const DOCS_REPOSITORY = {
  name: "uBotDocs",
  url: "https://github.com/AstreoX/uBotDocs",
  description: "本站的源码：文档页面、API 数据和构建脚本。",
  docsPath: "/",
  manualLabel: "本站",
};

/** The repository of a released plugin as { name, url }, or null (planned, or not hosted on GitHub). */
function pluginRepository(pkg) {
  if (!pkg?.released || !pkg.githubUrl) return null;
  const gh = parseGitHubRepository(pkg.githubUrl);
  return gh ? { name: gh.repo, url: `https://github.com/${gh.owner}/${gh.repo}` } : null;
}

/**
 * The rows of the repository overview: the released plugins in index order, then uBot Manager and this
 * site. Each row is { kind, name, description, url, docsPath, manualLabel, version }; `version` is the
 * latest released version of a plugin, "" for the others. Planned plugins have no repository yet and
 * are left out.
 */
export function repositoryOverview(registry) {
  const plugins = registry
    .released()
    .map((pkg) => ({ pkg, repo: pluginRepository(pkg) }))
    .filter(({ repo }) => repo)
    .map(({ pkg, repo }) => ({
      kind: "plugin",
      name: repo.name,
      description: pkg.description("zh-CN"),
      url: repo.url,
      docsPath: pkg.docsPath,
      manualLabel: "手册",
      version: pkg.latest?.version ?? "",
    }));
  return [
    ...plugins,
    { kind: "manager", ...MANAGER_REPOSITORY, version: "" },
    { kind: "docs", ...DOCS_REPOSITORY, version: "" },
  ];
}

/** "/Sensor/imu/?x#y", "sensor/imu.mdx" or "sensor/index" -> ["sensor", "imu"] (lower case, no index segment). */
function segmentsOf(page) {
  return String(page ?? "")
    .replace(/[?#].*$/, "")
    .replace(/\.mdx?$/i, "")
    .split("/")
    .filter(Boolean)
    .map((s) => s.toLowerCase())
    .filter((s, i, all) => !(s === "index" && i === all.length - 1));
}

/**
 * The repository the header's GitHub link points at for a page, given its content id ("sensor/imu") or
 * its site path ("/sensor/imu/", without a base path):
 *
 * - the manual of a released plugin (/sensor/...) and its generated reference (/reference/ubotsensor/...)
 *   -> the plugin's repository (the index's `repository`, without ".git");
 * - /manager/... -> uBot Manager;
 * - everything else (home, start, concepts, develop, appendix, the reference index and the node index,
 *   the placeholder of a planned plugin) -> this site's repository.
 *
 * Returns { name, url, label, kind } where `label` is the accessible name of the link. It never
 * returns the owner's profile page.
 */
export function repositoryForPage(page, registry) {
  const [first = "", second = ""] = segmentsOf(page);
  let target = null;
  let kind = "docs";
  if (first === "manager") {
    target = MANAGER_REPOSITORY;
    kind = "manager";
  } else {
    const pkg = first === "reference" ? registry.bySlug(second) : registry.byDocsSlug(first);
    const repo = pluginRepository(pkg);
    if (repo) {
      target = repo;
      kind = "plugin";
    }
  }
  target ??= DOCS_REPOSITORY;
  return { name: target.name, url: target.url, kind, label: `在 GitHub 上查看 ${target.name} 仓库` };
}
