// ```blueprint blocks: YAML parsing, node/pin resolution against data/api and validation.
//
// caption: 事件方式读取姿态角
// nodes:
//   A: UUBotImuSensorComponent.OnImuDataUpdated
//   B: { ref: Break:FUBotImuSensorData, hideUnconnected: true }
//   V: { var: IMU, class: UUBotImuSensorComponent }          # variable / component reference getter
//   E: { inline: { title: My Function, kind: call, inputs: [{ name: "", type: exec }], outputs: [{ name: "", type: exec }] } }
//   F: { ref: UKismetSystemLibrary.PrintString, set: { Key: imu } }   # pin default shown on the node
//   G: { ref: UUBotImuSensorComponent.OnImuDataUpdated, component: IMU }  # bound event: "On Imu Data Updated (IMU)"
// wires:
//   - A.then -> F.execute
// notes:
//   B: 先拆开结构体
import { parseDocument, LineCounter, isMap, isSeq, isScalar } from "yaml";
import { PIN_CATEGORIES, NODE_KINDS, typesCompatible, typeText, isExec } from "./types.mjs";

const TOP_KEYS = ["caption", "nodes", "wires", "notes"];
const NODE_KEYS = ["ref", "inline", "var", "class", "at", "hideUnconnected", "set", "component"];
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXEC_IN_ALIASES = new Set(["exec", "in"]);
const EXEC_OUT_ALIASES = new Set(["then", "out"]);

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, "");

/**
 * Parses the YAML body of a ```blueprint block. `startLine` is the line of the opening fence, so
 * diagnostics carry page line numbers. Returns { model, diagnostics }.
 */
export function parseBlueprint(source, { startLine = 0, file = "" } = {}) {
  const diagnostics = [];
  const lc = new LineCounter();
  const doc = parseDocument(source, { lineCounter: lc, uniqueKeys: true });
  const lineAt = (node) => startLine + (node?.range ? lc.linePos(node.range[0]).line : 1);
  const diag = (severity, line, message) => diagnostics.push({ severity, file, line, message });
  const model = { caption: null, nodes: [], wires: [], notes: [], line: startLine };

  for (const e of doc.errors) diag("error", startLine + lc.linePos(e.pos[0]).line, `blueprint YAML: ${e.message.split("\n")[0]}`);
  if (doc.errors.length) return { model, diagnostics };
  if (!isMap(doc.contents)) {
    diag("error", startLine + 1, "blueprint block must be a YAML mapping with nodes: and wires:");
    return { model, diagnostics };
  }

  for (const pair of doc.contents.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : "";
    if (!TOP_KEYS.includes(key)) diag("error", lineAt(pair.key), `blueprint: unknown key "${key}" (allowed: ${TOP_KEYS.join(", ")})`);
  }

  const caption = doc.get("caption", true);
  if (caption != null) {
    if (!isScalar(caption) || typeof caption.value !== "string") diag("error", lineAt(caption), "blueprint: caption must be text");
    else model.caption = caption.value.trim();
  }

  const nodes = doc.get("nodes", true);
  if (!isMap(nodes) || !nodes.items.length) {
    diag("error", nodes ? lineAt(nodes) : startLine + 1, "blueprint: nodes: must map node keys to node ids");
  } else {
    for (const pair of nodes.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      const line = lineAt(pair.key);
      if (!KEY_RE.test(key)) {
        diag("error", line, `blueprint: node key "${key}" must be a short identifier such as A, B or Event`);
        continue;
      }
      const v = pair.value;
      const entry = { key, line, ref: null, inline: null, variable: null, at: null, hideUnconnected: false, set: {}, component: null };
      if (isScalar(v) && typeof v.value === "string") {
        entry.ref = v.value.trim();
      } else if (isMap(v)) {
        const o = v.toJSON();
        for (const k of Object.keys(o)) if (!NODE_KEYS.includes(k)) diag("error", line, `blueprint: node ${key}: unknown key "${k}" (allowed: ${NODE_KEYS.join(", ")})`);
        const forms = ["ref", "inline", "var"].filter((k) => o[k] != null);
        if (forms.length !== 1) diag("error", line, `blueprint: node ${key} needs exactly one of ref, inline or var`);
        if (typeof o.ref === "string") entry.ref = o.ref.trim();
        else if (o.ref != null) diag("error", line, `blueprint: node ${key}: ref must be a node id`);
        if (o.inline != null) entry.inline = o.inline;
        if (o.var != null) {
          if (typeof o.var !== "string" || typeof o.class !== "string") diag("error", line, `blueprint: node ${key}: var needs a name and class: <ClassId>, e.g. { var: IMU, class: UUBotImuSensorComponent }`);
          else entry.variable = { name: o.var, classId: o.class };
        } else if (o.class != null) diag("error", line, `blueprint: node ${key}: class is only used together with var`);
        if (o.at != null) {
          if (!Array.isArray(o.at) || o.at.length !== 2 || !o.at.every((n) => Number.isInteger(n) && n >= 0 && n < 40)) {
            diag("error", line, `blueprint: node ${key}: at must be [column, row] with whole numbers from 0`);
          } else entry.at = o.at;
        }
        if (o.hideUnconnected != null) {
          if (typeof o.hideUnconnected !== "boolean") diag("error", line, `blueprint: node ${key}: hideUnconnected must be true or false`);
          else entry.hideUnconnected = o.hideUnconnected;
        }
        if (o.component != null) {
          if (typeof o.component !== "string" || !o.component.trim() || /[()]/.test(o.component)) diag("error", line, `blueprint: node ${key}: component must be the component variable's name, e.g. component: IMU`);
          else if (typeof o.ref !== "string") diag("error", line, `blueprint: node ${key}: component is only used together with ref`);
          else entry.component = o.component.trim();
        }
        if (o.set != null) {
          if (typeof o.set !== "object" || Array.isArray(o.set)) diag("error", line, `blueprint: node ${key}: set must map input pins to values`);
          else for (const [pk, pv] of Object.entries(o.set)) entry.set[pk] = pv == null ? "" : String(pv);
        }
      } else {
        diag("error", line, `blueprint: node ${key} must be a node id or { ref: <id> }`);
        continue;
      }
      if (model.nodes.some((n) => n.key === key)) diag("error", line, `blueprint: node key ${key} is used twice`);
      model.nodes.push(entry);
    }
  }

  const wires = doc.get("wires", true);
  if (wires != null) {
    if (!isSeq(wires)) diag("error", lineAt(wires), `blueprint: wires: must be a list like "- A.then -> B.execute"`);
    else for (const item of wires.items) {
      const line = lineAt(item);
      const raw = isScalar(item) ? String(item.value) : "";
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*(.+?)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*(.+?)\s*$/.exec(raw);
      if (!m) {
        diag("error", line, `blueprint: wire "${raw}" must look like "A.Pin -> B.Pin"`);
        continue;
      }
      model.wires.push({ line, raw: raw.trim(), from: { node: m[1], pin: m[2] }, to: { node: m[3], pin: m[4] } });
    }
  }

  const notes = doc.get("notes", true);
  if (notes != null) {
    if (!isMap(notes)) diag("error", lineAt(notes), "blueprint: notes: must map node keys to short texts");
    else for (const pair of notes.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      const text = isScalar(pair.value) ? String(pair.value.value ?? "").trim() : "";
      if (!text) diag("error", lineAt(pair.key), `blueprint: note for ${key} is empty`);
      else model.notes.push({ key, text, line: lineAt(pair.key) });
    }
  }
  return { model, diagnostics };
}

// ---------------------------------------------------------------------------------------------

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Closest known ids for an unknown one (by edit distance, then by shared title words). */
export function suggestNodeIds(registry, wanted, limit = 3) {
  const w = wanted.toLowerCase();
  const scored = [];
  for (const [id, { item }] of registry.nodes) {
    const d = Math.min(levenshtein(w, id.toLowerCase()), levenshtein(norm(wanted), norm(item.title)) + 1);
    scored.push([d, id]);
  }
  scored.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
  const max = Math.max(3, Math.floor(w.length / 3));
  return scored.filter(([d]) => d <= max).slice(0, limit).map(([, id]) => id);
}

function parseInlineType(spec, registry) {
  const s = String(spec ?? "").trim();
  let base = s, container = "none";
  if (base.endsWith("[]")) {
    container = "array";
    base = base.slice(0, -2);
  }
  let category = base, subtype = "";
  const colon = base.indexOf(":");
  if (colon > 0) {
    category = base.slice(0, colon);
    subtype = base.slice(colon + 1);
  }
  if (!PIN_CATEGORIES.includes(category)) return null;
  let subtypeDisplay = "";
  if (subtype) {
    const known = registry.classEntry(subtype)?.item ?? registry.structs.get(subtype)?.item ?? registry.enums.get(subtype)?.item;
    subtypeDisplay = known?.displayName ?? subtype.replace(/^[FUEA](?=[A-Z])/, "");
  }
  return { category, subtype, subtypeDisplay, container, valueType: null, byRef: false, const: false };
}

function inlineDefinition(key, spec, registry, diag, line) {
  if (!spec || typeof spec !== "object") {
    diag("error", line, `blueprint: node ${key}: inline must be { title, kind, inputs, outputs }`);
    return null;
  }
  const kind = spec.kind ?? "call";
  if (!["call", "pure", "event", "make", "break", "node"].includes(kind)) diag("error", line, `blueprint: node ${key}: inline kind "${kind}" is not one of call, pure, event, make, break, node`);
  if (typeof spec.title !== "string" || !spec.title) diag("error", line, `blueprint: node ${key}: inline needs a title`);
  const pins = (list, side) => (Array.isArray(list) ? list : []).map((p, i) => {
    const type = parseInlineType(p?.type, registry);
    if (!type) diag("error", line, `blueprint: node ${key}: inline ${side}[${i}] has unknown type "${p?.type}" (use exec, bool, int, float, string, vector, struct:FName, object:UClassName, ... and [] for arrays)`);
    const name = typeof p?.name === "string" ? p.name : "";
    const id = typeof p?.id === "string" ? p.id : type?.category === "exec" && !name ? (side === "inputs" ? "execute" : "then") : name.replace(/\s+/g, "") || `${side}${i}`;
    return { id, name, type: type ?? { category: "wildcard", subtype: "", subtypeDisplay: "", container: "none", valueType: null, byRef: false, const: false }, default: p?.default != null ? String(p.default) : "", advanced: false, tooltip: "" };
  });
  return {
    id: `inline:${key}`,
    kind,
    title: spec.title ?? key,
    subtitle: typeof spec.subtitle === "string" ? spec.subtitle : "",
    owner: "",
    member: "",
    category: "",
    tooltip: typeof spec.tooltip === "string" ? spec.tooltip : "",
    keywords: "",
    flags: { static: false, latent: false, deprecated: false, developmentOnly: false, callInEditor: false, compact: false },
    compactTitle: "",
    inputs: pins(spec.inputs, "inputs"),
    outputs: pins(spec.outputs, "outputs"),
    inline: true,
  };
}

function variableDefinition(key, variable, registry, diag, line) {
  const cls = registry.classEntry(variable.classId);
  if (!cls) diag("error", line, `blueprint: node ${key}: var class "${variable.classId}" is not a class in data/api`);
  const display = cls?.item.displayName ?? variable.classId;
  return {
    id: `var:${variable.name}`,
    kind: "variable",
    title: variable.name,
    subtitle: "",
    owner: "",
    member: "",
    category: "",
    tooltip: "",
    keywords: "",
    flags: { static: false, latent: false, deprecated: false, developmentOnly: false, callInEditor: false, compact: false },
    compactTitle: "",
    inputs: [],
    outputs: [{ id: variable.name, name: variable.name, type: { category: "object", subtype: variable.classId, subtypeDisplay: display, container: "none", valueType: null, byRef: false, const: false }, default: "", advanced: false, tooltip: "" }],
    variable: { ...variable, classDisplay: display },
  };
}

/** Finds a pin on one side of a node definition by id, display name or exec alias. */
export function findPin(def, side, spec) {
  const pins = side === "out" ? def.outputs : def.inputs;
  const n = norm(spec);
  const aliases = side === "out" ? EXEC_OUT_ALIASES : EXEC_IN_ALIASES;
  if (aliases.has(n)) {
    const wantedId = side === "out" ? "then" : "execute";
    return pins.find((p) => p.id === wantedId && isExec(p.type)) ?? pins.find((p) => isExec(p.type)) ?? null;
  }
  return pins.find((p) => p.id === spec) ?? pins.find((p) => norm(p.id) === n) ?? pins.find((p) => p.name && norm(p.name) === n) ?? null;
}

function pinListText(pins) {
  return pins.map((p) => (p.name ? `${p.id} ("${p.name}")` : p.id)).join(", ") || "none";
}

/**
 * Resolves a parsed model against the registry and validates wires. Returns
 * { graph, diagnostics } where graph = { caption, nodes: [...], wires: [...], notes: [...] }.
 */
export function resolveBlueprint(model, registry, { file = "" } = {}) {
  const diagnostics = [];
  const diag = (severity, line, message) => diagnostics.push({ severity, file, line, message });
  const nodes = [];
  const byKey = new Map();

  for (const n of model.nodes) {
    let def = null, entry = null;
    if (n.ref) {
      entry = registry.nodeEntry(n.ref);
      if (!entry) {
        const sug = suggestNodeIds(registry, n.ref);
        diag("error", n.line, `blueprint: node ${n.key} uses unknown id "${n.ref}".${sug.length ? ` Did you mean ${sug.map((s) => `"${s}"`).join(" or ")}?` : ""} Search ids with: npm run find -- <words>`);
      } else def = entry.item;
      if (def && n.component) {
        // UK2Node_ComponentBoundEvent: the editor titles a component's event "<Delegate> (<Component>)".
        const owner = registry.classEntry(def.owner)?.item;
        if (def.kind !== "event" || !def.member || owner?.kind !== "component") {
          diag("error", n.line, `blueprint: node ${n.key}: component only applies to an event of a component class (got ${def.kind} "${def.title}")`);
        } else def = { ...def, title: `${def.title} (${n.component})` };
      }
    } else if (n.inline) {
      def = inlineDefinition(n.key, n.inline, registry, diag, n.line);
      if (def) diag("warning", n.line, `blueprint: node ${n.key} ("${def.title}") is an inline node and is not checked against data/api; prefer a node id, and add engine nodes to data/engine-nodes.txt`);
    } else if (n.variable) {
      def = variableDefinition(n.key, n.variable, registry, diag, n.line);
    }
    const resolved = { key: n.key, line: n.line, def, entry, at: n.at, hideUnconnected: n.hideUnconnected, values: {}, note: null, noteIndex: 0 };
    if (def) {
      for (const [pk, pv] of Object.entries(n.set)) {
        const p = findPin(def, "in", pk);
        if (!p) diag("error", n.line, `blueprint: node ${n.key}: set names unknown input "${pk}" (inputs: ${pinListText(def.inputs)})`);
        else if (isExec(p.type)) diag("error", n.line, `blueprint: node ${n.key}: set cannot give a value to exec pin "${pk}"`);
        else resolved.values[p.id] = pv;
      }
    }
    nodes.push(resolved);
    byKey.set(n.key, resolved);
  }

  const atSeen = new Map();
  for (const n of nodes) {
    if (!n.at) continue;
    const k = n.at.join(",");
    if (atSeen.has(k)) diag("error", n.line, `blueprint: nodes ${atSeen.get(k)} and ${n.key} are both placed at [${k}]`);
    else atSeen.set(k, n.key);
  }

  const wires = [];
  const dataInputs = new Map();
  const execOutputs = new Map();
  for (const w of model.wires) {
    const a = byKey.get(w.from.node), b = byKey.get(w.to.node);
    if (!a) diag("error", w.line, `blueprint: wire "${w.raw}": no node ${w.from.node} in nodes:`);
    if (!b) diag("error", w.line, `blueprint: wire "${w.raw}": no node ${w.to.node} in nodes:`);
    if (!a?.def || !b?.def) continue;
    const fromPin = findPin(a.def, "out", w.from.pin);
    const toPin = findPin(b.def, "in", w.to.pin);
    let ok = true;
    if (!fromPin) {
      ok = false;
      if (findPin(a.def, "in", w.from.pin)) diag("error", w.line, `blueprint: wire "${w.raw}": ${w.from.node}.${w.from.pin} is an input; wires go from an output to an input (write it the other way round)`);
      else diag("error", w.line, `blueprint: wire "${w.raw}": ${w.from.node} ("${a.def.title}") has no output "${w.from.pin}". Outputs: ${pinListText(a.def.outputs)}`);
    }
    if (!toPin) {
      ok = false;
      if (findPin(b.def, "out", w.to.pin)) diag("error", w.line, `blueprint: wire "${w.raw}": ${w.to.node}.${w.to.pin} is an output; wires go from an output to an input`);
      else diag("error", w.line, `blueprint: wire "${w.raw}": ${w.to.node} ("${b.def.title}") has no input "${w.to.pin}". Inputs: ${pinListText(b.def.inputs)}`);
    }
    if (!ok) continue;
    const execA = isExec(fromPin.type), execB = isExec(toPin.type);
    if (execA !== execB) {
      diag("error", w.line, `blueprint: wire "${w.raw}" connects an exec pin to a data pin`);
      continue;
    }
    if (!execA && !typesCompatible(fromPin.type, toPin.type, (c, p) => registry.isChildOf(c, p))) {
      diag("warning", w.line, `blueprint: wire "${w.raw}": type mismatch ${typeText(fromPin.type)} -> ${typeText(toPin.type)} (the editor would need a conversion node)`);
    }
    if (execA) {
      const k = `${a.key}.${fromPin.id}`;
      if (execOutputs.has(k)) diag("error", w.line, `blueprint: exec output ${a.key}.${fromPin.id} already has a wire (line ${execOutputs.get(k)}); an exec output connects to one input only`);
      else execOutputs.set(k, w.line);
    } else {
      const k = `${b.key}.${toPin.id}`;
      if (dataInputs.has(k)) diag("error", w.line, `blueprint: data input ${b.key}.${toPin.id} already has a wire (line ${dataInputs.get(k)}); a data input takes one wire only`);
      else dataInputs.set(k, w.line);
    }
    if (!execA && b.values[toPin.id] != null) diag("warning", w.line, `blueprint: ${b.key}.${toPin.id} is wired, so its set: value is not shown`);
    wires.push({ line: w.line, from: { key: a.key, pin: fromPin }, to: { key: b.key, pin: toPin }, exec: execA, type: fromPin.type });
  }

  const notes = [];
  for (const note of model.notes) {
    const n = byKey.get(note.key);
    if (!n) {
      diag("error", note.line, `blueprint: note for ${note.key}: no such node in nodes:`);
      continue;
    }
    if (n.note) {
      diag("error", note.line, `blueprint: node ${note.key} has two notes`);
      continue;
    }
    n.note = note.text;
    n.noteIndex = notes.length + 1;
    notes.push({ key: note.key, text: note.text, index: n.noteIndex });
  }

  return { graph: { caption: model.caption, nodes, wires, notes }, diagnostics };
}

/** parse + resolve in one call. */
export function compileBlueprint(source, registry, opts = {}) {
  const { model, diagnostics } = parseBlueprint(source, opts);
  if (diagnostics.some((d) => d.severity === "error")) return { graph: null, diagnostics };
  const r = resolveBlueprint(model, registry, opts);
  return { graph: r.graph, diagnostics: [...diagnostics, ...r.diagnostics] };
}

export { NODE_KINDS };
