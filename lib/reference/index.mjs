// The generated reference (src/content/docs/reference/): a small framework that knows the packages
// (lib/packages.mjs) and a registry of providers that know one kind of data each.
//
// The framework writes:
//   index.md            overview: the released packages, then the "规划中" table
//   <package>/index.md  one home page per released package: description, documented version, manual,
//                       dependencies, engine plugins, provides, prebuilt binaries, repository,
//                       "相关页面" (written pages that declare the package), then each provider's sections
// and asks every provider for its own pages. The Blueprint provider (./blueprint.mjs) is the only one
// today. A provider is an object:
//
//   {
//     id, label,                        // "blueprint", "蓝图 API" (label: what a package page says it lacks)
//     dataFiles(pkg) -> [paths],        // what it reads per package, relative to data/. The first one is
//                                       // the main file: the provider covers a package when it exists.
//     sidebarLinks({ dataDir }) -> [{ label, link }]   // fixed 参考 entries after 概览 (no data loading)
//     load(ctx) -> instance             // reads its data once; throws on unusable data
//   }
//   instance: engineVersion(pkg), packageMeta(pkg) -> [[label, html]], packageSections(pkg) -> [markdown],
//             packagePages(pkg, emit, { base }), overviewColumns() -> [{ label, cell(pkg) }],
//             overviewIntro() / overviewNotes() -> [markdown], sitePages(emit), nodeCount()
//
// The framework uses dataFiles for coverage, for the "generated from" comment of a package page (the
// files that exist) and in `npm run check` (checkProviderData: a released package without the main
// file is a warning; its page says in one sentence that it has no <label>). The package methods are
// called only for packages the provider covers, and its overview cells show "—" for the others.
// Every instance method is optional. Paths passed to emit() are relative to the reference folder; a
// provider writes package pages under `${pkg.slug}/` only. URLs never contain a version.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { INDEX_FILE, loadPackages, packageLine, packagePath } from "../packages.mjs";
import { contentPages } from "../check.mjs";
import { SECTIONS, pageUrl, sectionOf } from "../content-packages.mjs";
import { blueprintProvider } from "./blueprint.mjs";
import { GENERATED, byName, esc, frontmatter, metaList } from "./common.mjs";

/** Registered providers, in the order their sections appear on a package page. */
export const PROVIDERS = [blueprintProvider];

/** A provider's main data file for a package, relative to data/ ("api/UBotSensor.json"). */
export const mainDataFile = (provider, pkg) => provider.dataFiles(pkg)[0];
/** True when the provider has data for the package: its main data file exists in `dataDir`. */
export const providerCovers = (provider, pkg, dataDir) => existsSync(join(dataDir, mainDataFile(provider, pkg)));

/**
 * `npm run check`: a released package whose main data file of a provider is missing is a warning at
 * its line in data/index.json (a content-only package may have no Blueprint API at all).
 */
export function checkProviderData({ packages, dataDir, indexText = "", providers = PROVIDERS }) {
  const out = [];
  for (const pkg of packages.released()) {
    for (const provider of providers) {
      if (providerCovers(provider, pkg, dataDir)) continue;
      const file = `data/${mainDataFile(provider, pkg)}`;
      out.push({
        severity: "warning",
        file: INDEX_FILE,
        line: packageLine(indexText, pkg.name),
        message: `${pkg.name} is released, but ${file} does not exist: its reference page says it has no ${provider.label}. Fine for a package without one (content only); otherwise add the file (CLAUDE.md, "Adding a new uBot package")`,
      });
    }
  }
  return out;
}

const repoLabel = (url) => url.replace(/^https:\/\//, "");
const engineText = (range) => String(range ?? "").replace(/^[~^=v\s]+/, "");

/** Written pages that declare the package (stubs and placeholders are not listed until they are written). */
function relatedPages(pkg, pages) {
  const sections = [...SECTIONS.map((s) => s.dir), pkg.docsSlug];
  const rank = (p) => {
    const i = sections.indexOf(p.contentRel.split("/")[0]);
    return i < 0 ? sections.length : i;
  };
  return pages
    .filter((p) => p.packages.includes(pkg.name) && !p.stub && p.frontmatter.pageKind !== "placeholder")
    .sort((a, b) => rank(a) - rank(b) || (a.frontmatter.sidebar?.order ?? 999) - (b.frontmatter.sidebar?.order ?? 999) || byName(a.frontmatter.title, b.frontmatter.title));
}

function dependencyLinks(pkg, packages) {
  const reqs = pkg.requires.filter((r) => r.optional !== true);
  if (!reqs.length) return "只依赖引擎";
  return reqs
    .map((r) => {
      const dep = packages.get(r.name);
      const name = dep?.released ? `<a href="${esc(dep.path)}">${esc(r.name)}</a>` : esc(r.name);
      return `${name}${r.version ? ` <code>${esc(r.version)}</code>` : ""}`;
    })
    .join("、");
}

function packageHome(pkg, ctx, loaded, order) {
  const { packages, pages, dataDir } = ctx;
  const coveringProviders = loaded.filter(({ provider }) => providerCovers(provider, pkg, dataDir));
  const covering = coveringProviders.map(({ instance }) => instance);
  const missing = loaded.filter(({ provider }) => !providerCovers(provider, pkg, dataDir)).map(({ provider }) => provider);
  const engine = covering.map((i) => i.engineVersion?.(pkg)).find(Boolean) || engineText(pkg.engine);
  const version = pkg.documentedVersion ? `${esc(pkg.documentedVersion)}${engine ? `（UE ${esc(engine)}）` : ""}` : "—";
  const codes = (items) => (items.length ? items.map((x) => `<code>${esc(x)}</code>`).join("、") : "—");
  const prebuilt = pkg.prebuilt.length ? pkg.prebuilt.map((b) => `UE ${esc(b.engine)} ${esc(b.platform)}`).join("、") : "无，需要从源码编译";
  const repo = pkg.githubUrl || pkg.repository;
  const rows = [
    ["名称", `${esc(pkg.label)} <code>${esc(pkg.name)}</code>`],
    ["手册", `<a href="${esc(pkg.docsPath)}">${esc(pkg.label)} 手册</a>`],
    ["文档版本", version],
    ["依赖", dependencyLinks(pkg, packages)],
    ["引擎插件", codes(pkg.enginePlugins)],
    ["提供", codes(pkg.provides)],
    ["预编译", prebuilt],
    ["仓库", repo ? `<a href="${esc(repo)}">${esc(repoLabel(repo))}</a>` : "—"],
    ...covering.flatMap((i) => i.packageMeta?.(pkg) ?? []),
  ];
  const description = pkg.description("zh-CN");
  const sources = ["data/index.json", ...coveringProviders.flatMap(({ provider }) => provider.dataFiles(pkg).filter((f) => existsSync(join(dataDir, f))).map((f) => `data/${f}`))];
  const parts = [
    frontmatter({ title: pkg.name, description: `${pkg.label} ${pkg.documentedVersion}：${description}`.trim(), label: "概览", order }),
    GENERATED(sources.join(", ")), "",
  ];
  parts.push(metaList(rows), "");
  if (description) parts.push(`<p>${esc(description)}</p>`, "");
  const related = relatedPages(pkg, pages);
  if (related.length) {
    parts.push("## 相关页面 {#pages}", "");
    parts.push(`<table class="ref-table"><thead><tr><th>页面</th><th>说明</th></tr></thead><tbody>${related
      .map((p) => `<tr><td><a href="${esc(pageUrl(p.contentRel))}">${esc(p.frontmatter.title)}</a><span class="ref-sub">${esc(sectionOf(p.contentRel, packages))}</span></td><td class="ref-desc">${esc(p.frontmatter.description ?? "")}</td></tr>`)
      .join("")}</tbody></table>`, "");
  }
  for (const i of covering) parts.push(...(i.packageSections?.(pkg) ?? []));
  for (const p of missing) parts.push(`<p>文档里没有这个插件的${esc(p.label)}：插件可能没有${esc(p.label)}，也可能导出的数据还没有同步到文档。</p>`, "");
  return parts.join("\n");
}

function overviewPage(ctx, loaded) {
  const { packages, dataDir } = ctx;
  const instances = loaded.map(({ instance }) => instance);
  // A column belongs to its provider: packages the provider does not cover show "—".
  const columns = loaded.flatMap(({ provider, instance }) => (instance.overviewColumns?.() ?? []).map((c) => ({ ...c, provider })));
  const cell = (c, p) => (providerCovers(c.provider, p, dataDir) ? c.cell(p) : "—");
  const released = packages.released();
  const rows = released
    .map((p) => `<tr><td><a href="${esc(p.path)}">${esc(p.name)}</a><span class="ref-sub"><a href="${esc(p.docsPath)}">${esc(p.label)} 手册</a></span></td><td>${esc(p.documentedVersion)}</td>${columns.map((c) => `<td>${esc(cell(c, p))}</td>`).join("")}<td class="ref-desc">${esc(p.description("zh-CN"))}</td></tr>`)
    .join("");
  const sources = ["data/index.json", ...released.flatMap((p) => loaded.filter(({ provider }) => providerCovers(provider, p, dataDir)).map(({ provider }) => `data/${mainDataFile(provider, p)}`))];
  const parts = [
    frontmatter({ title: "参考", description: "uBot 插件的类、节点、属性、结构体和枚举，由 UE 反射数据和 uBot 包索引生成。", label: "概览", order: 0 }),
    GENERATED(sources.join(", ")), "",
    ...instances.flatMap((i) => i.overviewIntro?.() ?? []).flatMap((l) => [l, ""]),
    "## 已发布 {#released}", "",
    `<table class="ref-table"><thead><tr><th>插件</th><th>版本</th>${columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}<th>说明</th></tr></thead><tbody>${rows}</tbody></table>`, "",
    ...instances.flatMap((i) => i.overviewNotes?.() ?? []).flatMap((l) => [l, ""]),
  ];
  const planned = packages.planned();
  if (planned.length) {
    const deps = (p) => {
      const list = packages.dependencies(p.name, { transitive: false });
      return list.length ? list.map((n) => (packages.get(n)?.released ? `<a href="${esc(packagePath(n))}">${esc(n)}</a>` : esc(n))).join("、") : "只依赖引擎";
    };
    parts.push("## 规划中 {#planned}", "", "<p>已列入 uBot 包索引、还没有发布的插件。</p>", "");
    parts.push(`<table class="ref-table"><thead><tr><th>名称</th><th>说明</th><th>依赖</th></tr></thead><tbody>${planned
      .map((p) => `<tr><td>${esc(p.name)}<span class="ref-sub"><a href="${esc(p.docsPath)}">${esc(p.label)}</a></span></td><td class="ref-desc">${esc(p.description("zh-CN"))}</td><td>${deps(p)}</td></tr>`)
      .join("")}</tbody></table>`, "");
  }
  return parts.join("\n");
}

/**
 * Regenerates the reference. `dataDir` (default <root>/data) and `outDir` (default
 * <root>/src/content/docs/reference) can point elsewhere; `contentRoot` is the repository whose
 * src/content/docs pages feed "相关指南". Returns { written: [relative paths], nodes }.
 */
export function generateReference({ root, dataDir = join(root, "data"), outDir = join(root, "src", "content", "docs", "reference"), contentRoot = root, providers = PROVIDERS } = {}) {
  const { registry: packages, diagnostics } = loadPackages({ root, dataDir });
  const fatal = diagnostics.filter((d) => d.severity === "error" && d.file.endsWith("index.json"));
  if (fatal.length) throw new Error(`${fatal.map((d) => `${d.file}:${d.line}: error: ${d.message}`).join("\n")}\nthe package index has errors; fix them (npm run check) before generating.`);
  const ctx = { root, dataDir, packages, pages: contentPages(contentRoot, packages) };
  const loaded = providers.map((provider) => ({ provider, instance: provider.load(ctx) }));
  const instances = loaded.map(({ instance }) => instance);

  const written = [];
  const emit = (rel, text) => {
    const abs = join(outDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`, "utf8");
    written.push(rel);
  };

  rmSync(outDir, { recursive: true, force: true });
  emit("index.md", overviewPage(ctx, loaded));
  for (const i of instances) i.sitePages?.(emit);
  packages.released().forEach((pkg, n) => {
    const base = 10 + 100 * n;
    emit(`${pkg.slug}/index.md`, packageHome(pkg, ctx, loaded, base));
    for (const { provider, instance } of loaded) if (providerCovers(provider, pkg, dataDir)) instance.packagePages?.(pkg, emit, { base });
  });
  const nodes = instances.reduce((sum, i) => sum + (i.nodeCount?.() ?? 0), 0);
  return { written, nodes };
}

/**
 * The 参考 section of the sidebar, built from the registry: 概览, the providers' fixed links (节点索引,
 * 引擎节点), then one group per released package by name (autogenerated from its folder, so its
 * pages need no list either).
 */
export function referenceSidebar({ packages, dataDir, providers = PROVIDERS }) {
  const items = [{ label: "概览", link: "/reference/" }];
  for (const p of providers) items.push(...(p.sidebarLinks?.({ dataDir }) ?? []));
  for (const pkg of packages.released()) items.push({ label: pkg.name, collapsed: true, items: [{ autogenerate: { directory: `reference/${pkg.slug}` } }] });
  return { label: "参考", collapsed: true, items };
}
