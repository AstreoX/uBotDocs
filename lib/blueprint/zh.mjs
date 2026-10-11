// Chinese summaries for API items: data/zh/<Plugin>.yaml
//
//   UUBotImuSensorComponent.GetLatestIMUData:
//     summary: 读取组件缓存的最近一次 IMU 采样，不会触发新的采样。
//     sourceHash: 1a2b3c4d5e6f      # sourceHash(English tooltip) when the summary was written
//
// A summary is used only while its sourceHash matches the current English tooltip; otherwise the
// site shows the English tooltip and `npm run check` warns that the summary is stale.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { parseDocument, LineCounter, isMap, isScalar } from "yaml";

export function sourceHash(text) {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex").slice(0, 12);
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

/** Loads every *.yaml in `dir` and checks it against the registry. */
export function loadZh(dir, registry, { root = process.cwd() } = {}) {
  const overlay = new ZhOverlay();
  const diagnostics = [];
  if (!existsSync(dir)) return { overlay, diagnostics };
  const describable = registry.describableIds();
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
    const abs = join(dir, f);
    const rel = relative(root, abs).replaceAll("\\", "/");
    const plugin = basename(f).replace(/\.ya?ml$/, "");
    const text = readFileSync(abs, "utf8");
    const lc = new LineCounter();
    const doc = parseDocument(text, { lineCounter: lc });
    const lineAt = (node) => (node?.range ? lc.linePos(node.range[0]).line : 1);
    for (const err of doc.errors) diagnostics.push({ severity: "error", file: rel, line: lc.linePos(err.pos[0]).line, message: `YAML: ${err.message.split("\n")[0]}` });
    if (doc.errors.length) continue;
    if (doc.contents == null) continue;
    if (!isMap(doc.contents)) {
      diagnostics.push({ severity: "error", file: rel, line: 1, message: "top level must be a mapping of id -> { summary, sourceHash }" });
      continue;
    }
    for (const pair of doc.contents.items) {
      const id = isScalar(pair.key) ? String(pair.key.value) : "";
      const line = lineAt(pair.key);
      const value = pair.value;
      const target = describable.get(id);
      if (!target) {
        diagnostics.push({ severity: "error", file: rel, line, message: `"${id}" is not an id in data/api (renamed or removed?); delete or rename this entry` });
        continue;
      }
      if (target.plugin !== plugin) {
        diagnostics.push({ severity: "warning", file: rel, line, message: `"${id}" belongs to ${target.plugin}; move it to data/zh/${target.plugin}.yaml` });
      }
      const obj = isMap(value) ? value.toJSON() : null;
      // A hash such as 000000000000 or 12e456789012 would load as a number; use the source text.
      const hashNode = isMap(value) ? value.get("sourceHash", true) : null;
      if (obj && isScalar(hashNode) && typeof hashNode.source === "string" && hashNode.source) obj.sourceHash = hashNode.source;
      if (!obj || typeof obj.summary !== "string" || !obj.summary.trim()) {
        diagnostics.push({ severity: "error", file: rel, line, message: `"${id}": needs a non-empty "summary"` });
        continue;
      }
      if (typeof obj.sourceHash !== "string") {
        diagnostics.push({ severity: "error", file: rel, line, message: `"${id}": needs "sourceHash" (run: npm run zh -- todo ${plugin})` });
        continue;
      }
      for (const k of Object.keys(obj)) {
        if (k !== "summary" && k !== "sourceHash") diagnostics.push({ severity: "warning", file: rel, line, message: `"${id}": unknown key "${k}"` });
      }
      if (overlay.entries.has(id)) {
        diagnostics.push({ severity: "error", file: rel, line, message: `"${id}" is described twice` });
        continue;
      }
      overlay.entries.set(id, { summary: obj.summary.trim(), sourceHash: obj.sourceHash, file: rel, line });
      if (obj.sourceHash !== sourceHash(target.tooltip)) {
        diagnostics.push({ severity: "warning", file: rel, line, message: `"${id}": the English tooltip changed since this summary was written (stale; the site shows English). Update the summary and set sourceHash: ${sourceHash(target.tooltip)}` });
      }
    }
  }
  return { overlay, diagnostics };
}
