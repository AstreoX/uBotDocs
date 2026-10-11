#!/usr/bin/env node
// Helpers for the Chinese summaries in data/zh/<Plugin>.yaml.
//
//   npm run zh -- status              how many items have a current Chinese summary, per plugin
//   npm run zh -- todo UBotSensor     YAML skeletons (with sourceHash) for missing or stale entries
//   npm run zh -- todo UBotSensor --what node,class
//   npm run zh -- hash <id>           sourceHash of an item's current English tooltip
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSite } from "../lib/blueprint/site.mjs";
import { sourceHash } from "../lib/blueprint/zh.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd = "status", ...rest] = process.argv.slice(2);
const { registry, overlay } = loadSite(root);
const items = registry.describableIds();

function state(id, tooltip) {
  const e = overlay.entries.get(id);
  if (!e) return "missing";
  return e.sourceHash === sourceHash(tooltip) ? "ok" : "stale";
}

if (cmd === "hash") {
  const id = rest[0];
  const item = items.get(id);
  if (!item) {
    console.error(`unknown id "${id}" (try: npm run find -- <words>)`);
    process.exit(1);
  }
  console.log(sourceHash(item.tooltip));
} else if (cmd === "status") {
  const per = new Map();
  for (const [id, it] of items) {
    if (it.plugin === "Engine") continue;
    const s = per.get(it.plugin) ?? { ok: 0, stale: 0, missing: 0 };
    s[state(id, it.tooltip)]++;
    per.set(it.plugin, s);
  }
  for (const [plugin, s] of [...per].sort()) console.log(`${plugin.padEnd(12)} ok ${s.ok}  stale ${s.stale}  missing ${s.missing}`);
} else if (cmd === "todo") {
  const plugin = rest.find((a) => !a.startsWith("--"));
  const whatArg = rest.find((a) => a.startsWith("--what="))?.slice(7) ?? (rest.includes("--what") ? rest[rest.indexOf("--what") + 1] : "");
  const what = whatArg ? new Set(whatArg.split(",")) : null;
  const out = [];
  for (const [id, it] of [...items].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (plugin && it.plugin !== plugin) continue;
    if (!plugin && it.plugin === "Engine") continue;
    if (what && !what.has(it.what)) continue;
    const s = state(id, it.tooltip);
    if (s === "ok") continue;
    const en = it.tooltip ? it.tooltip.replace(/\s*\n\s*/g, " ") : "(no English tooltip)";
    out.push(`# [${s}] ${it.what}: ${en}`);
    out.push(`${id}:`, `  summary: `, `  sourceHash: "${sourceHash(it.tooltip)}"`, "");
  }
  console.log(out.length ? out.join("\n") : "# nothing to do");
} else {
  console.error("usage: npm run zh -- status | todo [Plugin] [--what node,class,property,struct,field,enum,value] | hash <id>");
  process.exit(1);
}
