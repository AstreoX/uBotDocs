import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadZh, sourceHash, zhFileFor } from "../lib/blueprint/zh.mjs";
import { nodeOwnerId } from "../lib/blueprint/api.mjs";
import { root, site, tinyRegistry } from "./helpers.mjs";

const errors = (ds) => ds.filter((d) => d.severity === "error");

function withZh(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "ubot-zh-"));
  try {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("every item has an owner file: the class, struct or enum, a node's owner class, a Make/Break node's struct", () => {
  const items = tinyRegistry().describableIds();
  assert.equal(items.get("UChild").owner, "UChild");
  assert.equal(items.get("UChild.Fire").owner, "UChild");
  assert.equal(items.get("Break:FData").owner, "FData");
  assert.equal(items.get("K2Node_IfThenElse").owner, "K2Node_IfThenElse");
  assert.equal(zhFileFor(items.get("UChild.Fire")), "data/zh/Tiny/UChild.yaml");
  assert.equal(nodeOwnerId({ id: "Macro:ForLoop", kind: "node", owner: "" }), "Macro-ForLoop", "file names stay valid on Windows");
  const real = site().registry.describableIds();
  assert.equal(zhFileFor(real.get("UUBotImuSensorComponent.GetLatestIMUData")), "data/zh/UBotSensor/UUBotImuSensorComponent.yaml");
  assert.equal(zhFileFor(real.get("FUBotFrameHeader.Sequence")), "data/zh/UBotCore/FUBotFrameHeader.yaml");
  assert.equal(zhFileFor(real.get("UKismetMathLibrary.BreakRotator")), "data/zh/Engine/UKismetMathLibrary.yaml");
});

test("the per-class loader: fresh, stale and unknown entries", () => {
  withZh({
    "Tiny/UChild.yaml": [
      "UChild.Fire:", "  summary: 开火。", `  sourceHash: ${sourceHash("")}`,
      "UChild.GetValue:", "  summary: 旧说明。", "  sourceHash: 000000000000",
      "UChild.Gone:", "  summary: 已删除的节点。", "  sourceHash: 000000000000",
    ].join("\n"),
    "Tiny/.gitkeep": "",
  }, (dir) => {
    const { overlay, diagnostics } = loadZh(dir, tinyRegistry(), { root: dir, folders: new Set(["Tiny", "Engine"]) });
    assert.deepEqual(overlay.summary("UChild.Fire", ""), { text: "开火。", lang: "zh", stale: false });
    assert.deepEqual(overlay.summary("UChild.GetValue", ""), { text: "", lang: "en", stale: true });
    assert.equal(overlay.summary("UChild.OnHit", "Fires on hit.").text, "Fires on hit.");
    const e = errors(diagnostics);
    assert.equal(e.length, 1);
    assert.match(e[0].message, /"UChild.Gone" is not an id in data\/api/);
    assert.equal(e[0].file, "Tiny/UChild.yaml");
    assert.equal(e[0].line, 7);
    const w = diagnostics.filter((d) => d.severity === "warning");
    assert.equal(w.length, 1);
    assert.match(w[0].message, /stale/);
  });
});

test("files in the wrong place are errors that name the right file; the summary still loads", () => {
  withZh({
    "Tiny/UBase.yaml": ["UChild.Fire:", "  summary: 开火。", `  sourceHash: ${sourceHash("")}`].join("\n"),
    "Other/FData.yaml": ["FData:", "  summary: 数据。", `  sourceHash: ${sourceHash("")}`].join("\n"),
    "Tiny.yaml": ["UBase:", "  summary: 基类。", `  sourceHash: ${sourceHash("")}`].join("\n"),
    "Tiny/nested/UChild.yaml": "",
  }, (dir) => {
    const { overlay, diagnostics } = loadZh(dir, tinyRegistry(), { root: dir, folders: new Set(["Tiny", "Engine"]) });
    const msgs = errors(diagnostics).map((d) => `${d.file}: ${d.message}`).join("\n");
    assert.match(msgs, /Tiny\/UBase\.yaml: "UChild\.Fire" belongs in data\/zh\/Tiny\/UChild\.yaml/);
    assert.match(msgs, /Other\/: Other is not a package in data\/index\.json/);
    assert.match(msgs, /Other\/FData\.yaml: "FData" belongs in data\/zh\/Tiny\/FData\.yaml/);
    assert.match(msgs, /Tiny\.yaml: summaries live in data\/zh\/<Package>\/<Owner>\.yaml/);
    assert.match(msgs, /Tiny\/nested\/: nested folders are not read/);
    assert.equal(overlay.summary("UChild.Fire", "").text, "开火。");
    assert.equal(overlay.summary("UBase", "").text, "基类。");
  });
});

test("the repository's summaries are all in their owner's file", () => {
  const { overlay, diagnostics } = site();
  assert.deepEqual(diagnostics.filter((d) => d.file.startsWith("data/zh")), []);
  assert.ok(overlay.entries.size > 0);
  for (const [id, e] of overlay.entries) assert.match(e.file, /^data\/zh\/[A-Za-z]+\/[A-Za-z0-9_.-]+\.yaml$/, id);
  assert.deepEqual(readdirSync(join(root, "data", "zh")).filter((f) => f.endsWith(".yaml")), [], "no top-level files");
});
