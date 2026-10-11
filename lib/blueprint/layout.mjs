// Automatic placement of Blueprint graph nodes on a column/row grid.
//
// Columns follow the flow left to right: every wire (exec or data) goes from a lower column to a
// higher one, using longest-path layering. Nodes without exec pins (pure functions, break/make,
// variables) are then pulled right next to their first consumer, the way people place them in UE.
// Rows: each node prefers the row of the node that executes it (or feeds it), and nodes in one
// column never share a row. Manual positions ({ at: [col, row] }) are kept as given.

const hasExecPins = (def) => [...(def?.inputs ?? []), ...(def?.outputs ?? [])].some((p) => p.type?.category === "exec");

/**
 * @param {{key:string, def:object, at?:[number,number]|null}[]} nodes
 * @param {{from:{key:string}, to:{key:string}, exec:boolean}[]} wires
 * @returns {Map<string,{col:number,row:number}>}
 */
export function layoutGraph(nodes, wires) {
  const keys = nodes.map((n) => n.key);
  const order = new Map(keys.map((k, i) => [k, i]));
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const succ = new Map(keys.map((k) => [k, []]));
  const pred = new Map(keys.map((k) => [k, []]));
  for (const w of wires) {
    const a = w.from.key, b = w.to.key;
    if (a === b || !succ.has(a) || !succ.has(b)) continue;
    succ.get(a).push({ key: b, exec: w.exec });
    pred.get(b).push({ key: a, exec: w.exec });
  }

  // Drop back edges so the layering below always terminates (loops are rare in docs graphs).
  const state = new Map();
  const dropped = new Set();
  const visit = (k) => {
    state.set(k, 1);
    for (const s of succ.get(k)) {
      if (state.get(s.key) === 1) dropped.add(`${k}>${s.key}`);
      else if (!state.get(s.key)) visit(s.key);
    }
    state.set(k, 2);
  };
  for (const k of keys) if (!state.get(k)) visit(k);
  const live = (a, b) => !dropped.has(`${a}>${b}`);

  // Topological order (Kahn), stable by declaration order.
  const indeg = new Map(keys.map((k) => [k, pred.get(k).filter((p) => live(p.key, k)).length]));
  const ready = keys.filter((k) => indeg.get(k) === 0);
  const topo = [];
  while (ready.length) {
    ready.sort((a, b) => order.get(a) - order.get(b));
    const k = ready.shift();
    topo.push(k);
    for (const s of succ.get(k)) {
      if (!live(k, s.key)) continue;
      indeg.set(s.key, indeg.get(s.key) - 1);
      if (indeg.get(s.key) === 0) ready.push(s.key);
    }
  }

  const col = new Map();
  for (const k of topo) {
    const n = byKey.get(k);
    if (n.at) {
      col.set(k, n.at[0]);
      continue;
    }
    let c = 0;
    for (const p of pred.get(k)) if (live(p.key, k)) c = Math.max(c, (col.get(p.key) ?? 0) + 1);
    col.set(k, c);
  }
  // Pull exec-less nodes right, next to their earliest consumer.
  for (const k of [...topo].reverse()) {
    const n = byKey.get(k);
    if (n.at || hasExecPins(n.def)) continue;
    const consumers = succ.get(k).filter((s) => live(k, s.key)).map((s) => col.get(s.key));
    if (!consumers.length) continue;
    col.set(k, Math.max(col.get(k), Math.min(...consumers) - 1));
  }

  // Without manual positions, close gaps so columns are consecutive.
  if (!nodes.some((n) => n.at)) {
    const used = [...new Set(col.values())].sort((a, b) => a - b);
    const remap = new Map(used.map((c, i) => [c, i]));
    for (const k of keys) col.set(k, remap.get(col.get(k)));
  }

  const row = new Map();
  const taken = new Set();
  for (const n of nodes) if (n.at) {
    row.set(n.key, n.at[1]);
    taken.add(`${n.at[0]},${n.at[1]}`);
  }
  // Rows. Nodes with exec pins form the main line and follow the node that executes them;
  // exec-less nodes hang one row below the exec node they feed (or share the row of the pure node
  // they feed), the way people lay graphs out in UE. A cell holds one node; later nodes move down.
  const execNode = (k) => hasExecPins(byKey.get(k).def);
  const auto = (k) => !byKey.get(k).at;
  const place = (k, desired) => {
    const c = col.get(k);
    let r = Math.max(0, desired);
    while (taken.has(`${c},${r}`)) r++;
    taken.add(`${c},${r}`);
    row.set(k, r);
  };
  const leftToRight = (list) => list.sort((a, b) => col.get(a) - col.get(b) || order.get(a) - order.get(b));
  let nextSourceRow = 0;

  // 1. exec nodes, left to right
  for (const k of leftToRight(keys.filter((k) => auto(k) && execNode(k)))) {
    const execPred = pred.get(k).find((p) => p.exec && row.has(p.key));
    if (execPred) place(k, row.get(execPred.key));
    else {
      place(k, nextSourceRow);
      nextSourceRow = row.get(k) + 2;
    }
  }
  // 2. exec-less nodes that feed something already placed, consumers first
  for (const k of [...topo].reverse()) {
    if (!auto(k) || execNode(k) || row.has(k)) continue;
    const consumers = succ.get(k).filter((s) => live(k, s.key) && row.has(s.key));
    if (!consumers.length) continue;
    place(k, Math.min(...consumers.map((s) => (execNode(s.key) ? row.get(s.key) + 1 : row.get(s.key)))));
  }
  // 3. everything else, left to right, on the row of its first placed predecessor
  for (const k of leftToRight(keys.filter((k) => auto(k) && !row.has(k)))) {
    const ps = pred.get(k).filter((p) => row.has(p.key));
    place(k, ps.length ? Math.min(...ps.map((p) => row.get(p.key))) : 0);
  }

  const result = new Map();
  for (const k of keys) result.set(k, { col: col.get(k), row: row.get(k) });
  return result;
}
