// @ts-check
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";
import { satteri } from "@astrojs/markdown-satteri";
import { blueprintPlugin, blueprintBuildGate, headingIdsPlugin } from "./src/plugins/blueprint.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

// The public URL is set per deployment (GitHub repository variable SITE_URL). The fallback keeps
// local builds working until the domain exists; `.invalid` can never resolve by accident.
const site = process.env.SITE_URL || "https://ubot-docs.example.invalid";

// Invalid ```blueprint blocks fail `astro build` (.mdx pages at once, .md pages at the end through
// blueprintBuildGate); the dev server shows an error box instead.
const strict = process.argv.includes("build");

export default defineConfig({
  site,
  markdown: {
    processor: satteri({
      mdastPlugins: [blueprintPlugin({ root, strict }), headingIdsPlugin()],
    }),
  },
  integrations: [
    ...(strict ? [blueprintBuildGate()] : []),
    starlight({
      title: "uBot 文档",
      description: "uBot 是一组 Unreal Engine 5.5 插件，用来在 UE 里搭建机器人仿真：传感器、仿真时钟和 ROS 2 桥接。",
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
      sidebar: [
        { label: "开始", items: [{ autogenerate: { directory: "start" } }] },
        { label: "指南", items: [{ autogenerate: { directory: "guides" } }] },
        { label: "概念", items: [{ autogenerate: { directory: "concepts" } }] },
        { label: "参考", items: [{ autogenerate: { directory: "reference" } }] },
      ],
      customCss: ["./src/styles/theme.css", "./src/styles/blueprint.css"],
      components: {
        Head: "./src/components/Head.astro",
      },
      routeMiddleware: "./src/route-middleware.mjs",
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      lastUpdated: false,
      credits: false,
      plugins: [
        starlightLinksValidator({
          errorOnInvalidHashes: true,
          errorOnLocalLinks: true,
        }),
      ],
    }),
  ],
});
