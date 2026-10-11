// Markdown plugin (mdast stage) that turns ```blueprint code blocks into Blueprint graphs.
//
// Astro 7 renders Markdown and MDX with Sätteri; its mdast plugins are the counterpart of remark
// plugins and run before every hast plugin, including Expressive Code, so the block never reaches
// the code highlighter. The HTML comes from lib/blueprint/render.mjs (the same code the checker and
// the reference generator use).
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { loadSite } from "../../lib/blueprint/site.mjs";
import { compileBlueprint } from "../../lib/blueprint/graph.mjs";
import { renderGraph, renderErrorBox } from "../../lib/blueprint/render.mjs";

// Invalid blocks found during a production build. Throwing from the plugin is enough for .mdx pages,
// but Astro's content loader catches the error of a .md page, logs it and publishes the page empty
// with exit code 0. The plugin therefore also records every error here, and blueprintBuildGate()
// fails the build at the end. The list lives on globalThis so that it is shared even if the config
// loader and the content pipeline load this module twice.
const FAILED = Symbol.for("ubot-docs.blueprint.failed");
const failedBlocks = () => (globalThis[FAILED] ??= []);

/**
 * Line offset of the Markdown body inside its file. For .md pages Astro hands the plugin the text
 * after the frontmatter with leading and trailing blank lines trimmed, so a diagnostic's line is
 * relative to that text; adding this offset gives the line in the file (what `npm run check` and
 * editors show). For .mdx pages Astro keeps the line numbers by blanking the frontmatter in place;
 * that text is not found in the file, so the offset is 0.
 */
export function bodyLineOffset(source, fileURL) {
  try {
    const body = String(source ?? "").replace(/\r\n/g, "\n");
    if (!body.trim()) return 0;
    const full = readFileSync(fileURL, "utf8").replace(/\r\n/g, "\n");
    const at = full.lastIndexOf(body);
    return at <= 0 ? 0 : full.slice(0, at).split("\n").length - 1;
  } catch {
    return 0;
  }
}

/**
 * @param {{ root: string, strict?: boolean }} options  strict: throw on invalid blocks (production
 *   builds); otherwise render a visible error box (dev server).
 */
export function blueprintPlugin({ root, strict = false }) {
  return (ctx) => {
    if (!/^(`{3,}|~{3,})\s*blueprint\b/m.test(ctx.source ?? "")) return null;
    const file = ctx.fileURL ? relative(root, fileURLToPath(ctx.fileURL)).replaceAll("\\", "/") : "";
    const offset = ctx.fileURL ? bodyLineOffset(ctx.source, ctx.fileURL) : 0;
    let count = 0;
    return {
      name: "ubot-blueprint",
      options: { position: true },
      code(node) {
        if (node.lang !== "blueprint") return undefined;
        const site = loadSite(root);
        const startLine = (node.position?.start?.line ?? 0) + offset;
        const { graph, diagnostics } = compileBlueprint(node.value ?? "", site.registry, { startLine, file });
        const errors = diagnostics.filter((d) => d.severity === "error");
        if (errors.length || !graph) {
          const text = errors.map((d) => `${d.file}:${d.line}: ${d.message}`).join("\n");
          if (strict) {
            failedBlocks().push(text);
            throw new Error(`Invalid blueprint block (run npm run check)\n${text}`);
          }
          console.error(text);
          return { raw: renderErrorBox(errors), mdxExpressions: false };
        }
        count++;
        return { raw: renderGraph(graph, { graphId: `bp-${count}`, registry: site.registry, overlay: site.overlay }), mdxExpressions: false };
      },
    };
  };
}

/**
 * Astro integration for production builds: fails `astro build` (exit code 1) when any ```blueprint
 * block was invalid, whatever the page format.
 */
export function blueprintBuildGate() {
  return {
    name: "ubot-blueprint-gate",
    hooks: {
      "astro:build:done": () => {
        const failed = failedBlocks();
        if (!failed.length) return;
        throw new Error(`${failed.length} invalid blueprint block(s); the affected pages were built empty. Run npm run check.\n${failed.join("\n")}`);
      },
    },
  };
}

/**
 * Explicit heading ids in .md files: `### Get Latest IMUData {#GetLatestIMUData}`.
 * Used by the generated reference pages (not available in .mdx, where braces are expressions).
 */
export function headingIdsPlugin() {
  return {
    name: "ubot-heading-ids",
    heading(node) {
      const children = node.children ?? [];
      const last = children[children.length - 1];
      if (!last || last.type !== "text") return undefined;
      const m = /\s*\{#([A-Za-z][\w.:-]*)\}\s*$/.exec(last.value);
      if (!m) return undefined;
      const kept = children.slice(0, -1).map((c) => JSON.parse(JSON.stringify(c)));
      const text = last.value.slice(0, m.index);
      if (text) kept.push({ type: "text", value: text });
      return { type: "heading", depth: node.depth, data: { hProperties: { id: m[1] } }, children: kept };
    },
  };
}
