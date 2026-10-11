// The uBot package registry: every script and component asks this module which packages exist, in
// which order, which ones are released, where their repositories are and which version the site
// documents. The source is data/index.json, a byte-for-byte copy of uBotCore's Index/index.json
// (format 2, the file uBot Manager reads; `npm run sync-index` updates it). Nothing else in the
// repository lists packages, so a new package needs data, not code.
//
//   const { registry } = loadPackages();          // data/index.json + the versions in data/api/*.json
//   registry.released()                            // [Package], layer order then name
//   registry.get("UBotSensor").folder              // "uBotSensor"
//
// A package is released when it has a version that is not `planned`. Its documented version is the
// version of data/api/<Name>.json when that file exists, else its latest released version.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, describeRange, parseVersion, satisfies, tryParseRange } from "./semver.mjs";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const INDEX_FILE = "data/index.json";
export const DEFAULT_INDEX_URL = "https://raw.githubusercontent.com/AstreoX/uBotCore/main/Index/index.json";
export const PLUGIN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FOLDER_RE = /^[A-Za-z0-9._-]+$/;

/** Package layers in display order. `id` is the index value, `label` the Chinese name on the site. */
export const LAYERS = [
  { id: "Foundation", label: "基础" },
  { id: "Capability", label: "能力" },
  { id: "Adapter", label: "适配" },
  { id: "Content", label: "内容" },
];
const LAYER_ORDER = new Map(LAYERS.map((l, i) => [l.id, i]));

export const layerLabel = (id) => LAYERS.find((l) => l.id === id)?.label ?? "";
/** URL slug of a package: its name in lower case. Independent of the layer, so moving a package never breaks links. */
export const packageSlug = (name) => String(name).toLowerCase();
export const packagePath = (name) => `/reference/${packageSlug(name)}/`;

const byName = (a, b) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);

/** Repository URL -> { owner, repo } for github.com, else null. */
export function parseGitHubRepository(url) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(url ?? ""));
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** Install and vendor folder: the index's `folder`, else the repository's last segment without ".git". */
export function folderOf(pkg) {
  if (typeof pkg?.folder === "string" && pkg.folder) return pkg.folder;
  const url = String(pkg?.repository ?? "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  const last = url.split(/[/:]/).pop() ?? "";
  return last.replace(/\.git$/i, "");
}

/** "UBotSensor" or "UBotSensor@^0.1" -> { name, range } (range "" when absent), or { error }. */
export function parsePackageSpec(spec) {
  if (typeof spec !== "string" || !spec.trim()) return { error: "a package must be a name such as UBotSensor, optionally with a range: UBotSensor@^0.1" };
  const at = spec.indexOf("@");
  const name = (at < 0 ? spec : spec.slice(0, at)).trim();
  const range = at < 0 ? "" : spec.slice(at + 1).trim();
  if (!PLUGIN_NAME_RE.test(name)) return { error: `"${spec}" is not a package name (a UE plugin name such as UBotSensor, optionally @<range>)` };
  if (at >= 0 && !range) return { error: `"${spec}": the range after "@" is empty` };
  return { name, range };
}

class Package {
  constructor(raw, apiVersion) {
    this.raw = raw;
    this.name = raw.name;
    this.friendlyName = typeof raw.friendlyName === "string" && raw.friendlyName.trim() ? raw.friendlyName : raw.name;
    this.layer = typeof raw.layer === "string" ? raw.layer : "";
    this.layerLabel = layerLabel(this.layer);
    this.layerOrder = LAYER_ORDER.get(this.layer) ?? LAYERS.length;
    this.repository = typeof raw.repository === "string" ? raw.repository : "";
    this.folder = folderOf(raw);
    this.slug = packageSlug(raw.name);
    this.path = packagePath(raw.name);
    const gh = parseGitHubRepository(this.repository);
    this.github = gh;
    this.githubUrl = gh ? `https://github.com/${gh.owner}/${gh.repo}` : "";
    this.tags = Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === "string") : [];
    const versions = (Array.isArray(raw.versions) ? raw.versions : []).filter((v) => v && typeof v.version === "string" && parseVersion(v.version));
    this.versions = versions.sort((a, b) => compareVersions(b.version, a.version));
    this.releasedVersions = this.versions.filter((v) => v.planned !== true);
    this.released = this.releasedVersions.length > 0;
    this.latest = this.releasedVersions[0] ?? null;
    this.apiVersion = apiVersion ?? null;
    this.hasApi = apiVersion != null;
    const fromApi = apiVersion ? this.versions.find((v) => compareVersions(v.version, apiVersion) === 0) : null;
    /** The index entry of the documented version (null when data/api names a version the index does not list). */
    this.documented = fromApi ?? (apiVersion ? null : this.latest ?? this.versions[0] ?? null);
    this.documentedVersion = apiVersion ?? this.documented?.version ?? "";
  }

  description(locale = "zh-CN") {
    const d = this.raw.description;
    if (typeof d === "string") return d;
    return (typeof d?.[locale] === "string" && d[locale].trim() ? d[locale] : typeof d?.en === "string" ? d.en : "").trim();
  }

  /** The version entry the site describes: the documented one, else the latest released, else the newest planned. */
  get current() {
    return this.documented ?? this.latest ?? this.versions[0] ?? null;
  }
  get requires() {
    return (this.current?.requires ?? []).filter((r) => r && typeof r.name === "string");
  }
  get enginePlugins() {
    return (this.current?.enginePlugins ?? []).filter((p) => typeof p === "string");
  }
  get provides() {
    return (this.current?.provides ?? []).filter((p) => typeof p === "string");
  }
  /** UE version range of the documented version ("~5.5"), or "". */
  get engine() {
    return typeof this.current?.engine === "string" ? this.current.engine : "";
  }
  /** Prebuilt archives of the documented version: [{ engine: "5.5", platform: "Win64" }]. */
  get prebuilt() {
    const b = this.current?.binaries;
    if (!b || typeof b !== "object" || this.current?.planned) return [];
    const out = [];
    for (const [engine, platforms] of Object.entries(b)) {
      if (!platforms || typeof platforms !== "object") continue;
      for (const [platform, entry] of Object.entries(platforms)) if (entry && typeof entry.url === "string") out.push({ engine, platform });
    }
    return out.sort((x, y) => byName(x.engine, y.engine) || byName(x.platform, y.platform));
  }
}

export class PackageRegistry {
  /** @param index parsed index.json; @param apiVersions Map name -> version of data/api/<name>.json */
  constructor(index, { apiVersions = new Map() } = {}) {
    const raw = Array.isArray(index?.packages) ? index.packages : [];
    this.index = index ?? {};
    this.packages = raw
      .filter((p) => p && typeof p.name === "string" && p.name)
      .map((p) => new Package(p, apiVersions.get(p.name)))
      .sort((a, b) => a.layerOrder - b.layerOrder || byName(a.name, b.name));
    this.byName = new Map(this.packages.map((p) => [p.name, p]));
  }

  /** Every package, layer order (Foundation, Capability, Adapter, Content) then name. */
  list() {
    return [...this.packages];
  }
  released() {
    return this.packages.filter((p) => p.released);
  }
  planned() {
    return this.packages.filter((p) => !p.released);
  }
  /** Exact name, else a case-insensitive match. */
  get(name) {
    if (this.byName.has(name)) return this.byName.get(name);
    const lower = String(name ?? "").toLowerCase();
    return this.packages.find((p) => p.name.toLowerCase() === lower) ?? null;
  }
  has(name) {
    return this.byName.has(name);
  }
  bySlug(slug) {
    return this.packages.find((p) => p.slug === slug) ?? null;
  }
  /** Released packages grouped by layer: [{ layer: { id, label }, packages }], empty layers left out. */
  releasedByLayer() {
    const groups = [];
    for (const layer of [...LAYERS, { id: "", label: "其他" }]) {
      const packages = this.released().filter((p) => (layer.id ? p.layer === layer.id : !LAYER_ORDER.has(p.layer)));
      if (packages.length) groups.push({ layer, packages });
    }
    return groups;
  }

  /** Required (non-optional) dependencies of a package's current version, direct only or transitive. */
  dependencies(name, { transitive = true } = {}) {
    const out = [];
    const seen = new Set([name]);
    const visit = (n) => {
      for (const r of this.get(n)?.requires ?? []) {
        if (r.optional === true || seen.has(r.name)) continue;
        seen.add(r.name);
        out.push(r.name);
        if (transitive) visit(r.name);
      }
    };
    visit(name);
    return out;
  }

  /** The given packages plus all their required dependencies. */
  closure(names) {
    const set = new Set();
    for (const n of names) {
      set.add(n);
      for (const d of this.dependencies(n)) set.add(d);
    }
    return set;
  }

  /** Released versions of a package that satisfy a range ("" matches all). */
  matching(name, range) {
    const p = this.get(name);
    if (!p) return [];
    return range ? p.releasedVersions.filter((v) => satisfies(v.version, range)) : p.releasedVersions;
  }
}

export function createPackageRegistry(index, opts) {
  return new PackageRegistry(index, opts);
}

// ----------------------------------------------------------------------- validation

/** Line finder for `"key": "value"` pairs in a JSON text. */
function makePairFinder(text) {
  const lines = String(text ?? "").split("\n");
  return (key, value, after = 0) => {
    const re = new RegExp(`"${key}"\\s*:\\s*${JSON.stringify(String(value)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    for (let i = after; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
    return after || 1;
  };
}

/**
 * Validates the parts of the index the site uses. Errors make `npm run check` fail and stop
 * `npm run sync-index` from writing the file. Returns [{ severity, file, line, message }].
 */
export function validateIndex(data, text = "", file = INDEX_FILE) {
  const out = [];
  const err = (line, message) => out.push({ severity: "error", file, line, message });
  const warn = (line, message) => out.push({ severity: "warning", file, line, message });
  const lineOf = makePairFinder(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    err(1, "the index must be a JSON object");
    return out;
  }
  if (data.formatVersion !== 2) err(1, `"formatVersion" is ${JSON.stringify(data.formatVersion)}; the site reads index format 2`);
  if (!Array.isArray(data.packages)) {
    err(1, `"packages" must be an array`);
    return out;
  }
  const names = new Map();
  for (const p of data.packages) if (typeof p?.name === "string") names.set(p.name.toLowerCase(), p.name);
  const seen = new Set();
  const folders = new Map();
  for (const p of data.packages) {
    const name = typeof p?.name === "string" ? p.name : "";
    const line = name ? lineOf("name", name) : 1;
    const where = `package ${name || "?"}`;
    if (!PLUGIN_NAME_RE.test(name)) {
      err(line, `${where}: "name" must be a UE plugin name ([A-Za-z_][A-Za-z0-9_]*)`);
      continue;
    }
    if (seen.has(name.toLowerCase())) err(line, `${where}: listed twice`);
    seen.add(name.toLowerCase());
    const versions = Array.isArray(p.versions) ? p.versions : null;
    if (!versions || !versions.length) err(line, `${where}: "versions" must be a non-empty array`);
    const released = (versions ?? []).some((v) => v && v.planned !== true);
    if (p.friendlyName != null && typeof p.friendlyName !== "string") err(line, `${where}: "friendlyName" must be a string`);
    if (typeof p.description?.en !== "string" || !p.description.en.trim()) err(line, `${where}: "description.en" is required`);
    else if (typeof p.description?.["zh-CN"] !== "string" || !p.description["zh-CN"].trim()) warn(line, `${where}: no "description.zh-CN"; the site shows the English description`);
    if (p.layer == null || p.layer === "") {
      (released ? err : warn)(line, `${where}: "layer" is missing (Foundation, Capability, Adapter or Content); the site groups the reference by layer`);
    } else if (!LAYER_ORDER.has(p.layer)) err(line, `${where}: "layer" is ${JSON.stringify(p.layer)}, expected Foundation, Capability, Adapter or Content`);
    if (p.repository != null && typeof p.repository !== "string") err(line, `${where}: "repository" must be a string`);
    if (released && !p.repository) err(line, `${where}: "repository" is required for a released package`);
    if (typeof p.repository === "string" && p.repository && !/^https:\/\//.test(p.repository)) {
      (released ? err : warn)(line, `${where}: "repository" must be an https:// URL (the site links to it and downloads docs/api.json from it)`);
    }
    if (p.folder != null && (typeof p.folder !== "string" || !FOLDER_RE.test(p.folder) || p.folder === "." || p.folder === "..")) err(line, `${where}: "folder" must be one safe path segment`);
    const folder = folderOf(p);
    if ((p.repository || p.folder) && (!FOLDER_RE.test(folder) || folder === "." || folder === "..")) err(line, `${where}: cannot derive a folder name from the repository; set "folder"`);
    else if (folder) {
      if (folders.has(folder.toLowerCase())) warn(line, `${where}: uses the folder "${folder}" like ${folders.get(folder.toLowerCase())}`);
      folders.set(folder.toLowerCase(), name);
    }
    if (p.docsUrl != null && typeof p.docsUrl !== "string") err(line, `${where}: "docsUrl" must be a string`);
    const vseen = new Set();
    for (const v of versions ?? []) {
      const vline = typeof v?.version === "string" ? lineOf("version", v.version, line - 1) : line;
      const vwhere = `${where} ${v?.version ?? "?"}`;
      if (!v || typeof v !== "object" || typeof v.version !== "string" || !parseVersion(v.version)) {
        err(vline, `${where}: every version needs a SemVer "version"`);
        continue;
      }
      const norm = parseVersion(v.version);
      const key = `${norm.major}.${norm.minor}.${norm.patch}-${norm.pre}`;
      if (vseen.has(key)) err(vline, `${vwhere}: listed twice`);
      vseen.add(key);
      if (v.planned != null && typeof v.planned !== "boolean") err(vline, `${vwhere}: "planned" must be true or false`);
      if (v.planned !== true && (typeof v.ref !== "string" || !v.ref)) err(vline, `${vwhere}: a released version needs "ref" (the git tag)`);
      if (v.engine != null && (typeof v.engine !== "string" || tryParseRange(v.engine).error)) err(vline, `${vwhere}: "engine" is not a version range`);
      if (v.requires != null && !Array.isArray(v.requires)) err(vline, `${vwhere}: "requires" must be an array`);
      for (const r of Array.isArray(v.requires) ? v.requires : []) {
        if (typeof r?.name !== "string" || !names.has(r.name.toLowerCase())) err(vline, `${vwhere}: requires ${JSON.stringify(r?.name)}, which is not in the index`);
        else if (r.version != null && (typeof r.version !== "string" || tryParseRange(r.version).error)) err(vline, `${vwhere}: requires ${r.name} ${JSON.stringify(r.version)}, which is not a version range`);
      }
      for (const k of ["enginePlugins", "provides"]) {
        if (v[k] != null && (!Array.isArray(v[k]) || v[k].some((x) => typeof x !== "string" || !x))) err(vline, `${vwhere}: "${k}" must be an array of names`);
      }
      if (badBinaries(v.binaries)) err(vline, `${vwhere}: "binaries" must be null or an object of engines and platforms`);
    }
  }
  return out;
}
const badBinaries = (b) => b != null && (typeof b !== "object" || Array.isArray(b));

/**
 * Checks package specs from a page's frontmatter or a folder's _group.yml against the registry.
 * Returns { packages: [{ name, range }], findings }.
 */
export function checkPackageSpecs(specs, registry, { file, line = 1, where = "packages" } = {}) {
  const findings = [];
  const packages = [];
  if (!Array.isArray(specs)) {
    findings.push({ severity: "error", file, line, message: `${where} must be a list, e.g. packages: [UBotSensor]` });
    return { packages, findings };
  }
  for (const spec of specs) {
    const parsed = parsePackageSpec(spec);
    if (parsed.error) {
      findings.push({ severity: "error", file, line, message: `${where}: ${parsed.error}` });
      continue;
    }
    const pkg = registry.get(parsed.name);
    if (!pkg || pkg.name !== parsed.name) {
      const hint = pkg ? `did you mean ${pkg.name}?` : `known: ${registry.released().map((p) => p.name).join(", ")}`;
      findings.push({ severity: "error", file, line, message: `${where}: unknown package "${parsed.name}" (${hint})` });
      continue;
    }
    if (!pkg.released) {
      findings.push({ severity: "error", file, line, message: `${where}: ${pkg.name} has no released version yet (only planned in data/index.json); pages can declare released packages only` });
      continue;
    }
    if (parsed.range) {
      const { error } = tryParseRange(parsed.range);
      if (error) {
        findings.push({ severity: "error", file, line, message: `${where}: "${spec}": ${error}` });
        continue;
      }
      if (!registry.matching(pkg.name, parsed.range).length) {
        const all = pkg.releasedVersions.map((v) => v.version).join(", ");
        findings.push({ severity: "error", file, line, message: `${where}: "${spec}" matches no released version of ${pkg.name} (released: ${all})` });
        continue;
      }
    }
    if (packages.some((p) => p.name === pkg.name)) {
      findings.push({ severity: "warning", file, line, message: `${where}: ${pkg.name} is listed twice` });
      continue;
    }
    packages.push({ name: pkg.name, range: parsed.range });
  }
  return { packages, findings };
}

/**
 * The "需要" line of a page: the declared packages with a short version text and the required
 * dependencies that are not declared themselves. Unknown names are skipped (npm run check reports them).
 */
export function requirementsOf(specs, registry) {
  const declared = [];
  for (const spec of Array.isArray(specs) ? specs : []) {
    const parsed = parsePackageSpec(spec);
    const pkg = parsed.error ? null : registry.get(parsed.name);
    if (!pkg || declared.some((d) => d.name === pkg.name)) continue;
    let version = describeRange(parsed.range);
    if (!version && pkg.current) {
      const v = parseVersion(pkg.current.version);
      version = v ? `${v.major}.${v.minor}+` : "";
    }
    declared.push({ name: pkg.name, friendlyName: pkg.friendlyName, href: pkg.released ? pkg.path : "", version });
  }
  const names = new Set(declared.map((d) => d.name));
  const deps = [];
  for (const d of declared) {
    for (const dep of registry.dependencies(d.name)) {
      if (names.has(dep) || deps.some((x) => x.name === dep)) continue;
      const pkg = registry.get(dep);
      deps.push({ name: dep, friendlyName: pkg?.friendlyName ?? dep, href: pkg?.released ? pkg.path : "" });
    }
  }
  const order = (x) => registry.list().findIndex((p) => p.name === x.name);
  deps.sort((a, b) => order(a) - order(b));
  return { declared, dependencies: deps };
}

// ----------------------------------------------------------------------- loading

const cache = new Map();

/** Versions of data/api/<Name>.json (engine.json excluded): Map name -> { version, plugin, file }. */
export function readApiVersions(apiDir) {
  const out = new Map();
  if (!existsSync(apiDir)) return out;
  for (const f of readdirSync(apiDir).filter((x) => x.endsWith(".json")).sort()) {
    if (f === "engine.json") continue;
    try {
      const data = JSON.parse(readFileSync(join(apiDir, f), "utf8").replace(/^﻿/, ""));
      out.set(f.slice(0, -5), { version: typeof data?.version === "string" ? data.version : "", plugin: data?.plugin, file: f });
    } catch {
      out.set(f.slice(0, -5), { version: "", plugin: undefined, file: f });
    }
  }
  return out;
}

/**
 * Loads data/index.json and the documented versions from data/api. Returns
 * { registry, diagnostics, text }. `dataDir` defaults to <root>/data (tests pass a temporary one).
 */
export function loadPackages({ root = REPO_ROOT, dataDir = join(root, "data"), fresh = false } = {}) {
  const key = `${root}|${dataDir}`;
  if (!fresh && cache.has(key)) return cache.get(key);
  const rel = (p) => relative(root, p).replaceAll("\\", "/") || p;
  const indexPath = join(dataDir, "index.json");
  const diagnostics = [];
  let index = { formatVersion: 2, packages: [] };
  let text = "";
  if (!existsSync(indexPath)) {
    diagnostics.push({ severity: "error", file: rel(indexPath), line: 1, message: "the package index is missing; run npm run sync-index" });
  } else {
    text = readFileSync(indexPath, "utf8");
    try {
      index = JSON.parse(text.replace(/^﻿/, ""));
      diagnostics.push(...validateIndex(index, text, rel(indexPath)));
    } catch (e) {
      diagnostics.push({ severity: "error", file: rel(indexPath), line: 1, message: `invalid JSON: ${e.message}` });
      index = { formatVersion: 2, packages: [] };
    }
  }
  const api = readApiVersions(join(dataDir, "api"));
  const apiVersions = new Map([...api].map(([name, a]) => [name, a.version]));
  const registry = new PackageRegistry(index, { apiVersions });
  for (const [name, a] of api) {
    const file = rel(join(dataDir, "api", a.file));
    const pkg = registry.get(name);
    if (a.plugin !== undefined && a.plugin !== name) diagnostics.push({ severity: "error", file, line: 1, message: `the file is named ${name}.json but describes plugin ${JSON.stringify(a.plugin)}; name it <plugin>.json` });
    if (!pkg || pkg.name !== name) {
      diagnostics.push({ severity: "error", file, line: 1, message: `${name} is not a package in ${INDEX_FILE}${pkg ? ` (did you mean ${pkg.name}?)` : ""}; add it to uBotCore's Index/index.json and run npm run sync-index` });
    } else if (!pkg.released) {
      diagnostics.push({ severity: "error", file, line: 1, message: `${name} has no released version in ${INDEX_FILE}; the reference documents released packages only` });
    } else if (a.version && !pkg.documented) {
      diagnostics.push({ severity: "warning", file, line: 1, message: `documents ${name} ${a.version}, which ${INDEX_FILE} does not list (released: ${pkg.releasedVersions.map((v) => v.version).join(", ")}); package pages fall back to the index's latest version for dependencies` });
    }
  }
  const result = { registry, diagnostics, text };
  cache.set(key, result);
  return result;
}
