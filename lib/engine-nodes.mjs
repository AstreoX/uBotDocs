// UE engine nodes the documentation uses: data/engine-nodes/<area>.txt (core.txt for everything any
// page may need, vehicles.txt for nodes of the Chaos Vehicles plugin, ...). The UBotDocExport
// commandlet takes one list (-Nodes=<file>), so scripts/export-api.ps1 merges the files first
// (mergeEngineLists, through scripts/engine-nodes.mjs) and writes data/api/engine.json.
//
// Line format (the commandlet's): /Script/Module.Class:Function | event /Script/Module.Class:Event |
// node /Script/Module.K2Node_X | macro /Path/Lib.Lib:Macro. "#" starts a comment.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const ENGINE_NODES_DIR = "data/engine-nodes";
export const LEGACY_ENGINE_LIST = "data/engine-nodes.txt";

const ENGINE_LINE = [
  /^\/Script\/[A-Za-z0-9_]+\.[A-Za-z0-9_]+:[A-Za-z0-9_]+$/, // function: /Script/Module.Class:Function
  /^event \/Script\/[A-Za-z0-9_]+\.[A-Za-z0-9_]+:[A-Za-z0-9_]+$/, // event: event /Script/Module.Class:Event
  /^node \/Script\/[A-Za-z0-9_]+\.K2Node_[A-Za-z0-9_]+$/, // special node: node /Script/Module.K2Node_X
  /^macro \/[A-Za-z0-9_/]+\.[A-Za-z0-9_]+:[A-Za-z0-9_]+$/, // macro: macro /Path/Library.Library:Macro
];

/** Entries of one list: [{ line, entry }] without comments and blank lines. */
export function parseEngineList(text) {
  const out = [];
  String(text ?? "").replace(/\r\n/g, "\n").split("\n").forEach((raw, i) => {
    const hash = raw.indexOf("#");
    const entry = (hash >= 0 ? raw.slice(0, hash) : raw).trim().replace(/\s+/g, " ");
    if (entry) out.push({ line: i + 1, entry });
  });
  return out;
}

/** The lists in data/engine-nodes/, sorted by file name: [{ rel, text }]. */
export function readEngineLists(dataDir) {
  const dir = join(dataDir, "engine-nodes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => ({ rel: `${ENGINE_NODES_DIR}/${f}`, text: readFileSync(join(dir, f), "utf8") }));
}

/** One list: format and duplicates inside the file. */
export function checkEngineList(rel, text) {
  return checkEngineLists([{ rel, text }]);
}

/** Every list: format, duplicates inside a file and across files. */
export function checkEngineLists(lists) {
  const findings = [];
  const seen = new Map();
  for (const { rel, text } of lists) {
    const entries = parseEngineList(text);
    if (!entries.length) findings.push({ severity: "warning", file: rel, line: 1, message: "the list has no entries; delete the file" });
    for (const { line, entry } of entries) {
      if (!ENGINE_LINE.some((re) => re.test(entry))) {
        findings.push({ severity: "error", file: rel, line, message: `"${entry}" is not in the list format: /Script/Module.Class:Function, event /Script/Module.Class:Event, node /Script/Module.K2Node_X or macro /Path/Lib.Lib:Macro` });
      } else if (seen.has(entry)) {
        const first = seen.get(entry);
        const where = first.rel === rel ? `first on line ${first.line}` : `first in ${first.rel}:${first.line}`;
        findings.push({ severity: "error", file: rel, line, message: `"${entry}" is listed twice (${where})` });
      } else seen.set(entry, { rel, line });
    }
  }
  return findings;
}

/**
 * Merges the lists into the one file the commandlet reads. Every entry keeps its origin as a trailing
 * comment ("# data/engine-nodes/core.txt:7"), so an error the commandlet reports for line N of the
 * merged file can be traced back. Returns { text, sources: [{ line, rel, sourceLine, entry }] }.
 */
export function mergeEngineLists(lists) {
  const lines = ["# Merged from data/engine-nodes/*.txt by scripts/engine-nodes.mjs. Do not edit."];
  const sources = [];
  const seen = new Set();
  for (const { rel, text } of lists) {
    for (const { line, entry } of parseEngineList(text)) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      lines.push(`${entry}  # ${rel}:${line}`);
      sources.push({ line: lines.length, rel, sourceLine: line, entry });
    }
  }
  return { text: `${lines.join("\n")}\n`, sources };
}

/**
 * What an entry needs from the engine: { module } for /Script/<Module> paths, { mount } for content
 * paths (/Engine/... is the engine's own content; any other mount point is a plugin's content).
 */
export function entryRequirement(entry) {
  const path = entry.split(" ").pop();
  const script = /^\/Script\/([A-Za-z0-9_]+)\./.exec(path);
  if (script) return { module: script[1] };
  const mount = /^\/([A-Za-z0-9_]+)\//.exec(path);
  return mount ? { mount: mount[1] } : {};
}

/** Script modules and content mount points used by all lists (for the plugin check in export-api.ps1). */
export function requiredModules(lists) {
  const modules = new Set();
  const mounts = new Set();
  for (const { text } of lists) {
    for (const { entry } of parseEngineList(text)) {
      const r = entryRequirement(entry);
      if (r.module) modules.add(r.module);
      if (r.mount && r.mount !== "Engine" && r.mount !== "Game") mounts.add(r.mount);
    }
  }
  return { modules: [...modules].sort(), mounts: [...mounts].sort() };
}
