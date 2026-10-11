// The uBot package registry: every script and component asks this module which packages exist, in
// which order, which ones are released, where their repositories are and which version the site
// documents. The source is data/index.json, a byte-for-byte copy of uBotCore's Index/index.json
// (format 2, the file uBot Manager reads; `npm run sync-index` updates it). Nothing else in the
// repository lists packages, so a new package needs data, not code.
//
//   const { registry } = loadPackages();          // data/index.json + the versions in data/api/*.json
//   registry.released()                            // [Package] in index order
//   registry.get("UBotSensor").folder              // "uBotSensor"
//   registry.get("UBotSensor").label               // "uBotSensor", how the docs write the name
//   registry.get("UBotSensor").docsPath            // "/sensor/", the plugin's manual (or placeholder)
//
// The index also has a `layer` per package. The docs do not show it and nothing here reads it.
//
// A package is released when it has a version that is not `planned`. Its documented version is the
// version of data/api/<Name>.json when that file exists, else its latest released version.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, describeRange, describeVersionFamily, parseVersion, satisfies, tryParseRange } from "./semver.mjs";
import { SITE_FOLDERS } from "./content-packages.mjs";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const INDEX_FILE = "data/index.json";
export const DEFAULT_INDEX_URL = "https://raw.githubusercontent.com/AstreoX/uBotCore/main/Index/index.json";
export const PLUGIN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FOLDER_RE = /^[A-Za-z0-9._-]+$/;

/** URL slug of a package in the reference: its name in lower case. */
export const packageSlug = (name) => String(name).toLowerCase();
export const packagePath = (name) => `/reference/${packageSlug(name)}/`;
/** How the docs write a package's name: "UBotSensor" -> "uBotSensor" (the folder name of the plugin). */
export const packageLabel = (name) => String(name).replace(/^UBot(?=[A-Z0-9_]|$)/, "uBot");
/**
 * The plugin's folder in the docs and its URL: the name without the "UBot" prefix, in lower case
 * ("UBotSensor" -> "sensor"). The folder holds the manual of a released plugin, the placeholder page
 * of a planned one; it never changes when the plugin is released.
 */
export const docsSlug = (name) => String(name).replace(/^UBot(?=[A-Z0-9_])/, "").toLowerCase() || String(name).toLowerCase();
export const docsPath = (name) => `/${docsSlug(name)}/`;

const byName = (a, b) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);

/** Index text in a locale ({ en, "zh-CN" } or a plain string), English as the fallback. */
export function localized(text, locale = "zh-CN") {
  if (typeof text === "string") return text.trim();
  return (typeof text?.[locale] === "string" && text[locale].trim() ? text[locale] : typeof text?.en === "string" ? text.en : "").trim();
}

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
    this.label = packageLabel(raw.name);
    this.docsSlug = docsSlug(raw.name);
    this.docsPath = docsPath(raw.name);
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
    /** The newest planned version of a package that has no release (0.1.0), else null. */
    this.planned = this.releasedVersions.length ? null : this.versions[0] ?? null;
    this.apiVersion = apiVersion ?? null;
    this.hasApi = apiVersion != null;
    const fromApi = apiVersion ? this.versions.find((v) => compareVersions(v.version, apiVersion) === 0) : null;
    /** The index entry of the documented version (null when data/api names a version the index does not list). */
    this.documented = fromApi ?? (apiVersion ? null : this.latest ?? this.versions[0] ?? null);
    this.documentedVersion = apiVersion ?? this.documented?.version ?? "";
  }

  description(locale = "zh-CN") {
    return localized(this.raw.description, locale);
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
      .map((p) => new Package(p, apiVersions.get(p.name)));
    this.byName = new Map(this.packages.map((p) => [p.name, p]));
  }

  /** Every package in the order of the index. */
  list() {
    return [...this.packages];
  }
  /** Released packages first, then the planned ones, each group in index order: the order of the sidebar. */
  ordered() {
    return [...this.released(), ...this.planned()];
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
  /** The package whose docs folder is `slug` ("sensor" -> UBotSensor), or null. */
  byDocsSlug(slug) {
    return this.packages.find((p) => p.docsSlug === slug) ?? null;
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

  /**
   * The index's recipes (uBot Manager's preset package sets) in index order: [{ id, name, description,
   * packages, available }]. Texts are zh-CN with an English fallback, packages in registry order. A
   * recipe is available, as in uBot Manager, when every package in it is in the index and released.
   */
  recipes(locale = "zh-CN") {
    const list = Array.isArray(this.index.recipes) ? this.index.recipes : [];
    return list
      .filter((r) => r && typeof r.id === "string" && r.id && Array.isArray(r.packages) && r.packages.length)
      .map((r) => {
        const names = r.packages.filter((n) => typeof n === "string");
        const known = names.map((n) => this.get(n)).filter(Boolean);
        return {
          id: r.id,
          name: localized(r.name, locale) || r.id,
          description: localized(r.description, locale),
          packages: [...new Set(known.map((p) => p.name))].sort((a, b) => this.packages.indexOf(this.get(a)) - this.packages.indexOf(this.get(b))),
          available: known.length === names.length && known.every((p) => p.released),
        };
      });
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
  const slugs = new Map();
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
    const slug = docsSlug(name);
    if (SITE_FOLDERS.includes(slug)) err(line, `${where}: its docs folder "${slug}/" is a section of the site (${SITE_FOLDERS.join(", ")}); rename the package`);
    else if (slugs.has(slug)) err(line, `${where}: uses the docs folder "${slug}/" like ${slugs.get(slug)}`);
    slugs.set(slug, name);
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
  // Recipes only feed the recipe tables (<RecipeTable />): problems there are warnings.
  if (data.recipes != null && !Array.isArray(data.recipes)) warn(1, `"recipes" must be an array; the recipe tables are empty`);
  for (const r of Array.isArray(data.recipes) ? data.recipes : []) {
    const id = typeof r?.id === "string" ? r.id : "";
    const line = id ? lineOf("id", id) : 1;
    if (!id || !Array.isArray(r.packages) || !r.packages.length) {
      warn(line, `recipe ${id || "?"}: needs an "id" and a non-empty "packages" list; the recipe tables leave it out`);
      continue;
    }
    const unknown = r.packages.filter((n) => typeof n !== "string" || !names.has(n.toLowerCase()));
    if (unknown.length) warn(line, `recipe ${id}: ${unknown.map((n) => JSON.stringify(n)).join(", ")} is not in the index; the recipe tables leave the recipe out`);
  }
  return out;
}

/** Line of a package's `"name": "<name>"` in the index text (1 when not found), for check messages. */
export function packageLine(text, name) {
  return makePairFinder(text)("name", name);
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
 * The "需要" line of a page: the declared packages with a short version text, the required
 * dependencies that are not declared themselves, and the engine plugins all of them need (in package
 * order, each once). Without a range the version text is the family of the package's current version
 * ("0.1.x"; see describeVersionFamily). Unknown names are skipped (npm run check reports them).
 */
export function requirementsOf(specs, registry) {
  const declared = [];
  for (const spec of Array.isArray(specs) ? specs : []) {
    const parsed = parsePackageSpec(spec);
    const pkg = parsed.error ? null : registry.get(parsed.name);
    if (!pkg || declared.some((d) => d.name === pkg.name)) continue;
    const version = parsed.range ? describeRange(parsed.range) : pkg.current ? describeVersionFamily(pkg.current.version) : "";
    declared.push({ name: pkg.name, label: pkg.label, friendlyName: pkg.friendlyName, href: pkg.released ? pkg.path : "", version });
  }
  const names = new Set(declared.map((d) => d.name));
  const deps = [];
  for (const d of declared) {
    for (const dep of registry.dependencies(d.name)) {
      if (names.has(dep) || deps.some((x) => x.name === dep)) continue;
      const pkg = registry.get(dep);
      deps.push({ name: dep, label: pkg?.label ?? packageLabel(dep), friendlyName: pkg?.friendlyName ?? dep, href: pkg?.released ? pkg.path : "" });
    }
  }
  const order = (x) => registry.list().findIndex((p) => p.name === x.name);
  deps.sort((a, b) => order(a) - order(b));
  const enginePlugins = [];
  for (const x of [...declared, ...deps].sort((a, b) => order(a) - order(b))) {
    for (const plugin of registry.get(x.name)?.enginePlugins ?? []) if (!enginePlugins.includes(plugin)) enginePlugins.push(plugin);
  }
  return { declared, dependencies: deps, enginePlugins };
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
