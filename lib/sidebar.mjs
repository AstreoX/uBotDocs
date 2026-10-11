// The sidebar of the site, built from the package registry (data/index.json) and the fixed sections
// (lib/content-packages.mjs, SECTIONS). Nothing here lists plugins; a new plugin appears by itself.
//
//   开始 -> 核心概念 -> one entry per plugin -> uBot Manager -> 开发者 -> 参考 -> 附录
//
// A released plugin is a group generated from its folder (core/, sensor/, ...: the manual). A planned
// plugin is one link to the placeholder page <folder>/index with the badge "规划中". Released plugins
// come first, then the planned ones, each in the order of the index. The groups carry no layers.
import { SECTIONS } from "./content-packages.mjs";

export const PLANNED_BADGE = { text: "规划中", variant: "caution" };

/** The group of a fixed section, generated from its folder. */
const section = (dir, { collapsed = false } = {}) => {
  const { label } = SECTIONS.find((s) => s.dir === dir);
  return { label, collapsed, items: [{ autogenerate: { directory: dir } }] };
};

/** One sidebar entry per plugin: released first (a group), then planned (a link with a badge). */
export function pluginEntries(packages) {
  return packages.ordered().map((pkg) =>
    pkg.released
      ? { label: pkg.label, collapsed: true, items: [{ autogenerate: { directory: pkg.docsSlug } }] }
      : { label: pkg.label, link: pkg.docsPath, badge: PLANNED_BADGE },
  );
}

/** The whole sidebar; `reference` is the 参考 group (referenceSidebar in lib/reference/index.mjs). */
export function docsSidebar({ packages, reference }) {
  return [
    section("start"),
    section("concepts"),
    ...pluginEntries(packages),
    section("manager", { collapsed: true }),
    section("develop", { collapsed: true }),
    reference,
    section("appendix", { collapsed: true }),
  ];
}
