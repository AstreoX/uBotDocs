#!/usr/bin/env node
// Helpers for the Chinese summaries in data/zh/<Package>/<Owner>.yaml (one file per class, struct
// or enum; nodes and properties live in their owner's file, engine nodes in data/zh/Engine/).
//
//   npm run zh -- status                         per package: items with a current, stale or missing summary
//   npm run zh -- status UBotSensor              per class, struct and enum of one package
//   npm run zh -- todo UBotSensor                YAML skeletons (with sourceHash) for missing or stale
//                                                entries, grouped by the file they belong in
//   npm run zh -- todo UUBotImuSensorComponent   the same for one class, struct or enum
//   npm run zh -- todo UBotSensor --what node,class
//   npm run zh -- hash <id>                      sourceHash of an item's current English tooltip
//   npm run zh -- where <id>                     the file an item's summary belongs in
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSite } from "../lib/blueprint/site.mjs";
import { sourceHash, zhFileFor } from "../lib/blueprint/zh.mjs";
import { loadPackages } from "../lib/packages.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd = "status", ...rest] = process.argv.slice(2);
const { registry, overlay } = loadSite(root);
const { registry: packages } = loadPackages({ root });
const items = registry.describableIds();
const target = rest.find((a) => !a.startsWith("--"));

function state(id, tooltip) {
  const e = overlay.entries.get(id);
  if (!e) return "missing";
  return e.sourceHash === sourceHash(tooltip) ? "ok" : "stale";
}
const isPackage = (name) => name === "Engine" || [...items.values()].some((it) => it.plugin === name);
const counts = () => ({ ok: 0, stale: 0, missing: 0 });
const line = (label, s, width) => `${label.padEnd(width)} ok ${String(s.ok).padStart(3)}  stale ${String(s.stale).padStart(3)}  missing ${String(s.missing).padStart(3)}`;

if (cmd === "hash" || cmd === "where") {
  const item = items.get(target);
  if (!item) {
    console.error(`unknown id "${target}" (try: npm run find -- <words>)`);
    process.exit(1);
  }
  console.log(cmd === "hash" ? sourceHash(item.tooltip) : zhFileFor(item));
} else if (cmd === "status") {
  if (target && !isPackage(target)) {
    console.error(`"${target}" is not a package with API data (packages: ${packages.released().map((p) => p.name).join(", ")}, Engine)`);
    process.exit(1);
  }
  const per = new Map();
  for (const [id, it] of items) {
    if (target ? it.plugin !== target : it.plugin === "Engine") continue;
    const key = target ? it.owner : it.plugin;
    const s = per.get(key) ?? counts();
    s[state(id, it.tooltip)]++;
    per.set(key, s);
  }
  // Packages in registry order; a package without API data is listed with nothing to describe.
  const keys = target ? [...per.keys()].sort() : [...packages.released().map((p) => p.name).filter((n) => per.has(n)), ...[...per.keys()].filter((k) => !packages.get(k)).sort()];
  const width = Math.max(12, ...keys.map((k) => k.length + 1));
  for (const k of keys) console.log(line(k, per.get(k), width));
  if (!target) for (const p of packages.released().filter((p) => !per.has(p.name))) console.log(`${p.name.padEnd(width)} (no data/api/${p.name}.json yet)`);
} else if (cmd === "todo") {
  const whatArg = rest.find((a) => a.startsWith("--what="))?.slice(7) ?? (rest.includes("--what") ? rest[rest.indexOf("--what") + 1] : "");
  const what = whatArg ? new Set(whatArg.split(",")) : null;
  const byPackage = target && isPackage(target);
  const byOwner = target && !byPackage && [...items.values()].some((it) => it.owner === target);
  if (target && !byPackage && !byOwner) {
    console.error(`"${target}" is neither a package nor a class, struct or enum id (try: npm run find -- <words>)`);
    process.exit(1);
  }
  const files = new Map();
  for (const [id, it] of [...items].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (byPackage && it.plugin !== target) continue;
    if (byOwner && it.owner !== target) continue;
    if (!target && it.plugin === "Engine") continue;
    if (what && !what.has(it.what)) continue;
    const s = state(id, it.tooltip);
    if (s === "ok") continue;
    const en = it.tooltip ? it.tooltip.replace(/\s*\n\s*/g, " ") : "(no English tooltip)";
    const file = zhFileFor(it);
    if (!files.has(file)) files.set(file, []);
    files.get(file).push(`# [${s}] ${it.what}: ${en}`, `${id}:`, `  summary: `, `  sourceHash: "${sourceHash(it.tooltip)}"`, "");
  }
  const out = [];
  for (const [file, lines] of [...files].sort()) out.push(`# ---------- ${file}`, "", ...lines);
  console.log(out.length ? out.join("\n") : "# nothing to do");
} else {
  console.error("usage: npm run zh -- status [Package] | todo [Package|ClassId] [--what node,class,property,struct,field,enum,value] | hash <id> | where <id>");
  process.exit(1);
}
