// Chinese summaries for API items: data/zh/<Package>/<Owner>.yaml, one file per class, struct or enum
// (engine nodes: data/zh/Engine/<Owner>.yaml). Nodes and properties live in their owner's file, so
// parallel sessions that describe different classes never edit the same file.
//
//   data/zh/UBotSensor/UUBotImuSensorComponent.yaml
//     UUBotImuSensorComponent.GetLatestIMUData:
//       summary: 读取组件缓存的最近一次 IMU 采样，不会触发新的采样。
//       sourceHash: 1a2b3c4d5e6f      # sourceHash(English tooltip) when the summary was written
//
// A summary is used only while its sourceHash matches the current English tooltip; otherwise the
// site shows the English tooltip and `npm run check` warns that the summary is stale. The owner of
// an id is ApiRegistry.describableIds()[id].owner; `npm run zh -- where <id>` prints the file.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseDocument, LineCounter, isMap, isScalar } from "yaml";

export const ZH_DIR = "data/zh";

export function sourceHash(text) {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex").slice(0, 12);
}

/** Path (relative to the repository) of the file that holds the summary of a describable item. */
export function zhFileFor(target) {
  return `${ZH_DIR}/${target.plugin}/${target.owner}.yaml`;
}

export class ZhOverlay {
  constructor() {
    /** id -> { summary, sourceHash, file, line } */
    this.entries = new Map();
  }

  /** { text, lang: "zh" | "en", stale } for an id and its current English tooltip. */
  summary(id, englishTooltip) {
    const e = this.entries.get(id);
    const en = englishTooltip ?? "";
    if (e && e.sourceHash === sourceHash(en)) return { text: e.summary, lang: "zh", stale: false };
    return { text: en, lang: "en", stale: Boolean(e) };
  }
}

const isYaml = (f) => /\.ya?ml$/.test(f);

/**
 * Loads data/zh/<Folder>/*.yaml and checks every entry against the registry. `folders` (optional) is
 * the set of folder names that may exist: the package names of data/index.json plus "Engine".
 */
export function loadZh(dir, registry, { root = process.cwd(), folders = null } = {}) {
  const overlay = new ZhOverlay();
  const diagnostics = [];
  if (!existsSync(dir)) return { overlay, diagnostics };
  const describable = registry.describableIds();
  const rel = (abs) => relative(root, abs).replaceAll("\\", "/");

  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      if (folders && !folders.has(name)) {
        diagnostics.push({ severity: "error", file: `${rel(abs)}/`, line: 1, message: `${name} is not a package in data/index.json (or Engine); summaries go to data/zh/<Package>/<Owner>.yaml` });
      }
      for (const f of readdirSync(abs).sort()) {
        const fabs = join(abs, f);
        if (statSync(fabs).isDirectory()) diagnostics.push({ severity: "error", file: `${rel(fabs)}/`, line: 1, message: "nested folders are not read; put the file directly in data/zh/<Package>/" });
        else if (isYaml(f)) files.push({ abs: fabs, folder: name, base: f.replace(/\.ya?ml$/, "") });
        else if (f !== ".gitkeep") diagnostics.push({ severity: "warning", file: rel(fabs), line: 1, message: "not a .yaml file; data/zh holds <Owner>.yaml files only" });
      }
    } else if (isYaml(name)) {
      diagnostics.push({ severity: "error", file: rel(abs), line: 1, message: "summaries live in data/zh/<Package>/<Owner>.yaml, one file per class, struct or enum; move these entries (npm run zh -- where <id> prints the file of an id)" });
      files.push({ abs, folder: null, base: null });
    } else if (name !== ".gitkeep") {
      diagnostics.push({ severity: "warning", file: rel(abs), line: 1, message: "unexpected file in data/zh" });
    }
  }

  for (const { abs, folder, base } of files) {
    const file = rel(abs);
    const text = readFileSync(abs, "utf8");
    const lc = new LineCounter();
    const doc = parseDocument(text, { lineCounter: lc });
    const lineAt = (node) => (node?.range ? lc.linePos(node.range[0]).line : 1);
    for (const err of doc.errors) diagnostics.push({ severity: "error", file, line: lc.linePos(err.pos[0]).line, message: `YAML: ${err.message.split("\n")[0]}` });
    if (doc.errors.length) continue;
    if (doc.contents == null) {
      diagnostics.push({ severity: "warning", file, line: 1, message: "empty file; delete it" });
      continue;
    }
    if (!isMap(doc.contents)) {
      diagnostics.push({ severity: "error", file, line: 1, message: "top level must be a mapping of id -> { summary, sourceHash }" });
      continue;
    }
    for (const pair of doc.contents.items) {
      const id = isScalar(pair.key) ? String(pair.key.value) : "";
      const line = lineAt(pair.key);
      const value = pair.value;
      const target = describable.get(id);
      if (!target) {
        diagnostics.push({ severity: "error", file, line, message: `"${id}" is not an id in data/api (renamed or removed?); delete or rename this entry` });
        continue;
      }
      if (folder !== null && (folder !== target.plugin || base !== target.owner)) {
        diagnostics.push({ severity: "error", file, line, message: `"${id}" belongs in ${zhFileFor(target)} (one file per class, struct or enum); move the entry there` });
      }
      const obj = isMap(value) ? value.toJSON() : null;
      // A hash such as 000000000000 or 12e456789012 would load as a number; use the source text.
      const hashNode = isMap(value) ? value.get("sourceHash", true) : null;
      if (obj && isScalar(hashNode) && typeof hashNode.source === "string" && hashNode.source) obj.sourceHash = hashNode.source;
      if (!obj || typeof obj.summary !== "string" || !obj.summary.trim()) {
        diagnostics.push({ severity: "error", file, line, message: `"${id}": needs a non-empty "summary"` });
        continue;
      }
      if (typeof obj.sourceHash !== "string") {
        diagnostics.push({ severity: "error", file, line, message: `"${id}": needs "sourceHash" (run: npm run zh -- todo ${target.owner})` });
        continue;
      }
      for (const k of Object.keys(obj)) {
        if (k !== "summary" && k !== "sourceHash") diagnostics.push({ severity: "warning", file, line, message: `"${id}": unknown key "${k}"` });
      }
      if (overlay.entries.has(id)) {
        diagnostics.push({ severity: "error", file, line, message: `"${id}" is described twice (also in ${overlay.entries.get(id).file})` });
        continue;
      }
      overlay.entries.set(id, { summary: obj.summary.trim(), sourceHash: obj.sourceHash, file, line });
      if (obj.sourceHash !== sourceHash(target.tooltip)) {
        diagnostics.push({ severity: "warning", file, line, message: `"${id}": the English tooltip changed since this summary was written (stale; the site shows English). Update the summary and set sourceHash: ${sourceHash(target.tooltip)}` });
      }
    }
  }
  return { overlay, diagnostics };
}
