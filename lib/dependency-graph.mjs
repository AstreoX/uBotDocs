// Layout of the plugin dependency graph (components/DependencyGraph.astro): the same drawing as the
// "依赖图" view of uBot Manager (app/src/lib/graphLayout.ts, whose geometry and edge routing this
// follows), without its layers. Cards stand in columns by dependency depth, from left to right:
// a package without dependencies is in column 0, any other one one column right of the deepest
// package it requires. An arrow runs from a dependency to its dependent ("A -> B": B depends on A),
// orthogonal, with ports spread along the card edges. When one package is the only one in column 0
// and every other package requires it (uBotCore), it is drawn as one tall card spanning all rows and
// its arrows are left out ("所有 Package 都依赖").
//
// Pure geometry, no HTML: tests check the layout, the component draws it.
//
//   layoutDependencyGraph([{ name: "UBotCore", planned: false, requires: [] },
//                          { name: "UBotSensor", planned: false, requires: ["UBotCore"] }])
//   -> { nodes: [{ name, col, row, x, y, w, h, tall, planned }], edges: [{ id, from, to, path }],
//        columns: [{ x, w }], width, height, collapsed }

export const GEOMETRY = {
  MARGIN: 48,
  COLUMN_GAP: 96,
  CARD_W: 200,
  TALL_W: 160,
  CARD_H: 72,
  ROW_PITCH: 120,
  TOP: 48,
  /** Spacing of the lanes above the first row that carry edges past cards in between. */
  LANE_PITCH: 8,
  ARROW: 5,
  /** A port keeps this far from the top and bottom edge of its card. */
  PORT_MARGIN: 8,
  /** Horizontal runs of different edges that overlap in x keep at least this far apart in y. */
  TRACK: 8,
};
const { CARD_W, TALL_W, CARD_H, ROW_PITCH, LANE_PITCH, ARROW, PORT_MARGIN, TRACK } = GEOMETRY;

/** Released packages stand above planned ones in their column. */
const rank = (pkg) => (pkg.planned ? 1 : 0);

function runAt(points, at, owner) {
  const a = points[at];
  const b = points[at + 1];
  if (!a || !b || a[1] !== b[1] || a[0] === b[0]) return null;
  return { owner, y: a[1], lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]) };
}

/** Distance from `y` to the nearest run of another edge that shares part of the x range of `run`. */
function clearance(runs, run, y) {
  let nearest = Infinity;
  for (const other of runs) {
    if (other.owner !== run.owner && Math.min(other.hi, run.hi) - Math.max(other.lo, run.lo) > 0.5) {
      nearest = Math.min(nearest, Math.abs(other.y - y));
    }
  }
  return nearest;
}

/**
 * Where the run goes: its own y when other edges keep `TRACK` away, else the y on the card (inside the port
 * range `top`..`bottom`) that is clear of them, nearest to its own; on a crowded card, the one with the most room.
 * `toward` is where the edge's vertical leads: moving that way keeps the vertical from crossing the run it made way for.
 */
function freeY(run, top, bottom, runs, toward) {
  const score = (y) => Math.min(clearance(runs, run, y), TRACK);
  const cost = (y) => Math.abs(y - run.y) + (Math.sign(y - run.y) === -Math.sign(toward - run.y) ? 0.5 : 0);
  let best = run.y;
  let bestScore = score(best);
  if (bestScore >= TRACK) return best;
  for (let y = Math.ceil(top); y <= bottom; y++) {
    const s = score(y);
    if (s > bestScore || (s === bestScore && cost(y) < cost(best))) {
      best = y;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Ports are spread per card, without regard to the other cards, so an edge leaving a card and an edge
 * entering the next column can end up at the same height in the same gap and read as one wire (a false
 * dependency). Moves the stub of such an edge along its card to where the horizontal runs of other edges are at
 * least `TRACK` away, or as far from them as the card allows. A stub only moves when that gives it more room.
 * Straight edges and runs away from the cards stay where they are.
 */
function separateStubs(routes) {
  const runs = [];
  const movable = [];
  routes.forEach((route, owner) => {
    route.points.forEach((_, at) => {
      const run = runAt(route.points, at, owner);
      if (!run) return;
      runs.push(run);
      const stub = route.stubs.find((s) => s.at === at);
      if (stub) movable.push({ run, route, stub });
    });
  });
  for (const { run, route, stub } of movable) {
    const toward = (stub.at === 0 ? route.points[2] : route.points[stub.at - 1])?.[1] ?? run.y;
    const y = freeY(run, stub.node.y + PORT_MARGIN, stub.node.y + stub.node.h - PORT_MARGIN, runs, toward);
    if (y === run.y) continue;
    run.y = y;
    const a = route.points[stub.at];
    const b = route.points[stub.at + 1];
    if (a && b) {
      a[1] = y;
      b[1] = y;
    }
  }
}

function toPath(points) {
  const clean = [];
  for (const p of points) {
    const last = clean[clean.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) clean.push(p);
  }
  // Leave room for the arrow head on the last segment.
  const end = clean[clean.length - 1];
  const before = clean[clean.length - 2];
  if (end && before) {
    const dx = Math.sign(end[0] - before[0]);
    const dy = Math.sign(end[1] - before[1]);
    clean[clean.length - 1] = [end[0] - dx * ARROW, end[1] - dy * ARROW];
  }
  return clean.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
}

/**
 * Column of every package: the length of the longest chain of required packages below it. A cycle
 * (an error in the index, not drawn) is cut where it closes.
 */
export function dependencyDepths(packages) {
  const byName = new Map(packages.map((p) => [p.name.toLowerCase(), p]));
  const depth = new Map();
  const visiting = new Set();
  const visit = (pkg) => {
    if (depth.has(pkg.name)) return depth.get(pkg.name);
    if (visiting.has(pkg.name)) return 0;
    visiting.add(pkg.name);
    let d = 0;
    for (const r of pkg.requires) {
      const dep = byName.get(String(r).toLowerCase());
      if (dep && dep !== pkg) d = Math.max(d, visit(dep) + 1);
    }
    visiting.delete(pkg.name);
    depth.set(pkg.name, d);
    return d;
  };
  for (const p of packages) visit(p);
  return depth;
}

/**
 * @param packages [{ name, planned, requires: [name] }] in index order (optional dependencies already left out)
 * @param options `margin` (left, right and bottom), `top` (above the first row; lanes for arrows that
 *   pass cards in between push the cards further down) and `gap` (between columns), by default the
 *   Manager's 48, 48 and 96 px
 * @returns { nodes, edges, columns, width, height, collapsed }
 */
export function layoutDependencyGraph(packages, { margin: MARGIN = GEOMETRY.MARGIN, top: TOP = GEOMETRY.TOP, gap: COLUMN_GAP = GEOMETRY.COLUMN_GAP } = {}) {
  const byName = new Map(packages.map((p) => [p.name.toLowerCase(), p]));
  const depth = dependencyDepths(packages);
  const count = packages.length ? Math.max(...packages.map((p) => depth.get(p.name) ?? 0)) + 1 : 1;
  const columnsPkgs = Array.from({ length: count }, (_, col) =>
    packages
      .filter((p) => (depth.get(p.name) ?? 0) === col)
      .map((p, i) => ({ p, i }))
      .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
      .map((x) => x.p));

  const first = columnsPkgs[0] ?? [];
  const onlyRoot = first.length === 1 ? first[0] : undefined;
  const others = packages.filter((p) => p !== onlyRoot);
  const collapsed = onlyRoot && others.length > 0 && others.every((p) => p.requires.some((r) => String(r).toLowerCase() === onlyRoot.name.toLowerCase()))
    ? onlyRoot.name
    : null;

  const rows = Math.max(1, ...columnsPkgs.map((c, i) => (i === 0 && collapsed ? 1 : c.length)));
  const columns = [];
  let x = MARGIN;
  columnsPkgs.forEach((_, i) => {
    const w = i === 0 && collapsed ? TALL_W : CARD_W;
    columns.push({ x, w });
    x += w + COLUMN_GAP;
  });

  const nodes = [];
  columnsPkgs.forEach((list, col) => {
    const column = columns[col];
    list.forEach((pkg, row) => {
      const tall = collapsed === pkg.name;
      nodes.push({
        name: pkg.name, planned: Boolean(pkg.planned), col, row, tall,
        x: column.x, y: TOP + row * ROW_PITCH, w: column.w,
        h: tall ? rows * ROW_PITCH - (ROW_PITCH - CARD_H) : CARD_H,
      });
    });
  });
  const nodeOf = new Map(nodes.map((n) => [n.name, n]));

  // Collect edges: dependency -> dependent.
  const raw = [];
  for (const dst of nodes) {
    for (const r of byName.get(dst.name.toLowerCase())?.requires ?? []) {
      const depPkg = byName.get(String(r).toLowerCase());
      if (!depPkg || depPkg.name === collapsed || depPkg.name === dst.name) continue;
      const src = nodeOf.get(depPkg.name);
      if (!src) continue;
      let route = "through";
      if (dst.col <= src.col) route = "back";
      else if (dst.col > src.col + 1) {
        const blocked = nodes.some((n) => n.col > src.col && n.col < dst.col && n.y < src.y + src.h && n.y + n.h > src.y);
        if (blocked) route = "lane";
      }
      raw.push({ id: `${src.name}->${dst.name}`, src, dst, route });
    }
  }

  // Every lane needs its own track above the cards (the first one 24 px above them, the last at least 6 px
  // from the top); with more than three lanes the cards move down to make room.
  const laneCount = raw.filter((e) => e.route === "lane").length;
  const top = Math.max(TOP, 30 + (laneCount - 1) * LANE_PITCH);
  for (const node of nodes) node.y += top - TOP;

  // Right-side exit ports, ordered by where the edge goes.
  const exitY = new Map();
  for (const node of nodes) {
    const outs = raw.filter((e) => e.src === node && (e.route !== "lane" || node.row > 0))
      .sort((a, b) => a.dst.y - b.dst.y || a.dst.x - b.dst.x);
    outs.forEach((e, i) => exitY.set(e.id, node.y + (node.h * (i + 1)) / (outs.length + 1)));
  }
  // Straight edges: the exit port already lies within the target card.
  const straight = new Set(raw.filter((e) => {
    const y = exitY.get(e.id);
    return e.route === "through" && y !== undefined && y >= e.dst.y + 8 && y <= e.dst.y + e.dst.h - 8;
  }).map((e) => e.id));
  // Left-side entry ports for the remaining edges. An edge arriving from the top lane takes the first slot
  // without using it, so side entries stay clear of it.
  const entryY = new Map();
  for (const node of nodes) {
    const fromTop = (e) => e.route === "lane" && node.row === 0;
    const ins = raw.filter((e) => e.dst === node && !straight.has(e.id))
      .sort((a, b) => (fromTop(a) ? -Infinity : exitY.get(a.id) ?? a.src.y) - (fromTop(b) ? -Infinity : exitY.get(b.id) ?? b.src.y));
    ins.forEach((e, i) => {
      if (!fromTop(e)) entryY.set(e.id, node.y + (node.h * (i + 1)) / (ins.length + 1));
    });
  }
  // Vertical channels in the gap before each column; parallel segments are spread apart.
  const channelUse = new Map();
  const useChannel = (gapCol, id) => {
    const list = channelUse.get(gapCol) ?? [];
    list.push(id);
    channelUse.set(gapCol, list);
  };
  for (const e of raw) {
    if (straight.has(e.id)) continue;
    if (e.route === "through") useChannel(e.dst.col, e.id);
    else if (e.route === "lane") {
      if (e.src.row > 0) useChannel(e.src.col + 1, `${e.id}#out`);
      if (e.dst.row > 0) useChannel(e.dst.col, e.id);
    } else useChannel(e.src.col + 1, e.id);
  }
  const channelX = (gapCol, id) => {
    const column = columns[gapCol];
    const prev = columns[gapCol - 1];
    const mid = column && prev ? (prev.x + prev.w + column.x) / 2
      : prev ? prev.x + prev.w + MARGIN / 2 // right of the last column
        : (column?.x ?? MARGIN) - COLUMN_GAP / 2;
    const list = channelUse.get(gapCol) ?? [id];
    const i = Math.max(0, list.indexOf(id));
    return mid + (i - (list.length - 1) / 2) * 8;
  };

  let lanes = 0;
  // Ports on the top edge of a card (arrows to and from the lanes) take the next free slot, whichever
  // way they go, so an arrow arriving from a lane never runs on top of one leaving to another lane.
  const topPorts = new Map();
  const routes = raw.map((e) => {
    const { src, dst } = e;
    const sy = exitY.get(e.id) ?? src.y + src.h / 2;
    let points;
    const stubs = [];
    if (straight.has(e.id)) {
      points = [[src.x + src.w, sy], [dst.x, sy]];
    } else if (e.route === "through") {
      const cx = channelX(dst.col, e.id);
      const ty = entryY.get(e.id) ?? dst.y + dst.h / 2;
      points = [[src.x + src.w, sy], [cx, sy], [cx, ty], [dst.x, ty]];
      stubs.push({ at: 0, node: src }, { at: 2, node: dst });
    } else if (e.route === "lane") {
      const laneY = top - 24 - lanes++ * LANE_PITCH;
      points = [];
      if (src.row === 0) {
        const k = topPorts.get(src) ?? 0;
        topPorts.set(src, k + 1);
        const sx = src.x + src.w / 2 + k * 12;
        points.push([sx, src.y], [sx, laneY]);
      } else {
        const cx = channelX(src.col + 1, `${e.id}#out`);
        points.push([src.x + src.w, sy], [cx, sy], [cx, laneY]);
        stubs.push({ at: 0, node: src });
      }
      if (dst.row === 0) {
        const k = topPorts.get(dst) ?? 0;
        topPorts.set(dst, k + 1);
        const tx = dst.x + dst.w / 2 + k * 12;
        points.push([tx, laneY], [tx, dst.y]);
      } else {
        const cx = channelX(dst.col, e.id);
        const ty = entryY.get(e.id) ?? dst.y + dst.h / 2;
        points.push([cx, laneY], [cx, ty], [dst.x, ty]);
        stubs.push({ at: points.length - 2, node: dst });
      }
    } else {
      // Same column or a dependency on a later column: loop through the gap right of the source.
      const cx = channelX(src.col + 1, e.id);
      const ty = entryY.get(e.id) ?? dst.y + dst.h / 2;
      points = [[src.x + src.w, sy], [cx, sy], [cx, ty], [dst.x + dst.w, ty]];
      stubs.push({ at: 0, node: src }, { at: 2, node: dst });
    }
    return { raw: e, points, stubs };
  });
  separateStubs(routes);
  const edges = routes.map(({ raw: e, points }) => ({ id: e.id, from: e.src.name, to: e.dst.name, path: toPath(points) }));

  const bottom = top + rows * ROW_PITCH - (ROW_PITCH - CARD_H);
  const last = columns[columns.length - 1];
  return {
    nodes, edges, columns, collapsed,
    width: (last ? last.x + last.w : 0) + MARGIN,
    height: bottom + MARGIN,
  };
}
