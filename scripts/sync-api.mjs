#!/usr/bin/env node
// Copies each released package's exported API description (docs/api.json in its plugin repository)
// to data/api/<Package>.json. The package list, the folders and the repositories come from
// data/index.json (lib/packages.mjs); a new package needs no change here.
//
//   npm run sync-api                         from vendor/<folder>/docs/api.json (the git submodules)
//   npm run sync-api -- --from <dir>         from <dir>/<folder>/docs/api.json, e.g. the plugin folder
//                                            export-api.ps1 wrote to: E:\IDEProjects\UE-EAI-Simulator\Plugins\uBot
//   npm run sync-api -- --from-github        download docs/api.json at the latest released version's ref
//                                            (the tag); when the file does not exist there, from the
//                                            repository's default branch (reported). No token needed.
//   --package <Name>   only this package (repeatable; any letter case)
//   --report <file>    write a Markdown summary (the sync-packages workflow uses it as the PR body)
//   --strict           exit 1 when a package could not be synced
//
// Files are copied byte for byte (the exporter's output is deterministic). A missing or invalid source
// keeps the current data file and is reported.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPackages } from "../lib/packages.mjs";
import { compareVersions } from "../lib/semver.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const values = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : a.startsWith(`${flag}=`) ? [a.slice(flag.length + 1)] : []));
const fromGitHub = args.includes("--from-github");
const fromArg = values("--from")[0] ?? "vendor";
const from = isAbsolute(fromArg) ? fromArg : resolve(root, fromArg);
const only = values("--package");
const reportFile = values("--report")[0];
const strict = args.includes("--strict");

// A git ref the index may name: no leading "-", no "..", no whitespace, none of ~ ^ : ? * [ \ " (uBotCore's IsSafeGitRef).
const SAFE_REF = /^(?!-)(?!.*\.\.)[^\s~^:?*[\\"\x00-\x1f\x7f]+$/;

const { registry, diagnostics } = loadPackages({ root, fresh: true });
const indexErrors = diagnostics.filter((d) => d.severity === "error" && d.file.endsWith("index.json"));
if (indexErrors.length) {
  for (const d of indexErrors) console.error(`${d.file}:${d.line}: error: ${d.message}`);
  console.error("sync-api: data/index.json has errors (npm run sync-index)");
  process.exit(1);
}
const unknown = only.filter((n) => !registry.get(n)?.released);
if (unknown.length) {
  console.error(`sync-api: not a released package in data/index.json: ${unknown.join(", ")}`);
  process.exit(1);
}
// --package takes the name in any letter case (the registry matches case-insensitively); compare canonical names.
const wanted = new Set(only.map((n) => registry.get(n).name));
const packages = registry.released().filter((p) => !only.length || wanted.has(p.name));

/** Checks a downloaded or local file before it replaces data/api/<Name>.json. */
function validate(bytes, pkg) {
  let data;
  try {
    data = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    return { error: `not valid JSON (${e.message})` };
  }
  if (data.format !== 1 || data.plugin !== pkg.name) return { error: `has format ${data.format} / plugin ${data.plugin}, expected format 1 / ${pkg.name}` };
  return { data };
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const rows = [];
let problems = 0;
let changed = 0;
for (const pkg of packages) {
  const dst = join(root, "data", "api", `${pkg.name}.json`);
  const before = existsSync(dst) ? readFileSync(dst) : null;
  const row = { name: pkg.name, latest: pkg.latest.version, source: "", version: "", status: "", note: "" };
  rows.push(row);
  let bytes = null;
  try {
    if (fromGitHub) {
      if (!pkg.github) throw new Error(`repository ${pkg.repository || "(none)"} is not on github.com`);
      const ref = pkg.latest.ref;
      if (typeof ref !== "string" || !SAFE_REF.test(ref)) throw new Error(`ref ${JSON.stringify(ref)} of ${pkg.latest.version} is not a safe git ref`);
      const base = `https://raw.githubusercontent.com/${pkg.github.owner}/${pkg.github.repo}`;
      const atRef = `${base}/${ref.split("/").map(encodeURIComponent).join("/")}/docs/api.json`;
      bytes = await download(atRef);
      row.source = `${ref}`;
      if (!bytes) {
        bytes = await download(`${base}/HEAD/docs/api.json`);
        row.source = "default branch";
        row.note = `docs/api.json does not exist at ${ref}; taken from the default branch`;
        if (!bytes) throw new Error(`docs/api.json exists neither at ${ref} nor on the default branch`);
      }
    } else {
      const src = join(from, pkg.folder, "docs", "api.json");
      row.source = src;
      if (!existsSync(src)) throw new Error(`${src} not found`);
      bytes = readFileSync(src);
    }
    const { data, error } = validate(bytes, pkg);
    if (error) throw new Error(`docs/api.json ${error}`);
    row.version = data.version;
    if (compareVersions(data.version, pkg.latest.version) !== 0) {
      row.note = [row.note, `the file documents ${data.version}, the latest release is ${pkg.latest.version}`].filter(Boolean).join("; ");
    }
    if (before && before.equals(bytes)) row.status = "unchanged";
    else {
      writeFileSync(dst, bytes);
      row.status = before ? "updated" : "added";
      changed++;
    }
    console.log(`sync-api: ${pkg.name} ${data.version} (${data.generator}) from ${row.source}: ${row.status}${row.note ? ` (${row.note})` : ""}`);
  } catch (e) {
    problems++;
    row.status = "skipped";
    row.note = e.message;
    console.warn(`sync-api: ${pkg.name}: ${e.message}; keeping data/api/${pkg.name}.json`);
  }
}

if (reportFile) {
  const statusZh = { added: "新增", updated: "更新", unchanged: "未变", skipped: "跳过" };
  const lines = [
    "| 插件 | 最新发布 | api.json 版本 | 来源 | 结果 | 说明 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.name} | ${r.latest} | ${r.version || "—"} | ${r.source || "—"} | ${statusZh[r.status] ?? r.status} | ${r.note.replace(/\|/g, "\\|") || ""} |`),
  ];
  writeFileSync(reportFile, `${lines.join("\n")}\n`, "utf8");
}
console.log(`sync-api: ${changed} changed, ${problems} skipped. Next: npm run check && npm run build`);
process.exit(strict && problems ? 1 : 0);
