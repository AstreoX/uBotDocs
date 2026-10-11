// Loads data/api/*.json (format 1, produced by the UBotDocExport commandlet in the uBotCore plugin),
// validates their shape and builds one registry of classes, nodes, structs and enums.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { PIN_CATEGORIES, CONTAINERS, NODE_KIND_IDS } from "./types.mjs";

export const CLASS_KINDS = ["component", "object", "library", "subsystem", "settings", "interface", "actor"];
const ACCESS = ["readWrite", "readOnly", "none"];
const EDITABLE = ["anywhere", "defaultsOnly", "instanceOnly", "none"];
const META_KEYS = ["ClampMin", "ClampMax", "UIMin", "UIMax", "Units", "ForceUnits", "EditCondition"];
const TOP_KEYS = ["format", "plugin", "version", "engine", "repository", "generator", "culture", "modules", "classes", "nodes", "structs", "enums"];
const ZH_KEYS = new Set(["titleZh", "subtitleZh", "nameZh", "displayNameZh"]);
/** "generator" of the commandlet's output; anything else was written or edited by hand. */
export const GENERATOR_RE = /^UBotDocExport \d+$/;

/** Finds the line of `"id": "<value>"` in a JSON text, optionally after a given line. */
export function makeLineFinder(text) {
  const lines = text.split("\n");
  const byId = new Map();
  lines.forEach((line, i) => {
    const m = /^\s*"id":\s*"((?:[^"\\]|\\.)*)"/.exec(line);
    if (!m) return;
    const id = JSON.parse(`"${m[1]}"`);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(i + 1);
  });
  return (id, after = 0) => {
    const list = byId.get(id);
    if (!list) return after || 1;
    return list.find((l) => l > after) ?? list[0];
  };
}

class ShapeChecker {
  constructor(file, text, diagnostics) {
    this.file = file;
    this.lineOf = makeLineFinder(text);
    this.diagnostics = diagnostics;
  }
  error(line, message) {
    this.diagnostics.push({ severity: "error", file: this.file, line, message });
  }
  warn(line, message) {
    this.diagnostics.push({ severity: "warning", file: this.file, line, message });
  }
  str(obj, key, where, line, { allowEmpty = true } = {}) {
    if (typeof obj?.[key] !== "string") this.error(line, `${where}: "${key}" must be a string`);
    else if (!allowEmpty && obj[key] === "") this.error(line, `${where}: "${key}" must not be empty`);
  }
  bool(obj, key, where, line) {
    if (typeof obj?.[key] !== "boolean") this.error(line, `${where}: "${key}" must be true or false`);
  }
  oneOf(obj, key, values, where, line) {
    if (!values.includes(obj?.[key])) this.error(line, `${where}: "${key}" is ${JSON.stringify(obj?.[key])}, expected one of ${values.join(", ")}`);
  }
  arr(obj, key, where, line) {
    if (!Array.isArray(obj?.[key])) {
      this.error(line, `${where}: "${key}" must be an array`);
      return [];
    }
    return obj[key];
  }
  unknownKeys(obj, allowed, where, line) {
    if (!obj || typeof obj !== "object") return;
    for (const k of Object.keys(obj)) {
      if (!allowed.includes(k) && !ZH_KEYS.has(k)) this.warn(line, `${where}: unknown key "${k}"`);
    }
  }
  sorted(list, where, line) {
    const ids = list.map((x) => x?.id).filter((x) => typeof x === "string");
    const byCode = ids.every((id, i) => i === 0 || ids[i - 1] < id);
    const byCaseless = ids.every((id, i) => i === 0 || ids[i - 1].toLowerCase() <= id.toLowerCase());
    if (!byCode && !byCaseless) this.warn(line, `${where}: entries are not sorted by "id" (the exporter must write them sorted)`);
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) this.error(this.lineOf(id), `${where}: duplicate id "${id}"`);
      seen.add(id);
    }
  }
  pinType(t, where, line, { allowValueType = true } = {}) {
    if (!t || typeof t !== "object") {
      this.error(line, `${where}: type must be an object`);
      return;
    }
    this.unknownKeys(t, ["category", "subtype", "subtypeDisplay", "container", "valueType", "byRef", "const"], where, line);
    this.oneOf(t, "category", PIN_CATEGORIES, where, line);
    this.str(t, "subtype", where, line);
    this.str(t, "subtypeDisplay", where, line);
    this.oneOf(t, "container", CONTAINERS, where, line);
    this.bool(t, "byRef", where, line);
    this.bool(t, "const", where, line);
    if (["struct", "enum", "object", "class", "softobject", "softclass", "interface"].includes(t.category) && !t.subtype) {
      this.warn(line, `${where}: ${t.category} type without "subtype"`);
    }
    if (t.container === "map") {
      if (!allowValueType || !t.valueType) this.error(line, `${where}: map type needs "valueType"`);
      else this.pinType(t.valueType, `${where}.valueType`, line, { allowValueType: false });
    } else if (t.valueType !== null) {
      this.error(line, `${where}: "valueType" must be null unless container is "map"`);
    }
  }
  pin(p, where, line) {
    if (!p || typeof p !== "object") {
      this.error(line, `${where}: pin must be an object`);
      return;
    }
    this.unknownKeys(p, ["id", "name", "type", "default", "advanced", "tooltip"], where, line);
    this.str(p, "id", where, line, { allowEmpty: false });
    this.str(p, "name", where, line);
    this.pinType(p.type, `${where} type`, line);
    this.str(p, "default", where, line);
    this.bool(p, "advanced", where, line);
    this.str(p, "tooltip", where, line);
  }
}

/** Validates one parsed api.json document. Diagnostics are appended to `diagnostics`. */
export function validateApiShape(data, text, file, diagnostics = []) {
  const c = new ShapeChecker(file, text, diagnostics);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    c.error(1, "top level must be an object");
    return diagnostics;
  }
  c.unknownKeys(data, TOP_KEYS, "file", 1);
  if (data.format !== 1) c.error(1, `"format" is ${JSON.stringify(data.format)}, this site reads format 1`);
  for (const k of ["plugin", "version", "engine", "repository", "generator", "culture"]) c.str(data, k, "file", 1);
  if (typeof data.plugin === "string" && !data.plugin) c.error(1, `"plugin" must not be empty`);
  // Chinese text comes from the optional *Zh fields. An export made without -culture=en on a Chinese machine
  // is labelled "zh-Hans" and has Chinese subtitles in the main fields, but passes every other check.
  if (typeof data.culture === "string" && data.culture !== "en") {
    c.error(1, `"culture" is ${JSON.stringify(data.culture)}; the committed file must be the English export (run the exporter with -culture=en)`);
  }
  if (typeof data.repository === "string" && data.repository.endsWith(".git")) c.warn(1, `"repository" should not end with ".git"`);
  for (const m of c.arr(data, "modules", "file", 1)) {
    if (typeof m?.name !== "string" || typeof m?.type !== "string") c.error(1, `modules: each entry needs "name" and "type" strings`);
  }

  const classes = c.arr(data, "classes", "file", 1);
  const nodes = c.arr(data, "nodes", "file", 1);
  const structs = c.arr(data, "structs", "file", 1);
  const enums = c.arr(data, "enums", "file", 1);
  c.sorted(classes, "classes", 1);
  c.sorted(nodes, "nodes", 1);
  c.sorted(structs, "structs", 1);
  c.sorted(enums, "enums", 1);
  const nodeIds = new Set(nodes.map((n) => n?.id));

  for (const cl of classes) {
    const line = c.lineOf(cl?.id);
    const where = `class ${cl?.id ?? "?"}`;
    c.unknownKeys(cl, ["id", "displayName", "kind", "parent", "module", "header", "category", "tooltip", "flags", "properties", "nodes"], where, line);
    c.str(cl, "id", where, line, { allowEmpty: false });
    c.str(cl, "displayName", where, line, { allowEmpty: false });
    c.oneOf(cl, "kind", CLASS_KINDS, where, line);
    for (const k of ["parent", "module", "header", "category", "tooltip"]) c.str(cl, k, where, line);
    if (!cl?.flags || typeof cl.flags !== "object") c.error(line, `${where}: "flags" must be an object`);
    else for (const f of ["abstract", "blueprintType", "blueprintable", "spawnable", "deprecated"]) c.bool(cl.flags, f, `${where} flags`, line);
    const props = c.arr(cl, "properties", where, line);
    c.sorted(props, `${where} properties`, line);
    for (const p of props) {
      const pl = c.lineOf(p?.id, line);
      const pw = `${where} property ${p?.id ?? "?"}`;
      c.unknownKeys(p, ["id", "displayName", "type", "default", "category", "access", "editable", "tooltip", "meta"], pw, pl);
      c.str(p, "id", pw, pl, { allowEmpty: false });
      c.str(p, "displayName", pw, pl);
      c.pinType(p?.type, `${pw} type`, pl);
      for (const k of ["default", "category", "tooltip"]) c.str(p, k, pw, pl);
      c.oneOf(p, "access", ACCESS, pw, pl);
      c.oneOf(p, "editable", EDITABLE, pw, pl);
      if (!p?.meta || typeof p.meta !== "object" || Array.isArray(p.meta)) c.error(pl, `${pw}: "meta" must be an object`);
      else for (const [k, v] of Object.entries(p.meta)) {
        if (!META_KEYS.includes(k)) c.warn(pl, `${pw}: meta key "${k}" is not part of the contract`);
        if (typeof v !== "string") c.error(pl, `${pw}: meta "${k}" must be a string`);
      }
    }
    for (const id of c.arr(cl, "nodes", where, line)) {
      if (typeof id !== "string") c.error(line, `${where}: "nodes" must list node ids`);
      else if (!nodeIds.has(id)) c.error(line, `${where}: lists node "${id}" which is not in "nodes"`);
    }
  }

  for (const n of nodes) {
    const line = c.lineOf(n?.id);
    const where = `node ${n?.id ?? "?"}`;
    c.unknownKeys(n, ["id", "kind", "title", "subtitle", "owner", "member", "category", "tooltip", "keywords", "flags", "compactTitle", "inputs", "outputs"], where, line);
    c.str(n, "id", where, line, { allowEmpty: false });
    c.oneOf(n, "kind", NODE_KIND_IDS, where, line);
    c.str(n, "title", where, line, { allowEmpty: false });
    for (const k of ["subtitle", "owner", "member", "category", "tooltip", "keywords", "compactTitle"]) c.str(n, k, where, line);
    if (!n?.flags || typeof n.flags !== "object") c.error(line, `${where}: "flags" must be an object`);
    else for (const f of ["static", "latent", "deprecated", "developmentOnly", "callInEditor", "compact"]) c.bool(n.flags, f, `${where} flags`, line);
    for (const side of ["inputs", "outputs"]) {
      const pins = c.arr(n, side, where, line);
      const seen = new Set();
      pins.forEach((p, i) => {
        const pl = c.lineOf(p?.id, line);
        c.pin(p, `${where} ${side}[${i}]`, pl);
        if (seen.has(p?.id)) c.error(pl, `${where}: duplicate ${side} pin id "${p?.id}"`);
        seen.add(p?.id);
      });
    }
    if (typeof n?.id === "string" && n.owner && n.member && n.id !== `${n.owner}.${n.member}`) {
      c.warn(line, `${where}: id should be "${n.owner}.${n.member}"`);
    }
    if (n?.kind === "pure" && [...(n.inputs ?? []), ...(n.outputs ?? [])].some((p) => p?.type?.category === "exec")) {
      c.warn(line, `${where}: pure node with exec pins`);
    }
  }

  for (const s of structs) {
    const line = c.lineOf(s?.id);
    const where = `struct ${s?.id ?? "?"}`;
    c.unknownKeys(s, ["id", "displayName", "module", "header", "tooltip", "fields", "make", "break"], where, line);
    c.str(s, "id", where, line, { allowEmpty: false });
    for (const k of ["displayName", "module", "header", "tooltip", "make", "break"]) c.str(s, k, where, line);
    const fields = c.arr(s, "fields", where, line);
    c.sorted(fields, `${where} fields`, line);
    for (const f of fields) {
      const fl = c.lineOf(f?.id, line);
      const fw = `${where} field ${f?.id ?? "?"}`;
      c.unknownKeys(f, ["id", "displayName", "type", "tooltip", "access"], fw, fl);
      c.str(f, "id", fw, fl, { allowEmpty: false });
      c.str(f, "displayName", fw, fl);
      c.pinType(f?.type, `${fw} type`, fl);
      c.str(f, "tooltip", fw, fl);
      c.oneOf(f, "access", ACCESS, fw, fl);
    }
    for (const k of ["make", "break"]) {
      if (s?.[k] && !nodeIds.has(s[k])) c.error(line, `${where}: "${k}" names node "${s[k]}" which is not in "nodes"`);
    }
  }

  for (const e of enums) {
    const line = c.lineOf(e?.id);
    const where = `enum ${e?.id ?? "?"}`;
    c.unknownKeys(e, ["id", "displayName", "module", "header", "tooltip", "values"], where, line);
    c.str(e, "id", where, line, { allowEmpty: false });
    for (const k of ["displayName", "module", "header", "tooltip"]) c.str(e, k, where, line);
    const values = c.arr(e, "values", where, line);
    c.sorted(values, `${where} values`, line);
    for (const v of values) {
      const vl = c.lineOf(v?.id, line);
      const vw = `${where} value ${v?.id ?? "?"}`;
      c.unknownKeys(v, ["id", "displayName", "value", "tooltip"], vw, vl);
      c.str(v, "id", vw, vl, { allowEmpty: false });
      c.str(v, "displayName", vw, vl);
      if (!Number.isInteger(v?.value)) c.error(vl, `${vw}: "value" must be an integer`);
      c.str(v, "tooltip", vw, vl);
    }
  }
  return diagnostics;
}

/** One registry over every api file. Lookups return { item, plugin, version, repository, file, isEngine }. */
export class ApiRegistry {
  constructor() {
    this.files = [];
    this.nodes = new Map();
    this.classes = new Map();
    this.structs = new Map();
    this.enums = new Map();
  }

  add(data, file) {
    const meta = {
      plugin: data.plugin,
      version: data.version,
      repository: data.repository,
      file,
      isEngine: data.plugin === "Engine",
    };
    this.files.push({ ...meta, data });
    const dup = [];
    const put = (map, item, kind) => {
      if (!item || typeof item.id !== "string") return;
      if (map.has(item.id)) dup.push({ kind, id: item.id, other: map.get(item.id).file });
      else map.set(item.id, { item, ...meta });
    };
    for (const n of data.nodes ?? []) put(this.nodes, n, "node");
    for (const cl of data.classes ?? []) put(this.classes, cl, "class");
    for (const s of data.structs ?? []) put(this.structs, s, "struct");
    for (const e of data.enums ?? []) put(this.enums, e, "enum");
    return dup;
  }

  node(id) {
    return this.nodes.get(id)?.item;
  }
  nodeEntry(id) {
    return this.nodes.get(id);
  }
  classEntry(id) {
    return this.classes.get(id);
  }

  /** true / false when the hierarchy is known, undefined when it leaves the exported classes. */
  isChildOf(child, parent) {
    let cur = child;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      if (cur === parent) return true;
      seen.add(cur);
      const entry = this.classes.get(cur);
      if (!entry) return undefined;
      cur = entry.item.parent;
    }
    return false;
  }

  /**
   * Every id a zh overlay may describe, mapped to { tooltip, plugin, what, owner }. `owner` names the
   * file the Chinese summary lives in (data/zh/<plugin>/<owner>.yaml): the class, struct or enum
   * itself, the class of a property or node, the struct of a field or Make/Break node, the enum of a
   * value. A node without owner (K2 nodes, macros) is its own owner.
   */
  describableIds() {
    const ids = new Map();
    for (const [id, { item, plugin }] of this.classes) {
      ids.set(id, { tooltip: item.tooltip ?? "", plugin, what: "class", owner: id });
      for (const p of item.properties ?? []) ids.set(`${id}.${p.id}`, { tooltip: p.tooltip ?? "", plugin, what: "property", owner: id });
    }
    for (const [id, { item, plugin }] of this.nodes) ids.set(id, { tooltip: item.tooltip ?? "", plugin, what: "node", owner: nodeOwnerId(item) });
    for (const [id, { item, plugin }] of this.structs) {
      ids.set(id, { tooltip: item.tooltip ?? "", plugin, what: "struct", owner: id });
      for (const f of item.fields ?? []) ids.set(`${id}.${f.id}`, { tooltip: f.tooltip ?? "", plugin, what: "field", owner: id });
    }
    for (const [id, { item, plugin }] of this.enums) {
      ids.set(id, { tooltip: item.tooltip ?? "", plugin, what: "enum", owner: id });
      for (const v of item.values ?? []) ids.set(`${id}.${v.id}`, { tooltip: v.tooltip ?? "", plugin, what: "value", owner: id });
    }
    return ids;
  }
}

/** File-name-safe owner of a node for data/zh: its owner class, the struct of Make/Break, else the node id. */
export function nodeOwnerId(node) {
  if (node?.owner) return safeFileId(node.owner);
  const id = String(node?.id ?? "");
  if ((node?.kind === "make" || node?.kind === "break") && id.includes(":")) return safeFileId(id.slice(id.indexOf(":") + 1));
  return safeFileId(id);
}
const safeFileId = (s) => String(s).replace(/[^A-Za-z0-9_.-]+/g, "-");

/**
 * Reads every *.json in `dir`. Returns { registry, diagnostics }. Files with shape errors are still
 * added (best effort) so that later checks can report more than one problem per run.
 */
export function loadApi(dir, { root = process.cwd() } = {}) {
  const diagnostics = [];
  const registry = new ApiRegistry();
  if (!existsSync(dir)) {
    diagnostics.push({ severity: "error", file: relative(root, dir) || dir, line: 1, message: "API data folder is missing" });
    return { registry, diagnostics };
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  for (const f of files) {
    const abs = join(dir, f);
    const rel = relative(root, abs).replaceAll("\\", "/");
    let text = readFileSync(abs, "utf8");
    if (text.charCodeAt(0) === 0xfeff) {
      diagnostics.push({ severity: "error", file: rel, line: 1, message: "file starts with a BOM (the contract requires UTF-8 without BOM)" });
      text = text.slice(1);
    }
    if (text.includes("\r\n")) diagnostics.push({ severity: "warning", file: rel, line: 1, message: "CRLF line endings (the contract requires LF)" });
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      const m = /position (\d+)/.exec(e.message);
      const line = m ? text.slice(0, Number(m[1])).split("\n").length : 1;
      diagnostics.push({ severity: "error", file: rel, line, message: `invalid JSON: ${e.message}` });
      continue;
    }
    validateApiShape(data, text, rel, diagnostics);
    if (typeof data?.generator === "string" && !GENERATOR_RE.test(data.generator)) {
      diagnostics.push({ severity: "warning", file: rel, line: 1, message: `"generator" is ${JSON.stringify(data.generator)}: not written by the UBotDocExport commandlet; regenerate the file with scripts/export-api.ps1 instead of editing it` });
    }
    const lineOf = makeLineFinder(text);
    for (const d of registry.add(data, rel)) {
      diagnostics.push({ severity: "error", file: rel, line: lineOf(d.id), message: `${d.kind} "${d.id}" is also defined in ${d.other}` });
    }
  }
  if (!files.length) diagnostics.push({ severity: "error", file: relative(root, dir) || dir, line: 1, message: "no API data files" });
  return { registry, diagnostics };
}
