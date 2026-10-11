#!/usr/bin/env node
// Copies the uBot package index (uBotCore's Index/index.json, format 2) to data/index.json. Every
// package list on the site comes from that file (lib/packages.mjs).
//
//   npm run sync-index                              local file (default below)
//   npm run sync-index -- --from <path>             another local copy, e.g. vendor/uBotCore/Index/index.json
//   npm run sync-index -- --from-url [<https URL>]  download; default: uBotCore main on GitHub
//
// The file is copied byte for byte. It is validated first (the parts the site uses, see
// validateIndex in lib/packages.mjs); with errors nothing is written and the exit code is 1.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_INDEX_URL, INDEX_FILE, createPackageRegistry, validateIndex } from "../lib/packages.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FROM = "E:\\IDEProjects\\UE-EAI-Simulator\\Plugins\\uBot\\uBotCore\\Index\\index.json";

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  if (i >= 0) return args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "";
  return args.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1);
};

async function readSource() {
  const url = valueOf("--from-url");
  if (url !== undefined) {
    const target = url || DEFAULT_INDEX_URL;
    if (!/^https:\/\//.test(target)) throw new Error(`--from-url needs an https:// URL (got ${target})`);
    const res = await fetch(target, { redirect: "follow" });
    if (!res.ok) throw new Error(`${target}: HTTP ${res.status}`);
    return { label: target, bytes: Buffer.from(await res.arrayBuffer()) };
  }
  const from = valueOf("--from") || DEFAULT_FROM;
  const path = isAbsolute(from) ? from : resolve(process.cwd(), from);
  if (!existsSync(path)) {
    throw new Error(`${path} not found. Pass --from <path to Index/index.json> (vendor/uBotCore/Index/index.json after git submodule update) or --from-url`);
  }
  return { label: path, bytes: readFileSync(path) };
}

try {
  const { label, bytes } = await readSource();
  const text = bytes.toString("utf8");
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new Error(`${label} is not valid JSON: ${e.message}`);
  }
  const findings = validateIndex(data, text, label);
  for (const d of findings) console.log(`${d.file}:${d.line}: ${d.severity}: ${d.message}`);
  if (findings.some((d) => d.severity === "error")) {
    console.error(`sync-index: ${label} has errors; ${INDEX_FILE} was not changed`);
    process.exit(1);
  }
  const dst = join(root, INDEX_FILE);
  const before = existsSync(dst) ? readFileSync(dst) : null;
  const registry = createPackageRegistry(data);
  const summary = `${registry.released().length} released (${registry.released().map((p) => `${p.name} ${p.latest.version}`).join(", ")}), ${registry.planned().length} planned`;
  if (before && before.equals(bytes)) {
    console.log(`sync-index: ${INDEX_FILE} is up to date (${summary})`);
  } else {
    writeFileSync(dst, bytes);
    console.log(`sync-index: ${label} -> ${INDEX_FILE} (${summary})`);
    console.log("Next: npm run sync-api, then npm run check && npm run build");
  }
} catch (e) {
  console.error(`sync-index: ${e.message}`);
  process.exit(1);
}
