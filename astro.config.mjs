// @ts-check
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";
import { satteri } from "@astrojs/markdown-satteri";
import { blueprintPlugin, blueprintBuildGate, headingIdsPlugin } from "./src/plugins/blueprint.mjs";
import { loadPackages } from "./lib/packages.mjs";
import { referenceSidebar } from "./lib/reference/index.mjs";
import { docsSidebar } from "./lib/sidebar.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const dataDir = fileURLToPath(new URL("./data", import.meta.url));

// The sidebar comes from the package registry (data/index.json), see lib/sidebar.mjs: one entry per
// plugin (a group for a released one, a link with the badge 规划中 for a planned one). The 参考 section
// lists 概览, 节点索引, 引擎节点 and then the released packages by name. A new package needs no edit here.
const packages = loadPackages({ root, dataDir }).registry;
const reference = referenceSidebar({ packages, dataDir });

// The public URL is set per deployment (GitHub repository variable SITE_URL). The fallback keeps
// local builds working until the domain exists; `.invalid` can never resolve by accident.
const site = process.env.SITE_URL || "https://ubot-docs.example.invalid";

// A site served under a path (GitHub Pages: /uBotDocs) sets BASE_PATH. Pages and components link with
// root paths (/sensor/imu/), so such a build skips the link validator (CI validates the root build) and
// scripts/rebase-links.mjs prefixes the links in dist/ and checks them afterwards.
const base = process.env.BASE_PATH ? `/${process.env.BASE_PATH.replace(/^\/+|\/+$/g, "")}` : undefined;

// Invalid ```blueprint blocks fail `astro build` (.mdx pages at once, .md pages at the end through
// blueprintBuildGate); the dev server shows an error box instead.
const strict = process.argv.includes("build");

export default defineConfig({
  site,
  base,
  markdown: {
    processor: satteri({
      mdastPlugins: [blueprintPlugin({ root, strict }), headingIdsPlugin()],
    }),
  },
  integrations: [
    ...(strict ? [blueprintBuildGate()] : []),
    starlight({
      title: "uBot 文档",
      description: "uBot 是一套用 Unreal Engine 搭建具身智能仿真的插件：高质量场景、多种传感器，可接入 ROS 2、MuJoCo、PhysX 等，按需组合，蓝图里就能上手。",
      logo: {
        light: "./src/assets/ubot-mark-dark.svg",
        dark: "./src/assets/ubot-mark-light.svg",
        alt: "uBot",
      },
      favicon: "/favicon.svg",
      // Chinese at the root (no URL prefix). English can be added later as `en: { label: "English",
      // lang: "en" }` under src/content/docs/en/ without changing any existing URL.
      locales: {
        root: { label: "简体中文", lang: "zh-CN" },
      },
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/AstreoX" }],
      // Every group is generated from its folder; page order comes from `sidebar.order` in the
      // frontmatter and nested folder labels from `_group.yml` (see src/route-middleware.mjs).
      sidebar: docsSidebar({ packages, reference }),
      customCss: ["./src/styles/theme.css", "./src/styles/blueprint.css"],
      components: {
        Head: "./src/components/Head.astro",
        // The home page: headline and buttons beside a Blueprint graph.
        Hero: "./src/components/Hero.astro",
        // The "需要：…" line under the title and the Pagefind "package" filter.
        PageTitle: "./src/components/PageTitle.astro",
      },
      routeMiddleware: "./src/route-middleware.mjs",
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      lastUpdated: false,
      credits: false,
      plugins: base
        ? []
        : [
            starlightLinksValidator({
              errorOnInvalidHashes: true,
              errorOnLocalLinks: true,
            }),
          ],
    }),
  ],
});
