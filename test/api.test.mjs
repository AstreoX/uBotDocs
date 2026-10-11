import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateApiShape, loadApi, makeLineFinder } from "../lib/blueprint/api.mjs";
import { loadZh, sourceHash } from "../lib/blueprint/zh.mjs";
import { root, tinyRegistry } from "./helpers.mjs";

const errors = (ds) => ds.filter((d) => d.severity === "error");

test("the repository's api.json files have a valid shape", () => {
  const { registry, diagnostics } = loadApi(join(root, "data", "api"), { root });
  assert.deepEqual(errors(diagnostics), []);
  assert.ok(registry.node("UUBotImuSensorComponent.GetLatestIMUData"));
  assert.ok(registry.node("K2Node_IfThenElse"));
  assert.deepEqual(diagnostics.filter((d) => d.severity === "warning"), [], "the exporter's files produce no warnings");
  for (const f of registry.files) assert.match(f.data.generator, /^UBotDocExport \d+$/, `${f.file} comes from the exporter`);
  // A subclass lists the inherited properties whose default it changes (the contract's example).
  const imu = registry.classEntry("UUBotImuSensorComponent").item;
  assert.equal(imu.properties.find((p) => p.id === "UpdateRateHz")?.default, "100.000000");
  assert.equal(registry.classEntry("UUBotSensorComponent").item.properties.find((p) => p.id === "UpdateRateHz")?.default, "10.000000");
});

test("files not written by the exporter are reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "ubot-api-"));
  try {
    const data = JSON.parse(readFileSync(join(root, "data", "api", "engine.json"), "utf8"));
    data.generator = "hand";
    writeFileSync(join(dir, "engine.json"), `${JSON.stringify(data, null, 2)}\n`);
    const { diagnostics } = loadApi(dir, { root: dir });
    assert.deepEqual(errors(diagnostics), []);
    assert.ok(diagnostics.some((d) => d.severity === "warning" && /not written by the UBotDocExport commandlet/.test(d.message)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("api shape errors carry the file and the line of the offending id", () => {
  const text = readFileSync(join(root, "data", "api", "UBotSensor.json"), "utf8");
  const data = JSON.parse(text);
  const n = data.nodes.find((x) => x.id === "UUBotImuSensorComponent.SampleIMU");
  n.kind = "function";
  n.outputs[1].type.category = "floaty";
  data.classes[0].nodes.push("UUBotImuSensorComponent.Missing");
  const broken = JSON.stringify(data, null, 2);
  const ds = validateApiShape(data, broken, "data/api/UBotSensor.json");
  const lineOf = makeLineFinder(broken);
  const e = errors(ds);
  const kind = e.find((d) => /"kind" is "function"/.test(d.message));
  assert.ok(kind);
  assert.equal(kind.file, "data/api/UBotSensor.json");
  assert.equal(kind.line, lineOf("UUBotImuSensorComponent.SampleIMU"));
  assert.ok(e.some((d) => /"category" is "floaty"/.test(d.message)));
  assert.ok(e.some((d) => /lists node "UUBotImuSensorComponent.Missing"/.test(d.message)));
});

test("format, map value types and duplicate ids are checked", () => {
  const data = { format: 2, plugin: "X", version: "1", engine: "5.5", repository: "", generator: "t", culture: "en", modules: [], classes: [], structs: [], enums: [],
    nodes: [
      { id: "A", kind: "pure", title: "A", subtitle: "", owner: "", member: "", category: "", tooltip: "", keywords: "", flags: { static: false, latent: false, deprecated: false, developmentOnly: false, callInEditor: false, compact: false }, compactTitle: "",
        inputs: [{ id: "M", name: "M", type: { category: "name", subtype: "", subtypeDisplay: "", container: "map", valueType: null, byRef: false, const: false }, default: "", advanced: false, tooltip: "" }], outputs: [] },
      { id: "A", kind: "pure", title: "A", subtitle: "", owner: "", member: "", category: "", tooltip: "", keywords: "", flags: { static: false, latent: false, deprecated: false, developmentOnly: false, callInEditor: false, compact: false }, compactTitle: "", inputs: [], outputs: [] },
    ] };
  const text = JSON.stringify(data, null, 2);
  const msgs = errors(validateApiShape(data, text, "x.json")).map((d) => d.message).join("\n");
  assert.match(msgs, /"format" is 2/);
  assert.match(msgs, /map type needs "valueType"/);
  assert.match(msgs, /duplicate id "A"/);
});

test("a file that is not the English export is an error", () => {
  const data = JSON.parse(readFileSync(join(root, "data", "api", "engine.json"), "utf8"));
  assert.equal(data.culture, "en");
  assert.deepEqual(errors(validateApiShape(data, JSON.stringify(data, null, 2), "data/api/engine.json")), []);
  for (const culture of ["zh-Hans", "en-US", ""]) {
    data.culture = culture;
    const msgs = errors(validateApiShape(data, JSON.stringify(data, null, 2), "data/api/engine.json")).map((d) => d.message).join("\n");
    assert.match(msgs, new RegExp(`"culture" is ${JSON.stringify(culture)}; the committed file must be the English export`));
  }
});

test("loadApi reports invalid JSON, BOMs and ids defined twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "ubot-api-"));
  try {
    const good = readFileSync(join(root, "data", "api", "engine.json"), "utf8");
    writeFileSync(join(dir, "a.json"), good);
    writeFileSync(join(dir, "b.json"), "﻿" + good);
    writeFileSync(join(dir, "c.json"), "{ nope");
    const { diagnostics } = loadApi(dir, { root: dir });
    const msgs = errors(diagnostics).map((d) => `${d.file}: ${d.message}`).join("\n");
    assert.match(msgs, /b\.json: file starts with a BOM/);
    assert.match(msgs, /b\.json: node "AActor.ReceiveTick" is also defined in a\.json/);
    assert.match(msgs, /c\.json: invalid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("zh overlay: fresh, stale and unknown entries", () => {
  const registry = tinyRegistry();
  const dir = mkdtempSync(join(tmpdir(), "ubot-zh-"));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "Tiny.yaml"),
      [
        "UChild.Fire:",
        "  summary: 开火。",
        `  sourceHash: ${sourceHash("")}`,
        "UChild.GetValue:",
        "  summary: 旧说明。",
        "  sourceHash: 000000000000",
        "UChild.Gone:",
        "  summary: 已删除的节点。",
        "  sourceHash: 000000000000",
      ].join("\n"),
    );
    const { overlay, diagnostics } = loadZh(dir, registry, { root: dir });
    assert.deepEqual(overlay.summary("UChild.Fire", ""), { text: "开火。", lang: "zh", stale: false });
    assert.deepEqual(overlay.summary("UChild.GetValue", ""), { text: "", lang: "en", stale: true });
    assert.equal(overlay.summary("UChild.OnHit", "Fires on hit.").text, "Fires on hit.");
    const e = errors(diagnostics);
    assert.equal(e.length, 1);
    assert.match(e[0].message, /"UChild.Gone" is not an id in data\/api/);
    assert.equal(e[0].line, 7);
    const w = diagnostics.filter((d) => d.severity === "warning");
    assert.equal(w.length, 1);
    assert.match(w[0].message, /stale/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sourceHash is stable", () => {
  assert.equal(sourceHash(""), "e3b0c44298fc");
  assert.equal(sourceHash("abc"), sourceHash("abc"));
  assert.notEqual(sourceHash("abc"), sourceHash("abd"));
});
