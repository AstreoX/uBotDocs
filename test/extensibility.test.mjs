// A new package needs data, not code: these tests add a synthetic extra released package ("UBotTestKit",
// depending on the first released package) to a temporary copy of data/ and check that the reference
// generator, the sidebars, the node index, the checks and the "需要" line pick it up.
// What the repository itself lists (released and planned packages) is read from the registry, never
// written down here: it changes with every release.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PROVIDERS, checkProviderData, generateReference, mainDataFile, referenceSidebar } from "../lib/reference/index.mjs";
import { docsSidebar } from "../lib/sidebar.mjs";
import { blueprintProvider } from "../lib/reference/blueprint.mjs";
import { loadPackages, requirementsOf } from "../lib/packages.mjs";
import { loadSite } from "../lib/blueprint/site.mjs";
import { checkContent } from "../lib/check.mjs";
import { editIndex, packageKit, removeDir, repoPackages, root, writeKit } from "./helpers.mjs";

/** The package the synthetic one depends on: the first released package. */
const base = repoPackages().released()[0];
const dependency = { name: base.name, version: `^${base.latest.version}` };

/**
 * A temporary repository root: data/ copied from the repository plus the kit's package and guide
 * folder (`withData: false`: only its index entry, a release without any data/api file).
 */
function syntheticRoot(kit, { withData = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ubot-testkit-"));
  cpSync(join(root, "data"), join(dir, "data"), { recursive: true });
  editIndex(dir, (index) => index.packages.push(kit.indexEntry));
  if (withData) writeKit(dir, kit);
  return dir;
}

const has = (text, fragment) => assert.ok(text.includes(fragment), `expected ${JSON.stringify(fragment)} in:\n${text.slice(0, 400)}`);

test("an extra released package gets its package page, class pages, sidebar group and node index rows from data alone", () => {
  const kit = packageKit("UBotTestKit", { requires: [dependency] });
  const dir = syntheticRoot(kit);
  try {
    const out = join(dir, "out");
    const { written } = generateReference({ root: dir, outDir: out });
    const read = (rel) => readFileSync(join(out, rel), "utf8");
    const registry = loadPackages({ root: dir }).registry;
    const label = registry.get(kit.name).label;

    // package home page: no layer anywhere (the kit's index entry has one), a link to the manual
    assert.ok(written.includes(`${kit.slug}/index.md`));
    const home = read(`${kit.slug}/index.md`);
    assert.match(home, /^title: "UBotTestKit"$/m);
    assert.doesNotMatch(home, /层级|Capability/);
    has(home, `<dt>手册</dt><dd><a href="/${kit.docsSlug}/">${label} 手册</a></dd>`);
    has(home, "<dt>文档版本</dt><dd>0.1.0（UE 5.5）</dd>");
    has(home, `<dt>依赖</dt><dd><a href="${base.path}">${base.name}</a> <code>${dependency.version}</code></dd>`);
    has(home, "<dt>提供</dt><dd><code>Test.Ping</code></dd>");
    has(home, "<dt>预编译</dt><dd>无，需要从源码编译</dd>");
    has(home, '<a href="https://github.com/AstreoX/uBotTestKit">github.com/AstreoX/uBotTestKit</a>');
    assert.match(home, /## 相关页面 \{#pages\}/);
    has(home, `<a href="/${kit.docsSlug}/ping/">发一次 Ping</a>`); // the page declares the package through its folder
    has(home, `<a href="/${kit.docsSlug}/">${kit.friendlyName} 概述</a><span class="ref-sub">${label} 手册</span>`);
    assert.match(home, /## 类 \{#classes\}/);
    has(home, `href="/reference/${kit.slug}/${kit.class.toLowerCase()}/"`);

    // class page and node index
    assert.match(read(`${kit.slug}/${kit.class.toLowerCase()}.md`), /^### Ping \{#Ping\}$/m);
    const nodes = read("nodes.md");
    has(nodes, `<option value="${kit.name}">${kit.name}</option>`);
    has(nodes, `data-package="${kit.name}"><td><span class="ref-kind"`);
    has(nodes, `<a href="/reference/${kit.slug}/${kit.class.toLowerCase()}/#Ping">Ping</a>`);

    // overview: the package is in the released table (1 class, 1 node); planned ones stay in the planned table
    const overview = read("index.md");
    has(overview, `<a href="/reference/${kit.slug}/">${kit.name}</a><span class="ref-sub"><a href="/${kit.docsSlug}/">${label} 手册</a></span></td><td>0.1.0</td><td>1</td><td>1</td>`);
    assert.doesNotMatch(overview, /层级|Capability/, "the overview shows no layer");
    const planned = registry.planned();
    if (planned.length) {
      assert.match(overview, /## 规划中 \{#planned\}/);
      for (const p of planned) {
        has(overview, `<td>${p.name}<span class="ref-sub"><a href="${p.docsPath}">${p.label}</a></span></td>`);
        assert.ok(!written.some((f) => f.startsWith(`${p.slug}/`)), `${p.name} is planned: it has no page`);
      }
    } else assert.doesNotMatch(overview, /规划中/);

    // sidebars: 参考 lists the released packages by name, each autogenerated from its folder, no layer groups;
    // the main sidebar gets a group for the package's manual (autogenerated from its docs folder)
    const dataDir = join(dir, "data");
    const sidebar = referenceSidebar({ packages: registry, dataDir });
    const fixed = 1 + PROVIDERS.flatMap((p) => p.sidebarLinks({ dataDir })).length;
    assert.equal(sidebar.items[0].label, "概览");
    assert.deepEqual(sidebar.items.slice(fixed).map((i) => i.label), registry.released().map((p) => p.name), "packages by name, in index order");
    assert.deepEqual(sidebar.items.find((i) => i.label === kit.name).items, [{ autogenerate: { directory: `reference/${kit.slug}` } }]);
    const main = docsSidebar({ packages: registry, reference: sidebar });
    assert.deepEqual(main.find((i) => i.label === label).items, [{ autogenerate: { directory: kit.docsSlug } }]);

    // checks: the guide passes; the "需要" line names the package and its dependency
    const findings = checkContent(dir, loadSite(dir).registry, { packages: registry });
    assert.deepEqual(findings.filter((f) => f.severity === "error"), []);
    const req = requirementsOf([kit.name], registry);
    assert.deepEqual(req.declared.map((d) => `${d.label} ${d.version} ${d.href}`), [`${label} 0.1.x /reference/${kit.slug}/`]);
    assert.ok(req.dependencies.map((d) => d.name).includes(base.name), "the dependency is named");
  } finally {
    removeDir(dir);
  }
});

test("a released package without data/api/<Name>.json: a check warning, and its page says it has no Blueprint API", () => {
  const kit = packageKit("UBotContentOnly", { requires: [dependency] });
  const dir = syntheticRoot(kit, { withData: false });
  try {
    const out = join(dir, "out");
    const { written } = generateReference({ root: dir, outDir: out });
    const { registry, text } = loadPackages({ root: dir });
    assert.ok(registry.get(kit.name).released && !registry.get(kit.name).hasApi);

    // npm run check: a warning at the package's line in data/index.json, not an error
    const findings = checkProviderData({ packages: registry, dataDir: join(dir, "data"), indexText: text });
    assert.deepEqual(findings.map((f) => `${f.file}:${f.line}: ${f.severity}`), [`data/index.json:${text.split("\n").findIndex((l) => l.includes(`"name": "${kit.name}"`)) + 1}: warning`]);
    assert.match(findings[0].message, new RegExp(`${kit.name} is released, but data/api/${kit.name}\\.json does not exist: its reference page says it has no 蓝图 API`));

    // the package page: index facts and one sentence instead of empty class tables; no class pages
    const home = readFileSync(join(out, kit.slug, "index.md"), "utf8");
    has(home, "<dt>文档版本</dt><dd>0.1.0（UE 5.5）</dd>");
    has(home, "<p>文档里没有这个插件的蓝图 API：插件可能没有蓝图 API，也可能导出的数据还没有同步到文档。</p>");
    assert.doesNotMatch(home, /## (类|结构体|枚举) /);
    assert.doesNotMatch(home, /<dt>模块<\/dt>/);
    assert.deepEqual(written.filter((f) => f.startsWith(`${kit.slug}/`)), [`${kit.slug}/index.md`]);
    assert.match(home, /Generated by scripts\/gen-reference\.mjs from data\/index\.json\. /, "generated from the index only");

    // the overview: no "0 classes" for it, a dash in the provider's columns
    has(readFileSync(join(out, "index.md"), "utf8"), `<a href="/reference/${kit.slug}/">${kit.name}</a><span class="ref-sub"><a href="/${kit.docsSlug}/">${registry.get(kit.name).label} 手册</a></span></td><td>0.1.0</td><td>—</td><td>—</td>`);

    // the repository's own released packages with data are not reported
    assert.ok(registry.released().filter((p) => p.hasApi).every((p) => !findings.some((f) => f.message.startsWith(`${p.name} `))));
  } finally {
    removeDir(dir);
  }
});

test("scripts/gen-reference.mjs takes another data folder (--data/--out)", () => {
  const kit = packageKit("UBotTestKit", { requires: [dependency] });
  const dir = syntheticRoot(kit);
  try {
    const out = join(dir, "out-cli");
    const log = execFileSync(process.execPath, [join(root, "scripts", "gen-reference.mjs"), "--data", join(dir, "data"), "--out", out], { encoding: "utf8" });
    assert.match(log, /wrote \d+ files/);
    assert.ok(existsSync(join(out, kit.slug, "index.md")));
    assert.ok(existsSync(join(out, kit.slug, `${kit.class.toLowerCase()}.md`)));
  } finally {
    removeDir(dir);
  }
});

test("the provider registry: every provider declares its data and sidebar entries", () => {
  const ids = PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "provider ids are unique");
  assert.ok(ids.includes("blueprint"));
  for (const p of PROVIDERS) {
    assert.equal(typeof p.load, "function", `${p.id}.load`);
    assert.ok(typeof p.label === "string" && p.label, `${p.id}.label`);
    const files = p.dataFiles({ name: "UBotSample" });
    assert.ok(Array.isArray(files) && files.length && files.every((f) => typeof f === "string" && !f.startsWith("/") && !f.startsWith("data/")), `${p.id}.dataFiles: paths relative to data/, the main file first`);
  }
  assert.deepEqual(blueprintProvider.dataFiles({ name: "UBotSample" }), ["api/UBotSample.json", "zh/UBotSample/"]);
  assert.equal(mainDataFile(blueprintProvider, { name: "UBotSample" }), "api/UBotSample.json", "the file sync-api writes and check looks for");
  assert.deepEqual(blueprintProvider.sidebarLinks({ dataDir: join(root, "data") }).map((l) => l.link), ["/reference/nodes/", "/reference/engine/"]);
  const empty = mkdtempSync(join(tmpdir(), "ubot-empty-"));
  try {
    assert.deepEqual(blueprintProvider.sidebarLinks({ dataDir: empty }).map((l) => l.link), ["/reference/nodes/"], "no engine page without data/api/engine.json");
  } finally {
    removeDir(empty);
  }
});

test("a second provider plugs into the framework: its sections, pages, columns and site pages appear", () => {
  const dir = mkdtempSync(join(tmpdir(), "ubot-provider-"));
  const data = mkdtempSync(join(tmpdir(), "ubot-provider-data-"));
  const pages = mkdtempSync(join(tmpdir(), "ubot-pages-")); // an empty content root: this test must not read the live src/content/docs
  try {
    const registry = repoPackages();
    const released = registry.released().filter((p) => p.hasApi);
    const covered = released.at(-1);
    const other = released[0];
    assert.notEqual(covered.name, other.name, "needs two released packages with API data");
    // the fake provider covers the packages whose data/fake/<Name>.json exists: only `covered`
    cpSync(join(root, "data"), data, { recursive: true });
    mkdirSync(join(data, "fake"));
    writeFileSync(join(data, "fake", `${covered.name}.json`), "{}");
    const seen = [];
    const fake = {
      id: "fake",
      label: "示例数据",
      dataFiles: (pkg) => [`fake/${pkg.name}.json`],
      sidebarLinks: () => [{ label: "示例索引", link: "/reference/fake/" }],
      load(ctx) {
        seen.push(ctx.packages.released().length);
        return {
          packageMeta: () => [["示例", "是"]],
          packageSections: () => ["## 示例 {#fake}", "", "示例内容。", ""],
          packagePages: (pkg, emit) => emit(`${pkg.slug}/fake/one.md`, "---\ntitle: one\n---\n"),
          overviewColumns: () => [{ label: "示例", cell: (pkg) => (pkg.name === covered.name ? "1" : "0") }],
          sitePages: (emit) => emit("fake.md", "---\ntitle: fake\n---\n"),
        };
      },
    };
    generateReference({ root, dataDir: data, outDir: dir, contentRoot: pages, providers: [blueprintProvider, fake] });
    assert.deepEqual(seen, [registry.released().length]);
    const page = readFileSync(join(dir, covered.slug, "index.md"), "utf8");
    const zh = existsSync(join(data, "zh", covered.name)) ? `data/zh/${covered.name}/, ` : "";
    has(page, `from data/index.json, data/api/${covered.name}.json, ${zh}data/fake/${covered.name}.json.`); // the declared data files that exist
    has(page, "<dt>示例</dt><dd>是</dd>");
    assert.ok(page.indexOf("## 类 {#classes}") < page.indexOf("## 示例 {#fake}"), "sections in provider order");
    const otherPage = readFileSync(join(dir, other.slug, "index.md"), "utf8");
    assert.doesNotMatch(otherPage, /## 示例/, "only packages the provider covers");
    has(otherPage, "<p>文档里没有这个插件的示例数据：插件可能没有示例数据，也可能导出的数据还没有同步到文档。</p>");
    assert.ok(existsSync(join(dir, covered.slug, "fake", "one.md")));
    assert.ok(!existsSync(join(dir, other.slug, "fake")));
    assert.ok(existsSync(join(dir, "fake.md")));
    const overview = readFileSync(join(dir, "index.md"), "utf8");
    assert.match(overview, /<th>类<\/th><th>节点<\/th><th>示例<\/th>/);
    has(overview, `<a href="${covered.path}">${covered.name}</a>`);
    assert.match(overview, new RegExp(`<a href="${other.path}">${other.name}</a>.*?<td>\\d+</td><td>\\d+</td><td>—</td>`), "an uncovered package shows a dash in the provider's column");
    const findings = checkProviderData({ packages: registry, dataDir: data, providers: [blueprintProvider, fake] });
    assert.deepEqual(findings.filter((f) => f.message.includes(" data/fake/")).map((f) => f.message.split(" ")[0]), registry.released().filter((p) => p.name !== covered.name).map((p) => p.name), "check: every other released package lacks data/fake/<Name>.json");
    const sidebar = referenceSidebar({ packages: registry, dataDir: join(root, "data"), providers: [blueprintProvider, fake] });
    assert.deepEqual(sidebar.items.slice(0, 4).map((i) => i.label), ["概览", "节点索引", "引擎节点", "示例索引"]);
  } finally {
    removeDir(dir);
    removeDir(data);
    removeDir(pages);
  }
});
