import { test } from "node:test";
import assert from "node:assert/strict";
import { compileBlueprint } from "../lib/blueprint/graph.mjs";
import { layoutGraph } from "../lib/blueprint/layout.mjs";
import { tinyRegistry, site } from "./helpers.mjs";

function layout(src, registry = tinyRegistry()) {
  const { graph, diagnostics } = compileBlueprint(src, registry);
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  const pos = layoutGraph(graph.nodes, graph.wires);
  return Object.fromEntries([...pos].map(([k, p]) => [k, [p.col, p.row]]));
}

function assertNoOverlap(pos) {
  const cells = Object.values(pos).map((p) => p.join(","));
  assert.equal(new Set(cells).size, cells.length, `two nodes share a cell: ${JSON.stringify(pos)}`);
}

test("columns follow wires from left to right", () => {
  const pos = layout("nodes:\n  A: UChild.OnHit\n  B: Break:FData\n  C: K2Node_IfThenElse\nwires:\n  - A.then -> C.exec\n  - A.Data -> B.Data\n  - B.Ok -> C.Condition\n");
  assert.ok(pos.A[0] < pos.B[0] && pos.B[0] < pos.C[0], JSON.stringify(pos));
  assertNoOverlap(pos);
});

test("every wire goes from a lower column to a higher one", () => {
  const src = "nodes:\n  T: UBase.Tick\n  V: { var: Me, class: UChild }\n  G: UChild.GetValue\n  B: Break:FData\n  F: UChild.Fire\nwires:\n  - T.then -> F.exec\n  - V.Me -> G.self\n  - G.ReturnValue -> B.Data\n  - B.Value -> F.Power\n";
  const { graph } = compileBlueprint(src, tinyRegistry());
  const pos = layoutGraph(graph.nodes, graph.wires);
  for (const w of graph.wires) assert.ok(pos.get(w.from.key).col < pos.get(w.to.key).col, `${w.from.key} -> ${w.to.key}`);
});

test("pure nodes sit next to their consumer, one row below the exec line", () => {
  const pos = layout("nodes:\n  T: UBase.Tick\n  V: { var: Me, class: UChild }\n  G: UChild.GetValue\n  B: Break:FData\n  F: UChild.Fire\nwires:\n  - T.then -> F.exec\n  - V.Me -> G.self\n  - G.ReturnValue -> B.Data\n  - B.Value -> F.Power\n");
  // exec line on row 0, the data chain below it
  assert.equal(pos.T[1], 0);
  assert.equal(pos.F[1], 0);
  assert.equal(pos.B[0], pos.F[0] - 1);
  assert.equal(pos.G[0], pos.B[0] - 1);
  assert.equal(pos.B[1], 1);
  assert.equal(pos.G[1], 1);
  assert.equal(pos.V[1], 1);
  assertNoOverlap(pos);
});

test("a chain without exec consumers stays on one row", () => {
  const pos = layout("nodes:\n  A: UChild.OnHit\n  B: Break:FData\nwires:\n  - A.Data -> B.Data\n");
  assert.deepEqual(pos, { A: [0, 0], B: [1, 0] });
});

test("unconnected nodes stack in the first column", () => {
  const pos = layout("nodes:\n  A: UChild.OnHit\n  B: Break:FData\n  C: K2Node_IfThenElse\n");
  assert.deepEqual(pos, { A: [0, 0], B: [0, 1], C: [0, 2] });
});

test("manual positions are kept and others avoid them", () => {
  const pos = layout("nodes:\n  A: { ref: UChild.OnHit, at: [0, 0] }\n  B: { ref: Break:FData, at: [3, 0] }\n  C: K2Node_IfThenElse\nwires:\n  - A.then -> C.exec\n");
  assert.deepEqual(pos.A, [0, 0]);
  assert.deepEqual(pos.B, [3, 0]);
  assert.deepEqual(pos.C, [1, 0]);
  assertNoOverlap(pos);
});

test("cycles do not hang the layout", () => {
  const src = "nodes:\n  A: UChild.Fire\n  B: UChild.Fire\nwires:\n  - A.then -> B.exec\n  - B.then -> A.exec\n";
  const pos = layout(src);
  assertNoOverlap(pos);
  assert.notEqual(pos.A[0], pos.B[0]);
});

test("sample guide graph: event, break, conversion and break rotator in one row", () => {
  const { registry } = site();
  const pos = layout(
    "nodes:\n  A: UUBotImuSensorComponent.OnImuDataUpdated\n  B: Break:FUBotImuSensorData\n  C: UKismetMathLibrary.Quat_Rotator\n  D: UKismetMathLibrary.BreakRotator\nwires:\n  - A.Data -> B.UBotImuSensorData\n  - B.OrientationQuaternion -> C.Q\n  - C.ReturnValue -> D.Rotation\n",
    registry,
  );
  assert.deepEqual(pos, { A: [0, 0], B: [1, 0], C: [2, 0], D: [3, 0] });
});
