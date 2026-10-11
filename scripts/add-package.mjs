#!/usr/bin/env node
// Onboards a uBot package in the docs repository: npm run add-package -- <Name> [--no-submodule]
//
// The package must be in data/index.json (npm run sync-index). The script
//   1. adds the plugin repository as a shallow submodule vendor/<folder> (for reading its source),
//      unless --no-submodule or it is there already;
//   2. creates data/zh/<Name>/ (with .gitkeep) for its Chinese summaries;
//   3. prints what is left to do.
// Running it again changes nothing that is already in place. Nothing else needs code or other files:
// the reference, the sidebar, the search filter and the checks pick the package up from
// data/index.json and data/api/<Name>.json. The submodule is only for reading the plugin's source
// while writing pages; the build never reads vendor/, so --no-submodule skips it.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPackages } from "../lib/packages.mjs";

/** Does the work; returns { done: [lines], todo: [lines] }. Throws on unusable input. */
export function addPackage({ root, name, submodule = true, run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" }) }) {
  const { registry } = loadPackages({ root, fresh: true });
  const pkg = registry.get(name);
  if (!pkg || pkg.name !== name) {
    const hint = pkg ? ` (did you mean ${pkg.name}?)` : "";
    throw new Error(`${name} is not in data/index.json${hint}. Add it to uBotCore's Index/index.json, then: npm run sync-index`);
  }
  const done = [];
  const todo = [];
  if (!pkg.released) todo.push(`${name} has no released version in data/index.json yet: its reference page, sidebar group and search filter appear once a version is released (planned: ${pkg.versions.map((v) => v.version).join(", ")})`);

  // 1. vendor/<folder> submodule
  const vendorPath = `vendor/${pkg.folder}`;
  const gitmodules = existsSync(join(root, ".gitmodules")) ? readFileSync(join(root, ".gitmodules"), "utf8") : "";
  const listed = gitmodules.split(/\r?\n/).some((l) => l.trim() === `path = ${vendorPath}`);
  if (listed) done.push(`submodule ${vendorPath} is already registered`);
  else if (!submodule) todo.push(`add the source submodule when you need it: git submodule add --depth 1 ${pkg.repository} ${vendorPath} && git config -f .gitmodules submodule.${vendorPath}.shallow true`);
  else {
    if (!/^https:\/\//.test(pkg.repository)) throw new Error(`${name}: repository ${JSON.stringify(pkg.repository)} is not an https:// URL`);
    run("git", ["submodule", "add", "--depth", "1", "--", pkg.repository, vendorPath]);
    run("git", ["config", "-f", ".gitmodules", `submodule.${vendorPath}.shallow`, "true"]);
    done.push(`added submodule ${vendorPath} (${pkg.repository}, shallow)`);
  }

  // 2. data/zh/<Name>/
  const zhDir = join(root, "data", "zh", name);
  const hasFiles = existsSync(zhDir) && readdirSync(zhDir).length > 0;
  if (hasFiles) done.push(`data/zh/${name}/ exists`);
  else {
    mkdirSync(zhDir, { recursive: true });
    writeFileSync(join(zhDir, ".gitkeep"), "");
    done.push(`created data/zh/${name}/.gitkeep`);
  }

  // 3. what is left
  const api = existsSync(join(root, "data", "api", `${name}.json`));
  if (api) done.push(`data/api/${name}.json exists (documents ${pkg.documentedVersion})`);
  else if (!pkg.released) todo.push(`after the release (a version without planned: true in the index): npm run sync-index, then npm run sync-api -- --from-github --package ${name}`);
  else todo.push(`get the API data: npm run sync-api -- --from-github --package ${name} (or locally: scripts/export-api.ps1 -Plugins ${name}, see CLAUDE.md)`);
  todo.push(
    `write guides in src/content/docs/guides/<topic>/ with a _group.yml: label: <中文名> and packages: [${name}]`,
    `engine nodes from an engine plugin (${pkg.enginePlugins.join(", ") || "none listed in the index"}): list them in data/engine-nodes/<area>.txt`,
    "npm run zh -- status " + name + "   then write summaries into data/zh/" + name + "/<Owner>.yaml",
    "npm test && npm run check && npm run build",
  );
  return { done, todo };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) {
    console.error("usage: npm run add-package -- <Name> [--no-submodule]");
    process.exit(1);
  }
  try {
    const { done, todo } = addPackage({ root, name, submodule: !args.includes("--no-submodule") });
    for (const l of done) console.log(`add-package: ${l}`);
    console.log("\nRemaining:");
    for (const l of todo) console.log(`  - ${l}`);
  } catch (e) {
    console.error(`add-package: ${e.message}`);
    process.exit(1);
  }
}
