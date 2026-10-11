#!/usr/bin/env node
// Copies each plugin's exported API description into data/api/:
//
//   <from>/uBotCore/docs/api.json   -> data/api/UBotCore.json
//   <from>/uBotSensor/docs/api.json -> data/api/UBotSensor.json
//   <from>/uBotROS/docs/api.json    -> data/api/UBotROS.json
//
// --from defaults to vendor/ (the git submodules). On a Windows machine with UE, point it at the
// plugin folder the exporter wrote to, e.g. --from E:\IDEProjects\UE-EAI-Simulator\Plugins\uBot.
// Files are copied byte for byte (the exporter's output is deterministic); a missing or invalid
// source keeps the current data file and is reported. --strict turns that into a failure.
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPOS = [
  ["uBotCore", "UBotCore"],
  ["uBotSensor", "UBotSensor"],
  ["uBotROS", "UBotROS"],
];

const args = process.argv.slice(2);
const fromIdx = args.indexOf("--from");
const fromArg = fromIdx >= 0 ? args[fromIdx + 1] : (args.find((a) => a.startsWith("--from="))?.slice(7) ?? "vendor");
const from = isAbsolute(fromArg) ? fromArg : resolve(root, fromArg);
const strict = args.includes("--strict");

let problems = 0;
let copied = 0;
for (const [repo, plugin] of REPOS) {
  const src = join(from, repo, "docs", "api.json");
  const dst = join(root, "data", "api", `${plugin}.json`);
  if (!existsSync(src)) {
    console.warn(`sync-api: ${src} not found; keeping data/api/${plugin}.json`);
    problems++;
    continue;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(src, "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    console.warn(`sync-api: ${src} is not valid JSON (${e.message}); skipped`);
    problems++;
    continue;
  }
  if (data.format !== 1 || data.plugin !== plugin) {
    console.warn(`sync-api: ${src} has format ${data.format} / plugin ${data.plugin}, expected format 1 / ${plugin}; skipped`);
    problems++;
    continue;
  }
  copyFileSync(src, dst);
  copied++;
  console.log(`sync-api: ${plugin} ${data.version} (${data.generator}) -> data/api/${plugin}.json`);
}
console.log(`sync-api: ${copied} copied, ${problems} skipped. Next: npm run check && npm run build`);
process.exit(strict && problems ? 1 : 0);
