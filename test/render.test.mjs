import { test } from "node:test";
import assert from "node:assert/strict";
import { compileBlueprint } from "../lib/blueprint/graph.mjs";
import { renderGraph, renderWireList, renderNode, renderStandaloneNode, pinGlyph, visiblePins } from "../lib/blueprint/render.mjs";
import { nodeLocation } from "../lib/blueprint/paths.mjs";
import { tinyRegistry, site } from "./helpers.mjs";

test("nodes are buttons with an accessible name, kind class and pin endpoints", () => {
  const r = tinyRegistry();
  const html = renderNode(r.node("UChild.Fire"), { key: "F", interactive: true, connected: new Set(["F:i:0"]) });
  assert.match(html, /^<button class="bp-node k-call" type="button" data-key="F" aria-haspopup="dialog"/);
  assert.match(html, /aria-label="Fire，函数节点。打开说明"/);
  assert.match(html, /data-pin="F:i:0"/);
  assert.match(html, /Target is Child/);
  // advanced pins are folded away like in UE
  assert.doesNotMatch(html, />Label</);
  assert.match(html, /bp-adv/);
});

test("connected pins are filled, unconnected pins hollow, arrays drawn as grids", () => {
  const exec = { category: "exec", subtype: "", subtypeDisplay: "", container: "none", valueType: null, byRef: false, const: false };
  assert.match(pinGlyph(exec, { on: true }), /fill="#f2f2f2"/);
  assert.match(pinGlyph(exec, { on: false }), /fill="none"/);
  const float = { ...exec, category: "float" };
  assert.match(pinGlyph(float, { on: false }), /<circle[^>]*fill="none"/);
  assert.match(pinGlyph(float, { on: true }), /<circle[^>]*fill="#8fd13f"/);
  const arr = pinGlyph({ ...float, container: "array" }, {});
  assert.equal((arr.match(/<rect/g) ?? []).length, 9);
});

test("graphs render cards with reference links, notes and wire data", () => {
  const { registry, overlay } = site();
  const src = "caption: 测试\nnodes:\n  A: UUBotImuSensorComponent.OnImuDataUpdated\n  B: { ref: Break:FUBotImuSensorData, hideUnconnected: true }\nwires:\n  - A.Data -> B.UBotImuSensorData\nnotes:\n  B: 说明\n";
  const { graph, diagnostics } = compileBlueprint(src, registry);
  assert.deepEqual(diagnostics, []);
  const html = renderGraph(graph, { graphId: "bp-1", registry, overlay });
  assert.match(html, /<figure class="bp-figure not-content" id="bp-1" data-bp-graph>/);
  assert.match(html, /<figcaption class="bp-caption">测试<\/figcaption>/);
  assert.match(html, /data-card="bp-1-A"/);
  assert.match(html, /href="\/reference\/ubotsensor\/uubotimusensorcomponent\/#OnImuDataUpdated"/);
  assert.match(html, /href="\/reference\/ubotsensor\/structs\/fubotimusensordata\/#Break"/);
  assert.match(html, /class="bp-note-badge" aria-hidden="true">1</);
  assert.match(html, /data-pagefind-ignore="all"/);
  // Chinese summary from data/zh is used when its sourceHash matches
  assert.match(html, /每次 IMU 采样后触发/);
  // hidden unconnected outputs: only Orientation Quaternion's sibling pins are gone
  assert.doesNotMatch(html.split('<div class="bp-cards"')[0], />Angular Velocity Rad Per Second</);
  const wires = JSON.parse(/data-wires="([^"]*)"/.exec(html)[1].replace(/&quot;/g, '"'));
  assert.deepEqual(wires[0].slice(0, 2), ["A:o:1", "B:i:0"]);
});

test("the HTML is a single line (safe as a Markdown HTML block)", () => {
  const { registry, overlay } = site();
  const { graph } = compileBlueprint("nodes:\n  A: UKismetSystemLibrary.PrintString\n", registry);
  const html = renderGraph(graph, { graphId: "g", registry, overlay });
  assert.ok(!html.includes("\n"));
  assert.ok(!renderStandaloneNode(registry.node("UKismetSystemLibrary.PrintString")).includes("\n"));
});

test("reference locations of nodes", () => {
  const { registry } = site();
  assert.equal(nodeLocation(registry, "UUBotImuSensorComponent.GetLatestIMUData").href, "/reference/ubotsensor/uubotimusensorcomponent/#GetLatestIMUData");
  assert.equal(nodeLocation(registry, "Break:FUBotFrameHeader").href, "/reference/ubotcore/structs/fubotframeheader/#Break");
  assert.equal(nodeLocation(registry, "UKismetMathLibrary.Quat_Rotator").href, "/reference/engine/#UKismetMathLibrary-Quat_Rotator");
  assert.equal(nodeLocation(registry, "K2Node_IfThenElse").href, "/reference/engine/#K2Node_IfThenElse");
  assert.equal(nodeLocation(registry, "Nope"), null);
});

test("event nodes show the delegate square in the title bar even without a delegate pin", () => {
  const { registry } = site();
  const html = renderNode(registry.node("AActor.ReceiveTick"), { key: "T", interactive: true });
  assert.match(html, /<span class="bp-hdpin"><span class="bp-pin bp-po"><svg class="bp-g" viewBox="0 0 12 12" aria-hidden="true"><rect/);
  assert.doesNotMatch(html, /data-pin="T:o:-1"/);
});

test("only mutable references are diamonds; const references are circles without a value box", () => {
  const vec = { category: "vector", subtype: "", subtypeDisplay: "", container: "none", valueType: null, byRef: true, const: true };
  assert.match(pinGlyph(vec, {}), /<circle/, "const FVector& is drawn as a circle (SGraphPin::IsByMutableRef)");
  assert.match(pinGlyph({ ...vec, const: false }, {}), /<path d="M6 1.2/, "UPARAM(ref) is a diamond");
  const { registry } = site();
  // UUBotConventionsLibrary.PositionUEToROS takes const FVector&: no diamond and no 0, 0, 0 box.
  const html = renderNode(registry.node("UUBotConventionsLibrary.PositionUEToROS"), { key: "P" });
  assert.doesNotMatch(html, /M6 1.2 10.8 6/);
  assert.doesNotMatch(html, /bp-val/);
  // Break nodes take their struct by const reference: a circle.
  assert.doesNotMatch(renderNode(registry.node("Break:FUBotFrameHeader"), { key: "B" }), /M6 1.2 10.8 6/);
});

test("break nodes fold fields from the fourth pin on, and hidden pins do not count", () => {
  const { registry } = site();
  const header = registry.node("Break:FUBotFrameHeader");
  const names = (v) => v.outputs.map(({ pin }) => pin.name);
  // Exported as the editor draws it: two fields, then the advanced section.
  const plain = visiblePins(header, { key: "B" });
  assert.deepEqual(names(plain), ["Sensor Id", "Frame Id"]);
  assert.equal(plain.arrow, "down");
  // A wired advanced pin stays visible in the collapsed section.
  const wired = visiblePins(header, { key: "B", connected: new Set(["B:o:4"]) });
  assert.deepEqual(names(wired), ["Sensor Id", "Frame Id", "Valid"]);
  assert.equal(wired.arrow, "down");
  // Pin options leave two pins on the node: no advanced section (UK2Node_BreakStruct needs > 5 pins).
  const hidden = visiblePins(header, { key: "B", hideUnconnected: true, connected: new Set(["B:o:2", "B:i:0"]) });
  assert.deepEqual(names(hidden), ["Sequence"]);
  assert.equal(hidden.inputs.length, 1, "the struct input always exists");
  assert.equal(hidden.arrow, "");
});

test("a set: value on an advanced pin shows the expanded advanced section", () => {
  const { registry } = site();
  const print = registry.node("UKismetSystemLibrary.PrintString");
  const collapsed = visiblePins(print, { key: "P" });
  assert.deepEqual(collapsed.inputs.map(({ pin }) => pin.id), ["execute", "InString"]);
  assert.equal(collapsed.arrow, "down");
  const expanded = visiblePins(print, { key: "P", values: { Key: "imu" } });
  assert.deepEqual(expanded.inputs.map(({ pin }) => pin.id), ["execute", "InString", "bPrintToScreen", "bPrintToLog", "TextColor", "Duration", "Key"]);
  assert.equal(expanded.arrow, "up");
  assert.match(renderNode(print, { key: "P", values: { Key: "imu" } }), /bp-val bp-text">imu</);
});

test("graphs list their wires as text for screen readers", () => {
  const { registry, overlay } = site();
  const src = "nodes:\n  A: UUBotImuSensorComponent.OnImuDataUpdated\n  B: { ref: Break:FUBotImuSensorData, hideUnconnected: true }\n  C: UKismetSystemLibrary.PrintString\nwires:\n  - A.Data -> B.UBotImuSensorData\n  - A.then -> C.execute\n";
  const { graph, diagnostics } = compileBlueprint(src, registry);
  assert.deepEqual(diagnostics, []);
  const html = renderGraph(graph, { graphId: "bp-1", registry, overlay });
  const list = /<div class="bp-sr"[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? "";
  assert.match(list, /<li>On Imu Data Updated 的 Data，连到 Break UBot Imu Sensor Data 的 UBot Imu Sensor Data<\/li>/);
  assert.match(list, /<li>On Imu Data Updated 的 执行，连到 Print String 的 执行<\/li>/);
  assert.equal(renderWireList(compileBlueprint("nodes:\n  A: UKismetSystemLibrary.PrintString\n", registry).graph), "", "no wires, no list");
});
