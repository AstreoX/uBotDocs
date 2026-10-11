// Shared test fixtures: the repository's data (api registry, package registry), a tiny synthetic API
// registry and "package kits" (a package that does not exist yet).
//
// Which packages the repository documents changes whenever one is released, and the sync bot releases
// them by changing data only. Tests therefore never write down "the released packages" or "the planned
// package": they ask repoPackages(), or build their own world from a kit.
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSite } from "../lib/blueprint/site.mjs";
import { ApiRegistry } from "../lib/blueprint/api.mjs";
import { loadPackages } from "../lib/packages.mjs";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const site = () => loadSite(root);
/** The package registry of the repository's own data/: data/index.json plus the versions in data/api. */
export const repoPackages = () => loadPackages({ root }).registry;

const T = (category, subtype = "", container = "none") => ({ category, subtype, subtypeDisplay: subtype.replace(/^[FUE]/, ""), container, valueType: null, byRef: false, const: false });
const pin = (id, name, type, extra = {}) => ({ id, name, type, default: "", advanced: false, tooltip: "", ...extra });
const node = (o) => ({
  subtitle: "", owner: "", member: "", category: "", tooltip: "", keywords: "", compactTitle: "",
  flags: { static: false, latent: false, deprecated: false, developmentOnly: false, callInEditor: false, compact: false },
  inputs: [], outputs: [], ...o,
});

/** A small registry with an event, a call, a pure function, a break node and a class hierarchy. */
export function tinyRegistry() {
  const r = new ApiRegistry();
  r.add({
    format: 1, plugin: "Tiny", version: "1.0.0", engine: "5.5", repository: "https://example.invalid/tiny", generator: "test", culture: "en",
    modules: [],
    classes: [
      { id: "UBase", displayName: "Base", kind: "component", parent: "UActorComponent", module: "Tiny", header: "", category: "", tooltip: "", flags: { abstract: true, blueprintType: true, blueprintable: true, spawnable: false, deprecated: false }, properties: [], nodes: ["UBase.Tick"] },
      { id: "UChild", displayName: "Child", kind: "component", parent: "UBase", module: "Tiny", header: "", category: "", tooltip: "", flags: { abstract: false, blueprintType: true, blueprintable: true, spawnable: true, deprecated: false }, properties: [], nodes: ["UChild.Fire", "UChild.GetValue", "UChild.OnHit"] },
    ],
    nodes: [
      node({ id: "Break:FData", kind: "break", title: "Break Data", inputs: [pin("Data", "Data", T("struct", "FData"))], outputs: [pin("Value", "Value", T("float")), pin("bOk", "Ok", T("bool")), pin("Items", "Items", T("int", "", "array"))] }),
      node({ id: "UBase.Tick", kind: "event", title: "Event Tick", owner: "UBase", member: "Tick", outputs: [pin("OutputDelegate", "Output Delegate", T("delegate")), pin("then", "", T("exec")), pin("DeltaSeconds", "Delta Seconds", T("float"))] }),
      node({ id: "UChild.Fire", kind: "call", title: "Fire", subtitle: "Target is Child", owner: "UChild", member: "Fire", inputs: [pin("execute", "", T("exec")), pin("self", "Target", T("object", "UChild")), pin("Power", "Power", T("float"), { default: "1.0" }), pin("Label", "Label", T("string"), { advanced: true })], outputs: [pin("then", "", T("exec")), pin("ReturnValue", "Return Value", T("bool"))] }),
      node({ id: "UChild.GetValue", kind: "pure", title: "Get Value", subtitle: "Target is Child", owner: "UChild", member: "GetValue", inputs: [pin("self", "Target", T("object", "UChild"))], outputs: [pin("ReturnValue", "Return Value", T("struct", "FData"))] }),
      node({ id: "UChild.OnHit", kind: "event", title: "On Hit", owner: "UChild", member: "OnHit", outputs: [pin("OutputDelegate", "Output Delegate", T("delegate")), pin("then", "", T("exec")), pin("Data", "Data", T("struct", "FData"))] }),
      node({ id: "K2Node_IfThenElse", kind: "node", title: "Branch", inputs: [pin("execute", "", T("exec")), pin("Condition", "Condition", T("bool"), { default: "true" })], outputs: [pin("then", "True", T("exec")), pin("else", "False", T("exec"))] }),
    ],
    structs: [{ id: "FData", displayName: "Data", module: "Tiny", header: "", tooltip: "", fields: [], make: "", break: "Break:FData" }],
    enums: [],
  }, "tiny.json");
  return r;
}

// ---------------------------------------------------------------------------- package kits

const camelWords = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2");

/**
 * The data and pages a first release of the package `name` (a UE plugin name such as UBotTestKit)
 * brings to the docs repository, and nothing else: its entry in the package index (`indexEntry`), the
 * api.json its exporter writes (`api`), and one guide folder (`topic`, with a _group.yml that declares
 * the package, and ping.mdx). `class` is the id of its one component class, `slug` its reference folder.
 */
export function packageKit(name, { friendlyName = `uBot ${camelWords(name.replace(/^UBot/, ""))}`, version = "0.1.0", layer = "Capability", requires = [] } = {}) {
  const cls = `U${name}Component`;
  const folder = name.replace(/^UBot/, "uBot");
  const bare = name.replace(/^UBot/, "").toLowerCase();
  const api = {
    format: 1, plugin: name, version, engine: "5.5", repository: `https://github.com/AstreoX/${folder}`, generator: "UBotDocExport 1", culture: "en",
    modules: [{ name, type: "Runtime" }],
    classes: [{
      id: cls, displayName: friendlyName, kind: "component", parent: "UActorComponent", module: name, header: `Source/${name}/Public/${name}Component.h`, category: "", tooltip: "Answers pings.",
      flags: { abstract: false, blueprintType: true, blueprintable: true, spawnable: true, deprecated: false },
      properties: [{ id: "Delay", displayName: "Delay", type: T("float"), default: "0.5", category: "Test Kit", access: "readOnly", editable: "anywhere", tooltip: "Seconds before the answer.", meta: {} }],
      nodes: [`${cls}.Ping`],
    }],
    nodes: [node({
      id: `${cls}.Ping`, kind: "call", title: "Ping", subtitle: `Target is ${friendlyName}`, owner: cls, member: "Ping", tooltip: "Sends a ping.",
      inputs: [pin("execute", "", T("exec")), pin("self", "Target", T("object", cls))],
      outputs: [pin("then", "", T("exec")), pin("ReturnValue", "Return Value", T("bool"))],
    })],
    structs: [],
    enums: [],
  };
  const indexEntry = {
    name, friendlyName,
    description: { en: `${friendlyName} exists only in tests.`, "zh-CN": "只在测试里存在的插件。" },
    layer,
    repository: `https://github.com/AstreoX/${folder}.git`,
    tags: ["test"],
    versions: [{ version, ref: `v${version}`, engine: "~5.5", requires, enginePlugins: [], provides: ["Test.Ping"] }],
  };
  const guide = `---
title: 发一次 Ping
description: 用 ${friendlyName} 组件发一次 Ping。
---

这一页用 \`Ping\` 节点检查测试组件是否在线。

\`\`\`blueprint
nodes:
  B: AActor.ReceiveBeginPlay
  K: { var: Kit, class: ${cls} }
  P: ${cls}.Ping
wires:
  - B.then -> P.execute
  - K.Kit -> P.Target
\`\`\`
`;
  return {
    name, friendlyName, class: cls, slug: name.toLowerCase(), topic: `sim-${bare}`,
    api, indexEntry, guide,
    group: `label: 测试套件 ${friendlyName}\npackages: [${name}]\n`,
  };
}

/** Writes a kit's api.json and guide folder into the repository (or a copy of it) at `dir`; the index is the caller's. */
export function writeKit(dir, kit) {
  mkdirSync(join(dir, "data", "api"), { recursive: true });
  writeFileSync(join(dir, "data", "api", `${kit.name}.json`), `${JSON.stringify(kit.api, null, 2)}\n`);
  const guides = join(dir, "src", "content", "docs", "guides", kit.topic);
  mkdirSync(guides, { recursive: true });
  writeFileSync(join(guides, "_group.yml"), kit.group);
  writeFileSync(join(guides, "ping.mdx"), kit.guide);
}

/** Rewrites data/index.json of the repository (or a copy of it) at `dir` with the changes `edit(index)` makes. */
export function editIndex(dir, edit) {
  const file = join(dir, "data", "index.json");
  const index = JSON.parse(readFileSync(file, "utf8"));
  edit(index);
  writeFileSync(file, `${JSON.stringify(index, null, 4)}\n`);
}

const NOT_COPIED = new Set(["node_modules", "dist", ".astro", ".git", "vendor", "src/content/docs/reference"]);

/**
 * Copies the repository to `dir` (a new folder outside it) without installs, build output, git data
 * and the generated reference, and links node_modules, so scripts and the test suite run there.
 */
export function copyRepo(dir) {
  cpSync(root, dir, { recursive: true, filter: (src) => !NOT_COPIED.has(relative(root, src).replaceAll("\\", "/")) });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "junction");
}

/** Removes a folder made by copyRepo() or a temporary folder; the linked node_modules stays. */
export function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}
