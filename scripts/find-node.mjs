#!/usr/bin/env node
// Finds node ids for ```blueprint blocks: npm run find -- imu latest
// Every word must match the node title, id, owner or keywords (case-insensitive).
// --pins prints the pin ids and names, --json prints machine-readable output.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSite } from "../lib/blueprint/site.mjs";
import { nodeLocation } from "../lib/blueprint/paths.mjs";
import { typeText } from "../lib/blueprint/types.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const words = args.filter((a) => !a.startsWith("--")).map((w) => w.toLowerCase());
const showPins = args.includes("--pins");
const asJson = args.includes("--json");
if (!words.length) {
  console.error("usage: npm run find -- <words> [--pins] [--json]");
  process.exit(1);
}
const { registry } = loadSite(root);
const hits = [];
for (const [id, entry] of registry.nodes) {
  const n = entry.item;
  const owner = n.owner ? registry.classEntry(n.owner)?.item.displayName ?? n.owner : "";
  const hay = `${n.title} ${id} ${owner} ${n.keywords} ${n.category}`.toLowerCase();
  if (words.every((w) => hay.includes(w))) hits.push({ entry, owner });
}
hits.sort((a, b) => (a.entry.item.title < b.entry.item.title ? -1 : 1));

if (asJson) {
  console.log(JSON.stringify(hits.map(({ entry, owner }) => ({
    id: entry.item.id, title: entry.item.title, kind: entry.item.kind, owner, plugin: entry.plugin,
    reference: nodeLocation(registry, entry.item.id)?.href ?? null,
    inputs: entry.item.inputs.map((p) => ({ id: p.id, name: p.name, type: typeText(p.type) })),
    outputs: entry.item.outputs.map((p) => ({ id: p.id, name: p.name, type: typeText(p.type) })),
  })), null, 2));
} else {
  for (const { entry, owner } of hits) {
    const n = entry.item;
    console.log(`${n.id}\n  ${n.title} · ${n.kind}${owner ? ` · ${owner}` : ""} · ${entry.isEngine ? "Engine" : entry.plugin}  ${nodeLocation(registry, n.id)?.href ?? ""}`);
    if (showPins) {
      for (const [side, list] of [["in ", n.inputs], ["out", n.outputs]]) {
        for (const p of list) console.log(`    ${side} ${p.id}${p.name && p.name !== p.id ? ` ("${p.name}")` : ""}: ${typeText(p.type)}`);
      }
    }
  }
  console.log(`${hits.length} node(s)`);
}
