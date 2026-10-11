// The generated reference (src/content/docs/reference/): a small framework that knows the packages
// (lib/packages.mjs) and a registry of providers that know one kind of data each.
//
// The framework writes:
//   index.md            overview: released packages by layer, then the "规划中" table
//   <package>/index.md  one home page per released package: description, layer, documented version,
//                       dependencies, engine plugins, provides, prebuilt binaries, repository,
//                       "相关指南" (pages that declare the package), then each provider's sections
// and asks every provider for its own pages. The Blueprint provider (./blueprint.mjs) is the only one
// today. A provider is an object:
//
//   {
//     id, label,                        // "blueprint", "蓝图 API"
//     dataFiles(pkg) -> [paths],        // what it reads per package, relative to data/ (documentation)
//     siteDataFiles: [paths],           // what it reads for the whole site
//     sidebarLinks({ dataDir }) -> [{ label, link }]   // fixed 参考 entries after 概览 (no data loading)
//     load(ctx) -> instance             // reads its data once; throws on unusable data
//   }
//   instance: covers(pkg), sources(pkg), engineVersion(pkg), packageMeta(pkg) -> [[label, html]],
//             packageSections(pkg) -> [markdown], packagePages(pkg, emit, { base }),
//             overviewColumns() -> [{ label, cell(pkg) }], overviewIntro() / overviewNotes() -> [markdown],
//             sitePages(emit)
//
// Every method is optional except load. Paths passed to emit() are relative to the reference folder;
// a provider writes package pages under `${pkg.slug}/` only. URLs never contain the layer.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadPackages, packagePath } from "../packages.mjs";
import { contentPages } from "../check.mjs";
import { pageUrl, sectionOf, SECTION_LABELS } from "../content-packages.mjs";
import { blueprintProvider } from "./blueprint.mjs";
import { GENERATED, byName, esc, frontmatter, metaList } from "./common.mjs";

/** Registered providers, in the order their sections appear on a package page. */
export const PROVIDERS = [blueprintProvider];

const repoLabel = (url) => url.replace(/^https:\/\//, "");
const engineText = (range) => String(range ?? "").replace(/^[~^=v\s]+/, "");

function relatedPages(pkg, pages) {
  const sections = Object.keys(SECTION_LABELS);
  const rank = (p) => {
    const i = sections.indexOf(p.contentRel.split("/")[0]);
    return i < 0 ? sections.length : i;
  };
  return pages
    .filter((p) => p.packages.includes(pkg.name))
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

function packageHome(pkg, ctx, instances, order) {
  const { packages, pages } = ctx;
  const covering = instances.filter((i) => i.covers?.(pkg));
  const engine = covering.map((i) => i.engineVersion?.(pkg)).find(Boolean) || engineText(pkg.engine);
  const version = pkg.documentedVersion ? `${esc(pkg.documentedVersion)}${engine ? `（UE ${esc(engine)}）` : ""}` : "—";
  const codes = (items) => (items.length ? items.map((x) => `<code>${esc(x)}</code>`).join("、") : "—");
  const prebuilt = pkg.prebuilt.length ? pkg.prebuilt.map((b) => `UE ${esc(b.engine)} ${esc(b.platform)}`).join("、") : "无，需要从源码编译";
  const repo = pkg.githubUrl || pkg.repository;
  const rows = [
    ["名称", `${esc(pkg.friendlyName)} <code>${esc(pkg.name)}</code>`],
    ["层级", `${esc(pkg.layerLabel || pkg.layer || "—")}${pkg.layerLabel ? `（${esc(pkg.layer)}）` : ""}`],
    ["文档版本", version],
    ["依赖", dependencyLinks(pkg, packages)],
    ["引擎插件", codes(pkg.enginePlugins)],
    ["提供", codes(pkg.provides)],
    ["预编译", prebuilt],
    ["仓库", repo ? `<a href="${esc(repo)}">${esc(repoLabel(repo))}</a>` : "—"],
    ...covering.flatMap((i) => i.packageMeta?.(pkg) ?? []),
  ];
  const description = pkg.description("zh-CN");
  const sources = ["data/index.json", ...covering.flatMap((i) => i.sources?.(pkg) ?? [])];
  const parts = [
    frontmatter({ title: pkg.name, description: `${pkg.friendlyName} ${pkg.documentedVersion}：${description}`.trim(), label: "概览", order }),
    GENERATED(sources.join(", ")), "",
  ];
  parts.push(metaList(rows), "");
  if (description) parts.push(`<p>${esc(description)}</p>`, "");
  const related = relatedPages(pkg, pages);
  if (related.length) {
    parts.push("## 相关指南 {#guides}", "");
    parts.push(`<table class="ref-table"><thead><tr><th>页面</th><th>说明</th></tr></thead><tbody>${related
      .map((p) => `<tr><td><a href="${esc(pageUrl(p.contentRel))}">${esc(p.frontmatter.title)}</a><span class="ref-sub">${esc(sectionOf(p.contentRel))}</span></td><td class="ref-desc">${esc(p.frontmatter.description ?? "")}</td></tr>`)
      .join("")}</tbody></table>`, "");
  }
  for (const i of covering) parts.push(...(i.packageSections?.(pkg) ?? []));
  return parts.join("\n");
}

function overviewPage(ctx, instances) {
  const { packages } = ctx;
  const columns = instances.flatMap((i) => i.overviewColumns?.() ?? []);
  const released = packages.released();
  const rows = released
    .map((p) => `<tr><td><a href="${esc(p.path)}">${esc(p.name)}</a><span class="ref-sub">${esc(p.friendlyName)}</span></td><td>${esc(p.layerLabel || p.layer)}</td><td>${esc(p.documentedVersion)}</td>${columns.map((c) => `<td>${esc(c.cell(p))}</td>`).join("")}<td class="ref-desc">${esc(p.description("zh-CN"))}</td></tr>`)
    .join("");
  const parts = [
    frontmatter({ title: "参考", description: "uBot 插件的类、节点、属性、结构体和枚举，由 UE 反射数据和 uBot 包索引生成。", label: "概览", order: 0 }),
    GENERATED(["data/index.json", "data/api/*.json"].join(", ")), "",
    ...instances.flatMap((i) => i.overviewIntro?.() ?? []).flatMap((l) => [l, ""]),
    "## 已发布 {#released}", "",
    `<table class="ref-table"><thead><tr><th>插件</th><th>层级</th><th>版本</th>${columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}<th>说明</th></tr></thead><tbody>${rows}</tbody></table>`, "",
    ...instances.flatMap((i) => i.overviewNotes?.() ?? []).flatMap((l) => [l, ""]),
  ];
  const planned = packages.planned();
  if (planned.length) {
    const deps = (p) => {
      const list = packages.dependencies(p.name, { transitive: false });
      return list.length ? list.map((n) => (packages.get(n)?.released ? `<a href="${esc(packagePath(n))}">${esc(n)}</a>` : esc(n))).join("、") : "只依赖引擎";
    };
    parts.push("## 规划中 {#planned}", "", "<p>已列入 uBot 包索引、还没有发布的插件。</p>", "");
    parts.push(`<table class="ref-table"><thead><tr><th>名称</th><th>层级</th><th>说明</th><th>依赖</th></tr></thead><tbody>${planned
      .map((p) => `<tr><td>${esc(p.name)}<span class="ref-sub">${esc(p.friendlyName)}</span></td><td>${esc(p.layerLabel || p.layer || "—")}</td><td class="ref-desc">${esc(p.description("zh-CN"))}</td><td>${deps(p)}</td></tr>`)
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
  const instances = providers.map((p) => p.load(ctx));

  const written = [];
  const emit = (rel, text) => {
    const abs = join(outDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text.endsWith("\n") ? text : `${text}\n`, "utf8");
    written.push(rel);
  };

  rmSync(outDir, { recursive: true, force: true });
  emit("index.md", overviewPage(ctx, instances));
  for (const i of instances) i.sitePages?.(emit);
  packages.released().forEach((pkg, n) => {
    const base = 10 + 100 * n;
    emit(`${pkg.slug}/index.md`, packageHome(pkg, ctx, instances, base));
    for (const i of instances) if (i.covers?.(pkg)) i.packagePages?.(pkg, emit, { base });
  });
  const nodes = instances.reduce((sum, i) => sum + (i.nodeCount?.() ?? 0), 0);
  return { written, nodes };
}

/**
 * The 参考 section of the sidebar, built from the registry: 概览, the providers' fixed links (节点索引,
 * 引擎节点), then one group per layer with released packages, each holding one group per package
 * (autogenerated from its folder, so its pages need no list either).
 */
export function referenceSidebar({ packages, dataDir, providers = PROVIDERS }) {
  const items = [{ label: "概览", link: "/reference/" }];
  for (const p of providers) items.push(...(p.sidebarLinks?.({ dataDir }) ?? []));
  for (const { layer, packages: list } of packages.releasedByLayer()) {
    items.push({
      label: layer.label,
      items: list.map((pkg) => ({ label: pkg.name, collapsed: true, items: [{ autogenerate: { directory: `reference/${pkg.slug}` } }] })),
    });
  }
  return { label: "参考", items };
}
