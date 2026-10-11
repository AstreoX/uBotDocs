// The sidebar (lib/sidebar.mjs) comes from the package registry: one entry per plugin, released ones
// first, then the planned ones with the badge 规划中, no layers anywhere. Which packages are released
// or planned is read from the registry, never written down here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { referenceSidebar } from "../lib/reference/index.mjs";
import { PLANNED_BADGE, docsSidebar, pluginEntries } from "../lib/sidebar.mjs";
import { SECTIONS } from "../lib/content-packages.mjs";
import { splitPage } from "../lib/check.mjs";
import { createPackageRegistry } from "../lib/packages.mjs";
import { repoPackages, root } from "./helpers.mjs";

const registry = repoPackages();
const dataDir = join(root, "data");
const sidebar = docsSidebar({ packages: registry, reference: referenceSidebar({ packages: registry, dataDir }) });
const dir = (name) => SECTIONS.find((s) => s.dir === name).label;

test("the order is 开始, 核心概念, one entry per plugin, uBot Manager, 开发者, 参考, 附录", () => {
  const plugins = registry.ordered().map((p) => p.label);
  assert.deepEqual(sidebar.map((i) => i.label), [dir("start"), dir("concepts"), ...plugins, dir("manager"), dir("develop"), "参考", dir("appendix")]);
  assert.deepEqual(SECTIONS.map((s) => s.label), ["开始", "核心概念", "uBot Manager", "开发者", "附录"]);
});

test("released plugins come first (a group generated from the folder), then planned ones (a link with the badge 规划中)", () => {
  const entries = pluginEntries(registry);
  const released = registry.released();
  const planned = registry.planned();
  assert.deepEqual(entries.slice(0, released.length).map((e) => e.label), released.map((p) => p.label), "released first, in index order");
  assert.deepEqual(entries.slice(released.length).map((e) => e.label), planned.map((p) => p.label), "then the planned ones, in index order");
  for (const p of released) {
    const entry = entries.find((e) => e.label === p.label);
    assert.deepEqual(entry.items, [{ autogenerate: { directory: p.docsSlug } }], `${p.name}: its manual is generated from ${p.docsSlug}/`);
    assert.equal(entry.link, undefined);
  }
  for (const p of planned) {
    const entry = entries.find((e) => e.label === p.label);
    assert.deepEqual(entry, { label: p.label, link: `/${p.docsSlug}/`, badge: PLANNED_BADGE }, `${p.name}: one link to its placeholder page`);
    assert.equal(entry.badge.text, "规划中");
  }
});

test("the sidebar knows no layers, and 参考 lists the released packages by name", () => {
  assert.doesNotMatch(JSON.stringify(sidebar), /基础|能力|适配|内容|Foundation|Capability|Adapter|Content|layer/i);
  const reference = sidebar.find((i) => i.label === "参考");
  const groups = reference.items.filter((i) => i.items);
  assert.deepEqual(groups.map((g) => g.label), registry.released().map((p) => p.name));
  for (const g of groups) assert.ok(g.items.every((x) => x.autogenerate), "no nested layer groups: package groups only");
});

test("every plugin has its folder with an index page: an overview when released, a placeholder when planned", () => {
  for (const p of registry.list()) {
    const index = join(root, "src", "content", "docs", p.docsSlug, "index.mdx");
    assert.ok(existsSync(index), `${p.name}: src/content/docs/${p.docsSlug}/index.mdx (the link of the sidebar and of the dependency graph)`);
    const kind = splitPage(readFileSync(index, "utf8")).frontmatter.pageKind;
    if (!p.released) assert.equal(kind, "placeholder", `${p.name} is planned: its page is a placeholder`);
    // a released plugin whose page is still the placeholder is a warning of npm run check, not a failure here:
    // the sync bot releases packages by changing data only
  }
});

test("a new plugin appears by itself: released it is a group, planned it is a badge link", () => {
  const { index } = registry;
  const entry = (name, planned) => ({ name, description: { en: name }, repository: `https://github.com/AstreoX/${name}.git`, versions: [{ version: "0.1.0", ...(planned ? { planned: true } : { ref: "v0.1.0" }), requires: [], enginePlugins: [], provides: [] }] });
  const world = createPackageRegistry({ ...index, packages: [...index.packages, entry("UBotAlphaTest", false), entry("UBotBetaTest", true)] });
  const entries = pluginEntries(world);
  const alpha = entries.find((e) => e.label === "uBotAlphaTest");
  const beta = entries.find((e) => e.label === "uBotBetaTest");
  assert.deepEqual(alpha.items, [{ autogenerate: { directory: "alphatest" } }]);
  assert.deepEqual(beta, { label: "uBotBetaTest", link: "/betatest/", badge: PLANNED_BADGE });
  assert.ok(entries.indexOf(alpha) < world.released().length, "released: among the first");
  assert.equal(entries.indexOf(beta), entries.length - 1, "the new planned package comes last, as the index lists it last");
});
