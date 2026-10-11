// The layout of the plugin dependency graph (lib/dependency-graph.mjs, drawn by components/
// DependencyGraph.astro). It follows the "依赖图" view of uBot Manager (app/src/lib/graphLayout.ts),
// with columns by dependency depth instead of layers, so these tests are the Manager's: arrows never
// run on top of each other and stay inside the canvas, in the repository's own graph and in many random
// ones. What is in the repository's graph is read from the registry, never written down here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GEOMETRY, dependencyDepths, layoutDependencyGraph } from "../lib/dependency-graph.mjs";
import { repoPackages } from "./helpers.mjs";

const pkg = (name, requires = [], planned = false) => ({ name, planned, requires });

/** The input of the component for a registry: every package in index order with its direct dependencies. */
const inputOf = (registry) => registry.list().map((p) => ({ name: p.name, planned: !p.released, requires: registry.dependencies(p.name, { transitive: false }) }));

/** The segments of every edge, from the `M x y L x y …` path strings. */
function segments(layout) {
  const out = [];
  for (const edge of layout.edges) {
    const points = [...edge.path.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    for (let i = 0; i + 1 < points.length; i++) out.push({ edge: edge.id, a: points[i], b: points[i + 1] });
  }
  return out;
}

const overlap = (a0, a1, b0, b1) => Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));

/** Pairs of segments of different edges that lie on top of each other, or horizontal ones closer than `minGap`. */
function collisions(layout, minGap = 8) {
  const segs = segments(layout);
  const found = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i];
      const q = segs[j];
      if (p.edge === q.edge) continue;
      if (p.a[1] === p.b[1] && q.a[1] === q.b[1] && Math.abs(p.a[1] - q.a[1]) < minGap && overlap(p.a[0], p.b[0], q.a[0], q.b[0]) > 0.5) {
        found.push(`${p.edge} / ${q.edge}: horizontal at y ${p.a[1]} and ${q.a[1]}`);
      }
      if (p.a[0] === p.b[0] && q.a[0] === q.b[0] && Math.abs(p.a[0] - q.a[0]) < 1 && overlap(p.a[1], p.b[1], q.a[1], q.b[1]) > 0.5) {
        found.push(`${p.edge} / ${q.edge}: vertical at x ${p.a[0]}`);
      }
    }
  }
  return found;
}

/** Path points that lie outside the canvas. */
const outside = (layout) => segments(layout)
  .flatMap((seg) => [seg.a, seg.b].map((p) => ({ edge: seg.edge, p })))
  .filter(({ p }) => p[0] < 0 || p[1] < 0 || p[0] > layout.width || p[1] > layout.height)
  .map(({ edge, p }) => `${edge} at ${p[0]},${p[1]}`);

/** Cards that overlap each other. */
function overlappingCards(layout) {
  const found = [];
  for (const [i, a] of layout.nodes.entries()) {
    for (const b of layout.nodes.slice(i + 1)) {
      if (overlap(a.x, a.x + a.w, b.x, b.x + b.w) > 0 && overlap(a.y, a.y + a.h, b.y, b.y + b.h) > 0) found.push(`${a.name} / ${b.name}`);
    }
  }
  return found;
}

test("columns are dependency depths: a package stands one column right of the deepest package it requires", () => {
  const packages = [pkg("Core"), pkg("Sensor", ["Core"]), pkg("Ros", ["Core", "Sensor"]), pkg("Combat", ["Core", "Sensor", "Env"]), pkg("Env", ["Core"]), pkg("Lone")];
  const depth = dependencyDepths(packages);
  assert.deepEqual([...depth].sort(), [["Combat", 2], ["Core", 0], ["Env", 1], ["Lone", 0], ["Ros", 2], ["Sensor", 1]]);
  const layout = layoutDependencyGraph(packages);
  assert.deepEqual(layout.nodes.map((n) => [n.name, n.col]).sort(), [...depth].sort(), "the layout puts every package in its depth's column");
  assert.equal(layout.columns.length, 3);
  assert.equal(depth.get("Ros"), 2, "the longest chain counts, not the shortest");
});

test("A -> B means B depends on A: every arrow runs from a dependency to its dependent, to the right", () => {
  const packages = [pkg("A"), pkg("B", ["A"]), pkg("C", ["B"]), pkg("D", ["A", "C"])];
  const layout = layoutDependencyGraph(packages);
  assert.deepEqual(layout.edges.map((e) => `${e.from}->${e.to}`).sort(), ["A->B", "A->D", "B->C", "C->D"]);
  const node = (name) => layout.nodes.find((n) => n.name === name);
  for (const e of layout.edges) assert.ok(node(e.from).col < node(e.to).col, `${e.id}: the dependent is to the right`);
  for (const e of layout.edges) {
    assert.match(e.path, /^M [\d.]+ [\d.]+( L [\d.]+ [\d.]+)+$/, "orthogonal path of straight segments");
    const points = [...e.path.matchAll(/([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    for (let i = 0; i + 1 < points.length; i++) assert.ok(points[i][0] === points[i + 1][0] || points[i][1] === points[i + 1][1], `${e.id}: only horizontal and vertical runs`);
  }
});

test("a package every other package requires, alone in the first column, is one tall card without arrows", () => {
  const packages = [pkg("Core"), pkg("Sensor", ["Core"]), pkg("Vehicles", ["Core"], true), pkg("Ros", ["Core", "Sensor"])];
  const layout = layoutDependencyGraph(packages);
  assert.equal(layout.collapsed, "Core");
  const core = layout.nodes.find((n) => n.name === "Core");
  assert.deepEqual([core.tall, core.col, core.w], [true, 0, GEOMETRY.TALL_W]);
  const rows = Math.max(...layout.nodes.map((n) => n.row)) + 1;
  assert.equal(rows, 2, "the second column has two cards: Sensor and the planned Vehicles");
  const bottom = Math.max(...layout.nodes.filter((n) => !n.tall).map((n) => n.y + n.h));
  assert.equal(core.y + core.h, bottom, "the tall card spans every row");
  assert.deepEqual(layout.edges.map((e) => e.id), ["Sensor->Ros"], "no arrows into or out of the collapsed package");
  assert.equal(layoutDependencyGraph([pkg("Core"), pkg("Sensor", ["Core"]), pkg("Other")]).collapsed, null, "not when a package does not require it");
  assert.equal(layoutDependencyGraph([pkg("Core"), pkg("Core2")]).collapsed, null, "not when the first column has two packages");
  assert.equal(layoutDependencyGraph([pkg("Core")]).collapsed, null, "not for a single package");
});

test("released packages stand above planned ones in their column, each group in index order", () => {
  const packages = [pkg("Core"), pkg("P1", ["Core"], true), pkg("R1", ["Core"]), pkg("P2", ["Core"], true), pkg("R2", ["Core"])];
  const column = layoutDependencyGraph(packages).nodes.filter((n) => n.col === 1).sort((a, b) => a.row - b.row);
  assert.deepEqual(column.map((n) => n.name), ["R1", "R2", "P1", "P2"]);
  assert.deepEqual(column.map((n) => n.planned), [false, false, true, true]);
});

test("the geometry is the Manager's, and the margins can be tightened", () => {
  const packages = [pkg("Core"), pkg("Sensor", ["Core"]), pkg("Ros", ["Core", "Sensor"])];
  const wide = layoutDependencyGraph(packages);
  const { MARGIN, COLUMN_GAP, CARD_W, TALL_W, CARD_H, ROW_PITCH, TOP } = GEOMETRY;
  assert.equal(wide.width, MARGIN + TALL_W + COLUMN_GAP + CARD_W + COLUMN_GAP + CARD_W + MARGIN);
  assert.deepEqual(wide.nodes.map((n) => [n.name, n.x, n.y, n.w, n.h]).sort(), [
    ["Core", MARGIN, TOP, TALL_W, CARD_H],
    ["Ros", MARGIN + TALL_W + COLUMN_GAP + CARD_W + COLUMN_GAP, TOP, CARD_W, CARD_H],
    ["Sensor", MARGIN + TALL_W + COLUMN_GAP, TOP, CARD_W, CARD_H],
  ].sort());
  assert.equal(wide.height, TOP + CARD_H + MARGIN);
  assert.equal(ROW_PITCH - CARD_H, 48, "rows are 120 px apart, cards 72 px high");
  const tight = layoutDependencyGraph(packages, { margin: 20, top: 24, gap: 80 });
  assert.equal(tight.width, 20 + TALL_W + 80 + CARD_W + 80 + CARD_W + 20);
  assert.equal(tight.nodes[0].x, 20);
  assert.equal(tight.height, 24 + CARD_H + 20);
  assert.deepEqual(collisions(tight), []);
});

test("an arrow that passes a card in an intermediate column runs in a lane above the cards", () => {
  // Base -> Mid -> Top, and Top also requires Base directly, which is two columns away with Mid's card in between
  const packages = [pkg("Base"), pkg("Other"), pkg("Mid", ["Base"]), pkg("Top", ["Base", "Mid"]), pkg("Side", ["Other"])];
  const layout = layoutDependencyGraph(packages);
  const lane = layout.edges.find((e) => e.id === "Base->Top");
  const ys = [...lane.path.matchAll(/[\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
  const firstRowTop = Math.min(...layout.nodes.map((n) => n.y));
  assert.ok(Math.min(...ys) < firstRowTop, "the lane is above the first row of cards");
  assert.deepEqual(collisions(layout), []);
  assert.deepEqual(outside(layout), []);
  assert.deepEqual(overlappingCards(layout), []);
});

test("a dependency cycle (an error in the index) does not hang the layout", () => {
  const layout = layoutDependencyGraph([pkg("A", ["B"]), pkg("B", ["A"]), pkg("C", ["A"])]);
  assert.equal(layout.nodes.length, 3);
  assert.deepEqual(outside(layout), []);
  assert.deepEqual(layoutDependencyGraph([]).nodes, [], "no packages, no cards");
  assert.deepEqual(layoutDependencyGraph([pkg("A", ["Unknown"])]).edges, [], "a dependency that is not in the index has no arrow");
});

test("the repository's graph: depths, one arrow per dependency, no overlaps, nothing outside the canvas", () => {
  const registry = repoPackages();
  const input = inputOf(registry);
  const layout = layoutDependencyGraph(input, { margin: 20, top: 24, gap: 80 });
  assert.equal(layout.nodes.length, registry.list().length, "every package has a card, released or planned");
  const depth = dependencyDepths(input);
  for (const n of layout.nodes) assert.equal(n.col, depth.get(n.name), `${n.name} stands in the column of its depth`);
  for (const p of input) for (const dep of p.requires) assert.ok(depth.get(p.name) > depth.get(dep), `${p.name} is right of ${dep}`);
  const expected = input.flatMap((p) => p.requires.filter((d) => d !== layout.collapsed && input.some((q) => q.name === d)).map((d) => `${d}->${p.name}`));
  assert.deepEqual(layout.edges.map((e) => e.id).sort(), expected.sort(), "one arrow per direct dependency, none for the tall card");
  assert.deepEqual(collisions(layout), []);
  assert.deepEqual(outside(layout), []);
  assert.deepEqual(overlappingCards(layout), []);
  for (const n of layout.nodes) assert.equal(n.planned, !registry.get(n.name).released, `${n.name}: planned cards are the ones without a release`);
  // released cards stand above planned ones in every column
  for (const col of new Set(layout.nodes.map((n) => n.col))) {
    const rows = layout.nodes.filter((n) => n.col === col && !n.tall).sort((a, b) => a.row - b.row).map((n) => n.planned);
    assert.deepEqual(rows, [...rows].sort((a, b) => Number(a) - Number(b)), `column ${col}: released first`);
  }
});

test("the layout stays clean in 500 random graphs of every shape (the Manager's property test)", () => {
  let seed = 20261010;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const failures = [];
  for (let round = 0; round < 500; round++) {
    // Packages in dependency order, each requiring up to three earlier ones: the shape of real indexes,
    // from a single card up to a crowded graph with several columns.
    const count = 3 + Math.floor(random() * 8);
    const packages = Array.from({ length: count }, (_, i) => {
      const requires = Array.from({ length: i }, (_, j) => j).filter(() => random() < 0.45).slice(0, 3).map((j) => `P${j}`);
      return pkg(`P${i}`, requires, random() < 0.4);
    });
    const layout = layoutDependencyGraph(packages);
    const found = collisions(layout, 4);
    if (found.length > 0) failures.push(`round ${round}: ${found[0]}`);
    const off = outside(layout);
    if (off.length > 0) failures.push(`round ${round}: outside the canvas: ${off[0]}`);
    const cards = overlappingCards(layout);
    if (cards.length > 0) failures.push(`round ${round}: cards overlap: ${cards[0]}`);
  }
  assert.deepEqual(failures, []);
});
