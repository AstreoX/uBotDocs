import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBlueprint, resolveBlueprint, compileBlueprint, findPin, suggestNodeIds } from "../lib/blueprint/graph.mjs";
import { tinyRegistry, site } from "./helpers.mjs";

const errors = (ds) => ds.filter((d) => d.severity === "error");
const warnings = (ds) => ds.filter((d) => d.severity === "warning");

test("parser: nodes, wires, notes and caption", () => {
  const src = [
    "caption: 示例",
    "nodes:",
    "  A: UChild.OnHit",
    "  B: { ref: Break:FData, at: [1, 0], hideUnconnected: true }",
    "  V: { var: Me, class: UChild }",
    "  F: { ref: UChild.Fire, set: { Power: 2.5 } }",
    "wires:",
    "  - A.then -> F.execute",
    "  - A.Data -> B.Data",
    "notes:",
    "  B: 拆开",
  ].join("\n");
  const { model, diagnostics } = parseBlueprint(src, { startLine: 10 });
  assert.deepEqual(errors(diagnostics), []);
  assert.equal(model.caption, "示例");
  assert.deepEqual(model.nodes.map((n) => n.key), ["A", "B", "V", "F"]);
  assert.equal(model.nodes[0].ref, "UChild.OnHit");
  assert.deepEqual(model.nodes[1].at, [1, 0]);
  assert.equal(model.nodes[1].hideUnconnected, true);
  assert.deepEqual(model.nodes[2].variable, { name: "Me", classId: "UChild" });
  assert.deepEqual(model.nodes[3].set, { Power: "2.5" });
  assert.deepEqual(model.wires[0].from, { node: "A", pin: "then" });
  assert.deepEqual(model.wires[1].to, { node: "B", pin: "Data" });
  assert.equal(model.wires[0].line, 18, "wire lines are page lines (fence line + YAML line)");
  assert.deepEqual(model.notes, [{ key: "B", text: "拆开", line: 21 }]);
});

test("parser: pin names with spaces and parentheses", () => {
  const { model } = parseBlueprint("nodes:\n  A: X\nwires:\n  - A.X (Roll) -> B.In Value\n");
  assert.deepEqual(model.wires[0].from, { node: "A", pin: "X (Roll)" });
  assert.deepEqual(model.wires[0].to, { node: "B", pin: "In Value" });
});

test("parser: malformed input is reported with page lines", () => {
  const bad = parseBlueprint("nodes:\n  A: X\nwires:\n  - A.then B.exec\n", { startLine: 4 });
  assert.equal(errors(bad.diagnostics).length, 1);
  assert.equal(bad.diagnostics[0].line, 8);
  assert.match(bad.diagnostics[0].message, /must look like/);

  const yaml = parseBlueprint("nodes:\n  A: [unclosed\n", { startLine: 1 });
  assert.ok(errors(yaml.diagnostics).length >= 1);

  const unknownKey = parseBlueprint("nodez:\n  A: X\n");
  assert.ok(unknownKey.diagnostics.some((d) => /unknown key "nodez"/.test(d.message)));

  const dup = parseBlueprint("nodes:\n  A: X\n  A: Y\n");
  assert.ok(errors(dup.diagnostics).length >= 1);

  const twoForms = parseBlueprint("nodes:\n  A: { ref: X, var: Y, class: Z }\n");
  assert.ok(twoForms.diagnostics.some((d) => /exactly one of ref, inline or var/.test(d.message)));

  const badAt = parseBlueprint("nodes:\n  A: { ref: X, at: [1] }\n");
  assert.ok(badAt.diagnostics.some((d) => /at must be/.test(d.message)));
});

test("pin resolution: id, display name (case and spaces ignored) and exec aliases", () => {
  const r = tinyRegistry();
  const fire = r.node("UChild.Fire");
  assert.equal(findPin(fire, "in", "self").id, "self");
  assert.equal(findPin(fire, "in", "Target").id, "self");
  assert.equal(findPin(fire, "in", "target").id, "self");
  assert.equal(findPin(fire, "out", "return value").id, "ReturnValue");
  assert.equal(findPin(fire, "out", "ReturnValue").id, "ReturnValue");
  assert.equal(findPin(fire, "in", "exec").id, "execute");
  assert.equal(findPin(fire, "in", "in").id, "execute");
  assert.equal(findPin(fire, "out", "out").id, "then");
  assert.equal(findPin(fire, "out", "then").id, "then");
  assert.equal(findPin(fire, "in", "Nope"), null);
  const branch = r.node("K2Node_IfThenElse");
  assert.equal(findPin(branch, "out", "True").id, "then");
  assert.equal(findPin(branch, "out", "false").id, "else");
  const brk = r.node("Break:FData");
  assert.equal(findPin(brk, "out", "Ok").id, "bOk");
  assert.equal(findPin(brk, "out", "bOk").id, "bOk");
});

test("validation: a correct graph has no findings", () => {
  const src = "nodes:\n  A: UChild.OnHit\n  B: Break:FData\n  C: K2Node_IfThenElse\nwires:\n  - A.then -> C.exec\n  - A.Data -> B.Data\n  - B.Ok -> C.Condition\n";
  const { graph, diagnostics } = compileBlueprint(src, tinyRegistry());
  assert.deepEqual(diagnostics, []);
  assert.equal(graph.wires.length, 3);
  assert.equal(graph.wires[0].exec, true);
});

test("validation: unknown node ids suggest close matches", () => {
  const { diagnostics } = compileBlueprint("nodes:\n  A: UChild.Fir\n", tinyRegistry(), { file: "x.mdx", startLine: 3 });
  const e = errors(diagnostics);
  assert.equal(e.length, 1);
  assert.equal(e[0].file, "x.mdx");
  assert.equal(e[0].line, 5);
  assert.match(e[0].message, /unknown id "UChild.Fir".*Did you mean "UChild.Fire"/);
  assert.deepEqual(suggestNodeIds(tinyRegistry(), "UChild.GetValu"), ["UChild.GetValue"]);
});

test("validation: unknown pins, wrong direction, exec to data", () => {
  const r = tinyRegistry();
  const unknown = compileBlueprint("nodes:\n  A: UChild.OnHit\n  B: Break:FData\nwires:\n  - A.Dta -> B.Data\n", r);
  assert.match(errors(unknown.diagnostics)[0].message, /has no output "Dta". Outputs: /);

  const backwards = compileBlueprint("nodes:\n  A: UChild.OnHit\n  B: Break:FData\nwires:\n  - B.Data -> A.Data\n", r);
  const msgs = errors(backwards.diagnostics).map((d) => d.message).join("\n");
  assert.match(msgs, /B\.Data is an input; wires go from an output to an input/);
  assert.match(msgs, /A\.Data is an output/);

  const mixed = compileBlueprint("nodes:\n  A: UChild.OnHit\n  C: K2Node_IfThenElse\nwires:\n  - A.Data -> C.exec\n", r);
  assert.match(errors(mixed.diagnostics)[0].message, /exec pin to a data pin/);
});

test("validation: one wire per data input, one wire per exec output", () => {
  const r = tinyRegistry();
  const twoIn = compileBlueprint(
    "nodes:\n  A: Break:FData\n  B: Break:FData\n  C: K2Node_IfThenElse\nwires:\n  - A.Ok -> C.Condition\n  - B.Ok -> C.Condition\n",
    r,
  );
  assert.equal(errors(twoIn.diagnostics).length, 1);
  assert.match(errors(twoIn.diagnostics)[0].message, /data input C\.Condition already has a wire \(line 6\)/);

  const twoOut = compileBlueprint(
    "nodes:\n  A: UChild.OnHit\n  B: UChild.Fire\n  C: UChild.Fire\nwires:\n  - A.then -> B.exec\n  - A.then -> C.exec\n",
    r,
  );
  assert.equal(errors(twoOut.diagnostics).length, 1);
  assert.match(errors(twoOut.diagnostics)[0].message, /exec output A\.then already has a wire/);

  // fan-out of a data output and fan-in of exec inputs are allowed, as in UE
  const fan = compileBlueprint(
    "nodes:\n  A: UChild.OnHit\n  T: UBase.Tick\n  B: UChild.Fire\n  X: Break:FData\n  Y: Break:FData\nwires:\n  - A.then -> B.exec\n  - T.then -> B.exec\n  - A.Data -> X.Data\n  - A.Data -> Y.Data\n",
    r,
  );
  assert.deepEqual(errors(fan.diagnostics), []);
});

test("validation: type mismatches and inline nodes are warnings", () => {
  const r = tinyRegistry();
  const mismatch = compileBlueprint("nodes:\n  A: Break:FData\n  B: UChild.Fire\nwires:\n  - A.Ok -> B.Power\n", r);
  assert.deepEqual(errors(mismatch.diagnostics), []);
  assert.match(warnings(mismatch.diagnostics)[0].message, /type mismatch Boolean -> Float/);

  const inline = compileBlueprint(
    "nodes:\n  A: UChild.OnHit\n  E: { inline: { title: My Function, kind: call, inputs: [{ name: '', type: exec }, { name: Amount, type: 'float' }], outputs: [{ name: '', type: exec }] } }\nwires:\n  - A.then -> E.execute\n",
    r,
  );
  assert.deepEqual(errors(inline.diagnostics), []);
  assert.equal(warnings(inline.diagnostics).length, 1);
  assert.match(warnings(inline.diagnostics)[0].message, /inline node/);
  assert.equal(inline.graph.nodes[1].def.inputs[1].id, "Amount");

  const badInline = compileBlueprint("nodes:\n  E: { inline: { title: X, kind: call, inputs: [{ name: A, type: floaty }] } }\n", r);
  assert.ok(errors(badInline.diagnostics).some((d) => /unknown type "floaty"/.test(d.message)));
});

test("validation: subclasses connect to parent-typed pins; float and double are compatible", () => {
  const r = tinyRegistry();
  assert.equal(r.isChildOf("UChild", "UBase"), true);
  assert.equal(r.isChildOf("UBase", "UChild"), undefined, "the chain leaves the exported classes");
  assert.equal(r.isChildOf("UChild", "UUnknown"), undefined);
  const { diagnostics } = compileBlueprint("nodes:\n  V: { var: Me, class: UChild }\n  G: UChild.GetValue\nwires:\n  - V.Me -> G.Target\n", r);
  assert.deepEqual(diagnostics, []);
});

test("validation: var, set and notes are checked", () => {
  const r = tinyRegistry();
  const badVar = compileBlueprint("nodes:\n  V: { var: Me, class: UNope }\n", r);
  assert.match(errors(badVar.diagnostics)[0].message, /var class "UNope"/);
  const badSet = compileBlueprint("nodes:\n  F: { ref: UChild.Fire, set: { Strength: 3 } }\n", r);
  assert.match(errors(badSet.diagnostics)[0].message, /set names unknown input "Strength"/);
  const okSet = compileBlueprint("nodes:\n  F: { ref: UChild.Fire, set: { Label: hello } }\n", r);
  assert.deepEqual(okSet.graph.nodes[0].values, { Label: "hello" });
  const badNote = compileBlueprint("nodes:\n  A: UChild.OnHit\nnotes:\n  Z: 没有这个节点\n", r);
  assert.match(errors(badNote.diagnostics)[0].message, /note for Z/);
  const notes = compileBlueprint("nodes:\n  A: UChild.OnHit\n  B: Break:FData\nnotes:\n  B: 第一\n  A: 第二\n", r);
  assert.equal(notes.graph.nodes.find((n) => n.key === "B").noteIndex, 1);
  assert.equal(notes.graph.nodes.find((n) => n.key === "A").noteIndex, 2);
});

test("validation: duplicate manual positions are errors", () => {
  const { diagnostics } = compileBlueprint("nodes:\n  A: { ref: UChild.OnHit, at: [0, 0] }\n  B: { ref: Break:FData, at: [0, 0] }\n", tinyRegistry());
  assert.match(errors(diagnostics)[0].message, /both placed at \[0,0\]/);
});

test("the repository's API data resolves the sample graphs' nodes", () => {
  const { registry } = site();
  const src = [
    "nodes:",
    "  A: UUBotImuSensorComponent.OnImuDataUpdated",
    "  B: Break:FUBotImuSensorData",
    "  C: UKismetMathLibrary.Quat_Rotator",
    "  D: UKismetMathLibrary.BreakRotator",
    "wires:",
    "  - A.Data -> B.UBotImuSensorData",
    "  - B.Orientation Quaternion -> C.Q",
    "  - C.ReturnValue -> D.Rotation",
  ].join("\n");
  const { graph, diagnostics } = compileBlueprint(src, registry);
  assert.deepEqual(diagnostics, []);
  assert.equal(graph.wires[2].to.pin.id, "InRot");
  const resolved = resolveBlueprint(parseBlueprint("nodes:\n  A: UUBotImuSensorComponent.GetLatestIMUData\n").model, registry);
  assert.equal(resolved.graph.nodes[0].def.title, "Get Latest IMUData");
});

test("component: gives a component's event the editor's bound-event title", () => {
  const { registry } = site();
  const node = (spec) => compileBlueprint(`nodes:\n  A: ${spec}\n`, registry);
  const ok = node("{ ref: UUBotImuSensorComponent.OnImuDataUpdated, component: IMU }");
  assert.deepEqual(ok.diagnostics, []);
  assert.equal(ok.graph.nodes[0].def.title, "On Imu Data Updated (IMU)");
  assert.equal(registry.node("UUBotImuSensorComponent.OnImuDataUpdated").title, "On Imu Data Updated", "the registry is not changed");
  const notEvent = node("{ ref: UUBotImuSensorComponent.GetLatestIMUData, component: IMU }");
  assert.match(errors(notEvent.diagnostics)[0].message, /component only applies to an event of a component class/);
  const actorEvent = node("{ ref: AActor.ReceiveBeginPlay, component: IMU }");
  assert.equal(errors(actorEvent.diagnostics).length, 1);
  const bad = node('{ ref: UUBotImuSensorComponent.OnImuDataUpdated, component: "IMU (1)" }');
  assert.match(errors(bad.diagnostics)[0].message, /component must be the component variable's name/);
});
