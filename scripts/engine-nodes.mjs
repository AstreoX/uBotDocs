#!/usr/bin/env node
// Engine node lists (data/engine-nodes/*.txt) for scripts/export-api.ps1:
//
//   node scripts/engine-nodes.mjs merge <out file>   one list for the commandlet's -Nodes=<file>
//   node scripts/engine-nodes.mjs modules            JSON { modules, mounts } the entries need
//   node scripts/engine-nodes.mjs locate <file> <n>  the source file and line of line n of a merged list
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEngineLists, mergeEngineLists, readEngineLists, requiredModules } from "../lib/engine-nodes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...rest] = process.argv.slice(2);
const lists = readEngineLists(join(root, "data"));

if (cmd === "merge" && rest[0]) {
  const errors = checkEngineLists(lists).filter((f) => f.severity === "error");
  for (const f of errors) console.error(`${f.file}:${f.line}: error: ${f.message}`);
  if (errors.length) process.exit(1);
  const { text, sources } = mergeEngineLists(lists);
  writeFileSync(rest[0], text, "utf8");
  console.log(`engine-nodes: ${sources.length} entries from ${lists.length} file(s) -> ${rest[0]}`);
} else if (cmd === "modules") {
  console.log(JSON.stringify(requiredModules(lists)));
} else if (cmd === "locate" && rest[0] && rest[1]) {
  const line = readFileSync(rest[0], "utf8").split(/\r?\n/)[Number(rest[1]) - 1] ?? "";
  console.log(/#\s*(\S+:\d+)\s*$/.exec(line)?.[1] ?? "?");
} else {
  console.error("usage: node scripts/engine-nodes.mjs merge <out> | modules | locate <merged file> <line>");
  process.exit(1);
}
