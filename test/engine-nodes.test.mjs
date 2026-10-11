import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkEngineLists, entryRequirement, mergeEngineLists, parseEngineList, readEngineLists, requiredModules } from "../lib/engine-nodes.mjs";
import { root } from "./helpers.mjs";

const core = { rel: "data/engine-nodes/core.txt", text: "# core\n/Script/Engine.KismetSystemLibrary:PrintString\nnode /Script/BlueprintGraph.K2Node_IfThenElse   # Branch\n\n" };
const vehicles = { rel: "data/engine-nodes/vehicles.txt", text: "/Script/ChaosVehicles.ChaosVehicleMovementComponent:SetThrottleInput\n/Script/Engine.KismetSystemLibrary:PrintString\nmacro /ChaosVehicles/Macros.Macros:Steer\n" };

test("lists ignore comments and blank lines", () => {
  assert.deepEqual(parseEngineList(core.text), [
    { line: 2, entry: "/Script/Engine.KismetSystemLibrary:PrintString" },
    { line: 3, entry: "node /Script/BlueprintGraph.K2Node_IfThenElse" },
  ]);
});

test("duplicates across files are errors that name the first file", () => {
  const f = checkEngineLists([core, vehicles]);
  assert.equal(f.length, 1);
  assert.equal(f[0].file, "data/engine-nodes/vehicles.txt");
  assert.equal(f[0].line, 2);
  assert.match(f[0].message, /listed twice \(first in data\/engine-nodes\/core\.txt:2\)/);
  assert.deepEqual(checkEngineLists([{ rel: "x.txt", text: "# only a comment: a list waiting for its first node\n" }]), [], "a list with only comments is fine");
});

test("merging keeps every entry once, with its source file and line for error messages", () => {
  const { text, sources } = mergeEngineLists([core, vehicles]);
  const lines = text.trimEnd().split("\n");
  assert.match(lines[0], /^# Merged from data\/engine-nodes/);
  assert.equal(lines.length, 5, "header + 4 distinct entries");
  assert.equal(lines[1], "/Script/Engine.KismetSystemLibrary:PrintString  # data/engine-nodes/core.txt:2");
  assert.equal(lines[3], "/Script/ChaosVehicles.ChaosVehicleMovementComponent:SetThrottleInput  # data/engine-nodes/vehicles.txt:1");
  assert.deepEqual(sources.map((s) => s.line), [2, 3, 4, 5]);
  assert.deepEqual(sources[3], { line: 5, rel: "data/engine-nodes/vehicles.txt", sourceLine: 3, entry: "macro /ChaosVehicles/Macros.Macros:Steer" });
  // the merged text parses back to the same entries (what the commandlet reads)
  assert.deepEqual(parseEngineList(text).map((e) => e.entry), sources.map((s) => s.entry));
});

test("what entries need from the engine: script modules and plugin content mounts", () => {
  assert.deepEqual(entryRequirement("event /Script/Engine.Actor:ReceiveTick"), { module: "Engine" });
  assert.deepEqual(entryRequirement("macro /Engine/EditorBlueprintResources/StandardMacros.StandardMacros:ForLoop"), { mount: "Engine" });
  assert.deepEqual(requiredModules([core, vehicles]), { modules: ["BlueprintGraph", "ChaosVehicles", "Engine"], mounts: ["ChaosVehicles"] });
});

test("the repository's lists are valid; the merge script writes the commandlet's file and locates lines", () => {
  const lists = readEngineLists(join(root, "data"));
  assert.ok(lists.some((l) => l.rel === "data/engine-nodes/core.txt"));
  assert.deepEqual(checkEngineLists(lists), []);
  const dir = mkdtempSync(join(tmpdir(), "ubot-nodes-"));
  try {
    const out = join(dir, "merged.txt");
    execFileSync(process.execPath, [join(root, "scripts", "engine-nodes.mjs"), "merge", out], { stdio: "pipe" });
    const merged = readFileSync(out, "utf8");
    assert.equal(parseEngineList(merged).length, lists.reduce((n, l) => n + parseEngineList(l.text).length, 0));
    const where = execFileSync(process.execPath, [join(root, "scripts", "engine-nodes.mjs"), "locate", out, "2"], { encoding: "utf8" }).trim();
    assert.match(where, /^data\/engine-nodes\/core\.txt:\d+$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
