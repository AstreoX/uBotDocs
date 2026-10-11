// Content checks behind `npm run check`: API data, Chinese summaries, ```blueprint blocks, the
// packages pages declare, the page kinds (frontmatter `pageKind`) and the writing rules in CLAUDE.md.
// Every finding is { severity, file, line, message }.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { compileBlueprint } from "./blueprint/graph.mjs";
import { checkPackageSpecs } from "./packages.mjs";
import { PAGE_KINDS, effectivePackages, groupDefaults } from "./content-packages.mjs";

export { checkEngineList, checkEngineLists } from "./engine-nodes.mjs";

export const CONTENT_DIR = "src/content/docs";
export const GENERATED_DIR = "src/content/docs/reference";
const PARAGRAPH_LIMIT = 200;
const SENTENCE_LIMIT = 3; // sentences per paragraph (CLAUDE.md: "at most 3 sentences")
const ADMONITION_SENTENCE_LIMIT = 2; // a callout is one or two sentences
const HOME_PAGE = `${CONTENT_DIR}/index.mdx`;
/** The last section of a `guide` page (frontmatter pageKind). */
export const GUIDE_LAST_SECTION = "下一步";

/**
 * Files below `dir`, sorted. `skip` (an absolute path) is not entered; it is compared before anything
 * touches it, because the reference generator deletes and rewrites its folder at any time (another
 * process, or a test running scripts/gen-reference.mjs). A file or folder that disappears while the
 * walk runs is left out instead of failing it.
 */
function walk(dir, out = [], skip = null) {
  let names;
  try {
    names = readdirSync(dir).sort();
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return out;
    throw e;
  }
  for (const name of names) {
    const abs = join(dir, name);
    if (abs === skip) continue;
    let info;
    try {
      info = statSync(abs);
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    if (info.isDirectory()) walk(abs, out, skip);
    else out.push(abs);
  }
  return out;
}

/** Splits a page into frontmatter (parsed), body lines and fenced code blocks (with line numbers). */
export function splitPage(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let frontmatter = null;
  let fmError = null;
  let bodyStart = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      try {
        frontmatter = parseYaml(lines.slice(1, end).join("\n")) ?? {};
      } catch (e) {
        fmError = e.message.split("\n")[0];
      }
      bodyStart = end + 1;
    }
  }
  const blocks = [];
  const prose = []; // { line, text } outside code fences
  let stubLine = 0; // line of the {/* STUB */} marker, 0 when the page is written
  let open = null;
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    if (!open) {
      const m = /^(\s{0,3})(`{3,}|~{3,})\s*([^\s`{]*)/.exec(line);
      if (m) {
        open = { char: m[2][0], len: m[2].length, lang: m[3] ?? "", line: i + 1, body: [] };
        continue;
      }
      prose.push({ line: i + 1, text: line });
      if (!stubLine && STUB_MARKER.test(line)) stubLine = i + 1;
    } else {
      const close = new RegExp(`^\\s{0,3}${open.char === "`" ? "`" : "~"}{${open.len},}\\s*$`);
      if (close.test(line)) {
        blocks.push({ lang: open.lang, line: open.line, body: open.body.join("\n") });
        open = null;
      } else open.body.push(line);
    }
  }
  if (open) blocks.push({ lang: open.lang, line: open.line, body: open.body.join("\n"), unclosed: true });
  return { frontmatter, fmError, bodyStart, blocks, prose, lines, stubLine };
}

// The marker a page that is not written yet carries in its body: a JSX comment holding the word STUB
// (see docs-templates/ and CLAUDE.md, "Page templates").
export const STUB_MARKER = /\{\/\*\s*STUB\s*\*\/\}/;

const HAN = /[㐀-鿿豈-﫿]/;
const HAN_G = /[㐀-鿿豈-﫿]/g;

/** Rough reading length: Han characters plus Latin words and numbers. */
export function textLength(text) {
  const han = (text.match(HAN_G) ?? []).length;
  const words = (text.replace(HAN_G, " ").match(/[A-Za-z0-9_.+-]+/g) ?? []).length;
  return han + words;
}

const NOT_PARAGRAPH = /^\s*(#|\||-|\*|\+|>|\d+[.)]\s|:::|<|import\s|export\s|\{|!\[|\[\^)/;

/** Paragraphs (consecutive prose lines) with their first line number. */
export function proseParagraphs(prose) {
  const out = [];
  let cur = null;
  for (const { line, text } of prose) {
    const plain = text.trim() !== "" && !NOT_PARAGRAPH.test(text) && !/^\s{2,}/.test(text);
    if (plain) {
      if (!cur) cur = { line, text: text.trim() };
      else cur.text += text.trim();
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Prose with inline code, links targets, HTML tags and JSX expressions neutralised for style checks. */
function styleText(text) {
  return text
    .replace(/`[^`]*`/g, "x")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^}]*\}/g, " ");
}

/** Sentences in a text: Chinese sentence marks, and ASCII ones followed by a capital letter. */
export function sentenceCount(text) {
  const t = styleText(text);
  return (t.match(/[。！？]/g) ?? []).length + (t.match(/[.!?](?=\s+[A-Z])/g) ?? []).length + (/[A-Za-z0-9][.!?]\s*$/.test(t.trim()) ? 1 : 0);
}

/** :::note / :::tip / :::caution / :::danger blocks with their first line number and text. */
export function admonitions(prose) {
  const out = [];
  let cur = null;
  for (const { line, text } of prose) {
    const open = /^\s*:::(note|tip|caution|danger)\b/.exec(text);
    if (!cur && open) {
      cur = { line, kind: open[1], text: text.replace(/^\s*:::\w+(\[[^\]]*\])?\s*/, "") };
      continue;
    }
    if (cur) {
      if (/^\s*:::\s*$/.test(text)) {
        out.push({ ...cur, text: cur.text.trim() });
        cur = null;
      } else cur.text += ` ${text.trim()}`;
    }
  }
  return out;
}

export function styleFindings(prose, file) {
  const out = [];
  for (const { line, text } of prose) {
    const t = text.trim();
    if (!t || /^(import|export)\s/.test(t) || /^:::/.test(t)) continue;
    if (!HAN.test(t)) continue;
    const s = styleText(t);
    if (/[㐀-鿿][A-Za-z0-9]|[A-Za-z0-9][㐀-鿿]/.test(s)) {
      out.push({ severity: "warning", file, line, message: "style: put a space between Chinese and Latin letters, digits or code (中文 English 123)" });
    } else if (/[㐀-鿿][,;:!?()]|[,;:!?()][㐀-鿿]/.test(s)) {
      out.push({ severity: "warning", file, line, message: "style: use full-width punctuation next to Chinese text（，；：！？（））" });
    }
  }
  return out;
}

/** Line of a top-level frontmatter key ("packages:"), or 1. */
function frontmatterLine(lines, key) {
  if (lines[0] !== "---") return 1;
  const end = lines.indexOf("---", 1);
  const re = new RegExp(`^${key}\\s*:`);
  for (let i = 1; i < end; i++) if (re.test(lines[i])) return i + 1;
  return 1;
}

/** Package of a resolved graph node: its node's plugin, or the class of a variable; null for engine and inline nodes. */
function nodePackage(node, registry) {
  if (node.entry) return node.entry.isEngine ? null : node.entry.plugin;
  const classId = node.def?.variable?.classId;
  const cls = classId ? registry.classEntry(classId) : null;
  return cls && !cls.isEngine ? cls.plugin : null;
}

/**
 * The packages rules for one page: declared names and ranges exist, the pages of a plugin's manual
 * (the docs folder of a released package: sensor/, ros/, ...) declare at least one package (directly
 * or through the folder's _group.yml), graphs only use nodes of declared packages and their
 * dependencies (engine nodes are always fine; a page that declares nothing may use engine nodes
 * only, except the home page, which shows what a graph looks like and is about no package), and every
 * declared package is used by some graph.
 */
function packageFindings(rel, page, graphs, allCompiled, registry, { packages, defaults }) {
  const findings = [];
  const contentRel = rel.startsWith(`${CONTENT_DIR}/`) ? rel.slice(CONTENT_DIR.length + 1) : rel;
  const fm = page.frontmatter ?? {};
  const line = frontmatterLine(page.lines, "packages");
  const eff = effectivePackages(contentRel, fm, defaults);
  let declared = [];
  if (eff.source === "page") {
    const r = checkPackageSpecs(fm.packages, packages, { file: rel, line, where: "frontmatter packages" });
    findings.push(...r.findings);
    declared = r.packages;
  } else if (eff.source) {
    declared = checkPackageSpecs(eff.specs, packages, {}).packages; // the _group.yml reports its own errors
  }
  const via = eff.source && eff.source !== "page" ? ` (from ${CONTENT_DIR}/${eff.source}/_group.yml)` : "";
  // A released plugin's manual: every page except a placeholder is about that plugin.
  const manual = packages.byDocsSlug(contentRel.split("/")[0]);
  const inManual = Boolean(manual?.released) && contentRel.includes("/") && fm.pageKind !== "placeholder";
  if (inManual && !eff.specs.length) {
    findings.push({ severity: "error", file: rel, line, message: `pages of the ${manual.label} manual (${manual.docsSlug}/) declare the packages they are about: add packages: [${manual.name}] to the frontmatter, or packages: to the folder's _group.yml (see CLAUDE.md, Writing a page)` });
  }
  // Nothing usable declared: the errors above (unknown names, a manual page without packages) say what to fix.
  // Any other page that declares nothing still must not use nodes of a uBot package.
  if (!declared.length && (eff.specs.length || inManual || rel === HOME_PAGE)) return findings;

  const allowed = packages.closure(declared.map((d) => d.name));
  const used = new Set();
  const reported = new Set();
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      const pkg = nodePackage(node, registry);
      if (!pkg) continue;
      used.add(pkg);
      if (allowed.has(pkg) || reported.has(pkg)) continue;
      reported.add(pkg);
      const title = `node ${node.key} ("${node.def?.title ?? node.key}") comes from ${pkg}`;
      const message = declared.length
        ? `blueprint: ${title}, which the page does not declare (packages: ${declared.map((d) => d.name).join(", ")}${via}, plus their dependencies); add ${pkg} to packages: in the frontmatter`
        : `blueprint: ${title}, but the page declares no package; add packages: [${pkg}] to the frontmatter (graphs without packages may use engine nodes only)`;
      findings.push({ severity: "error", file: rel, line: node.line, message });
    }
  }
  if (graphs.length && allCompiled) {
    for (const d of declared) {
      if (!used.has(d.name)) findings.push({ severity: "warning", file: rel, line, message: `package ${d.name}${via} is declared but no graph on the page uses its nodes; declare the packages the page is about` });
    }
  }
  return findings;
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
/** Components that draw a table of packages or recipes from data/index.json. */
const TABLE_COMPONENT = /<(PackageList|RecipeTable)\b/;
/** What counts as a diagram on a concept page, besides a graph or a table. */
const VISUAL = /<(svg|table|img|DependencyGraph|SamplingTimeline|PackageList|RecipeTable)\b|^\s*!\[|<Image\b/;

/** `name="UBotX"` of the <PackageStatus> on a page, "" when there is none or no literal name. */
function packageStatusName(prose) {
  for (const { text } of prose) {
    const m = /<PackageStatus\b[^>]*\bname=["']([^"']+)["']/.exec(text);
    if (m) return m[1];
  }
  return "";
}

/** The rules of the page kinds (frontmatter pageKind; the structure of each is in docs-templates/). */
function kindFindings(rel, page, { graphs, stub, packages }) {
  const out = [];
  const fm = page.frontmatter ?? {};
  const kind = fm.pageKind;
  const add = (severity, line, message) => out.push({ severity, file: rel, line, message });
  const kindLine = frontmatterLine(page.lines, "pageKind");
  if (fm.graph !== undefined && typeof fm.graph !== "boolean") add("error", frontmatterLine(page.lines, "graph"), "frontmatter: graph must be true or false (false for a feature page that is not about Blueprint nodes)");
  const classified = fm.template !== "splash" && !/(^|\/)404\.mdx?$/.test(rel);
  if (classified && kind === undefined) {
    add("error", 1, `frontmatter: pageKind is required (${PAGE_KINDS.join(" | ")}); the structure of each is in docs-templates/ (see CLAUDE.md, Page templates)`);
    return out;
  }
  if (kind === undefined) return out;
  if (!PAGE_KINDS.includes(kind)) {
    add("error", kindLine, `frontmatter: pageKind "${kind}" is not one of ${PAGE_KINDS.join(" | ")}`);
    return out;
  }
  const hasTable = page.prose.some(({ text }) => TABLE_ROW.test(text) || /<table\b/.test(text) || TABLE_COMPONENT.test(text));
  if (kind === "placeholder") {
    if (graphs > 0) add("error", 1, "placeholder pages describe a plugin that is not released: no ```blueprint graph (the nodes do not exist yet)");
    const link = page.prose.find(({ text }) => /(\]\(|href=["'])\/reference\//.test(text));
    if (link) add("error", link.line, "placeholder pages may not link to the reference or name nodes (the plugin has none yet)");
    const status = page.prose.some(({ text }) => /<PackageStatus\b/.test(text));
    if (!status) add("error", 1, "placeholder pages show the status and the package data with <PackageStatus name=\"UBot…\" /> (import it from ../../../components/PackageStatus.astro); see docs-templates/placeholder.mdx");
    else if (packages) {
      const name = packageStatusName(page.prose);
      const pkg = name ? packages.get(name) : null;
      if (!name) add("error", 1, "PackageStatus needs a literal name=\"UBotX\"");
      else if (!pkg || pkg.name !== name) add("error", 1, `PackageStatus: unknown package "${name}"${pkg ? ` (did you mean ${pkg.name}?)` : ""}`);
      else if (pkg.released) add("warning", 1, `${pkg.name} is released: turn this placeholder into the manual (pageKind: overview, packages: [${pkg.name}]; see docs-templates/overview.mdx)`);
    }
  }
  if (stub) return out; // stubs are checked for what they are, not for what they will contain
  if (kind === "feature" && graphs === 0 && fm.graph !== false) {
    add("error", 1, "feature pages need at least one ```blueprint graph (see CLAUDE.md, Blueprint graphs); a page that is not about Blueprint nodes (installation, command line, C++) sets graph: false");
  }
  if (kind === "overview" && !hasTable) add("error", 1, "overview pages need a table (what the plugin can do, its components); see docs-templates/overview.mdx");
  if (kind === "guide") {
    // A guide (a tutorial or a tour) chooses its own sections, but it always ends with 下一步.
    const headings = page.prose.filter(({ text }) => /^##\s+\S/.test(text));
    const last = headings.at(-1);
    if (!last || last.text.replace(/^##\s+/, "").trim() !== GUIDE_LAST_SECTION) {
      add("error", last?.line ?? 1, `guide pages end with a "## ${GUIDE_LAST_SECTION}" section (links to what to read or do next); see docs-templates/guide.mdx`);
    }
  }
  if (kind === "concept") {
    const visual = graphs > 0 || page.prose.some(({ text }) => TABLE_ROW.test(text) || VISUAL.test(text));
    if (!visual) add("warning", 1, "concept pages should have at least one diagram, graph or table");
  }
  return out;
}

/**
 * Checks one hand-written page. With `packages` (the PackageRegistry) and `defaults` (folder defaults
 * from groupDefaults) it also checks the packages the page declares. `stubs` is the severity of a
 * page that is still a stub ("warning"; "error" for `npm run check -- --no-stubs`).
 */
export function checkPage(rel, text, registry, { packages = null, defaults = new Map(), stubs = "warning" } = {}) {
  const findings = [];
  const page = splitPage(text);
  if (page.fmError) findings.push({ severity: "error", file: rel, line: 1, message: `frontmatter: ${page.fmError}` });
  else if (!page.frontmatter) findings.push({ severity: "error", file: rel, line: 1, message: "page needs YAML frontmatter with a title" });
  else if (typeof page.frontmatter.title !== "string" || !page.frontmatter.title.trim()) findings.push({ severity: "error", file: rel, line: 1, message: "frontmatter: title is required" });
  else if (!page.frontmatter.description && page.frontmatter.template !== "splash") findings.push({ severity: "warning", file: rel, line: 1, message: "frontmatter: add a one-line description (used by search results and link previews)" });

  let graphs = 0;
  const compiled = [];
  let allCompiled = true;
  for (const b of page.blocks) {
    if (b.lang !== "blueprint") continue;
    graphs++;
    if (b.unclosed) {
      findings.push({ severity: "error", file: rel, line: b.line, message: "blueprint block is not closed" });
      allCompiled = false;
      continue;
    }
    const { graph, diagnostics } = compileBlueprint(b.body, registry, { startLine: b.line, file: rel });
    findings.push(...diagnostics);
    if (graph) compiled.push(graph);
    else allCompiled = false;
  }
  const stub = page.stubLine > 0;
  if (stub) {
    const kind = PAGE_KINDS.includes(page.frontmatter?.pageKind) ? page.frontmatter.pageKind : "feature";
    findings.push({ severity: stubs === "error" ? "error" : "warning", file: rel, line: page.stubLine, message: `stub page, not written yet: the checklist below the marker lists its sections, the structure is in docs-templates/${kind}.mdx (remove the STUB marker when the page is written)` });
  }
  if (packages && !page.fmError) findings.push(...packageFindings(rel, page, compiled, allCompiled, registry, { packages, defaults }));
  if (page.frontmatter && !page.fmError) findings.push(...kindFindings(rel, page, { graphs, stub, packages }));
  if (stub) return findings;

  for (const p of proseParagraphs(page.prose)) {
    const n = textLength(p.text);
    if (n > PARAGRAPH_LIMIT) findings.push({ severity: "warning", file: rel, line: p.line, message: `paragraph is long (${n} characters, aim for under ${PARAGRAPH_LIMIT}); split it, or use steps, a table or a graph` });
  }
  for (const p of proseParagraphs(page.prose)) {
    const n = sentenceCount(p.text);
    if (n > SENTENCE_LIMIT) findings.push({ severity: "warning", file: rel, line: p.line, message: `paragraph has ${n} sentences (at most ${SENTENCE_LIMIT}); split it, or use steps, a table or a graph` });
  }
  for (const a of admonitions(page.prose)) {
    const n = sentenceCount(a.text);
    if (n > ADMONITION_SENTENCE_LIMIT) findings.push({ severity: "warning", file: rel, line: a.line, message: `:::${a.kind} box has ${n} sentences (at most ${ADMONITION_SENTENCE_LIMIT}); keep boxes for short, real warnings and put the rest in steps or a table` });
  }
  if (rel !== HOME_PAGE) {
    const card = page.prose.find(({ text }) => /<(CardGrid|Card|LinkCard)\b/.test(text));
    if (card) findings.push({ severity: "warning", file: rel, line: card.line, message: "card grids are for navigation on the home page only; use a list, a table or a blueprint graph" });
  }
  if (page.frontmatter?.template !== "splash") {
    const first = page.prose.find(({ text }) => text.trim() && !/^\s*(import|export)\s/.test(text));
    if (first && /^\s*(#|<|:::|\||-|\d+\.)/.test(first.text)) {
      findings.push({ severity: "warning", file: rel, line: first.line, message: "start the page with one sentence saying what problem it solves" });
    }
    // The opening sentence is about the subject ("用 … 读取 …"), not about the page; a template's own
    // {/* … */} instructions are not the opening.
    const opening = page.prose.find(({ text }) => text.trim() && !/^\s*(import|export)\s/.test(text) && !/^\s*\{\/\*[\s\S]*\*\/\}\s*$/.test(text));
    if (opening && /这一页|这页|本页|本文/.test(opening.text)) {
      findings.push({ severity: "warning", file: rel, line: opening.line, message: "the first paragraph talks about the page (这一页, 本页, 本文); say directly what the page is for, e.g. “用 … 读取 …”" });
    }
  }
  findings.push(...styleFindings(page.prose, rel));
  return findings;
}

/** All hand-written files under src/content/docs (the generated reference folder is not entered). */
export function contentFiles(root) {
  return walk(join(root, CONTENT_DIR), [], join(root, GENERATED_DIR)).map((abs) => relative(root, abs).replaceAll("\\", "/"));
}

const GROUP_KEYS = ["label", "collapsed", "packages"];

/** The _group.yml files of the hand-written content: [{ rel, dir (relative to src/content/docs), meta, error }]. */
export function contentGroups(root) {
  return contentFiles(root)
    .filter((rel) => rel.endsWith("/_group.yml"))
    .map((rel) => {
      const dir = rel.slice(CONTENT_DIR.length + 1, -"/_group.yml".length);
      try {
        return { rel, dir, meta: parseYaml(readFileSync(join(root, rel), "utf8")) ?? {}, error: null };
      } catch (e) {
        return { rel, dir, meta: {}, error: e.message.split("\n")[0] };
      }
    });
}

/**
 * Hand-written pages with what the reference needs about them: [{ rel, contentRel, frontmatter,
 * packages: [names], source, stub }]. Pages without valid frontmatter are skipped.
 */
export function contentPages(root, packages) {
  const defaults = groupDefaults(contentGroups(root));
  const out = [];
  for (const rel of contentFiles(root).filter((f) => /\.mdx?$/.test(f))) {
    const page = splitPage(readFileSync(join(root, rel), "utf8"));
    if (!page.frontmatter || page.fmError) continue;
    const contentRel = rel.slice(CONTENT_DIR.length + 1);
    const eff = effectivePackages(contentRel, page.frontmatter, defaults);
    const names = checkPackageSpecs(eff.specs, packages, {}).packages.map((p) => p.name);
    out.push({ rel, contentRel, frontmatter: page.frontmatter, packages: names, source: eff.source, stub: page.stubLine > 0 });
  }
  return out;
}

/** `stubs`: severity of a page that is still a stub, "warning" or "error" (`npm run check -- --no-stubs`). */
export function checkContent(root, registry, { packages = null, stubs = "warning" } = {}) {
  const findings = [];
  const files = contentFiles(root);
  const groups = contentGroups(root);
  const defaults = groupDefaults(groups);
  for (const rel of files) {
    if (/\.mdx?$/.test(rel)) findings.push(...checkPage(rel, readFileSync(join(root, rel), "utf8"), registry, { packages, defaults, stubs }));
  }
  for (const { rel, dir, meta, error } of groups) {
    if (error) {
      findings.push({ severity: "error", file: rel, line: 1, message: `YAML: ${error}` });
      continue;
    }
    if (typeof meta.label !== "string" || !meta.label.trim()) findings.push({ severity: "error", file: rel, line: 1, message: "_group.yml needs label: <sidebar group name>" });
    for (const k of Object.keys(meta)) if (!GROUP_KEYS.includes(k)) findings.push({ severity: "warning", file: rel, line: 1, message: `unknown key "${k}" (allowed: ${GROUP_KEYS.join(", ")})` });
    if (packages && meta.packages !== undefined) {
      const text = readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n").split("\n");
      const line = text.findIndex((l) => /^packages\s*:/.test(l)) + 1 || 1;
      findings.push(...checkPackageSpecs(meta.packages, packages, { file: rel, line, where: "packages" }).findings);
    }
    if (!files.some((f) => f.startsWith(`${CONTENT_DIR}/${dir}/`) && /\.mdx?$/.test(f))) findings.push({ severity: "warning", file: rel, line: 1, message: "folder has no pages" });
  }
  return findings;
}

/**
 * package-lock.json must resolve every package from the official registry, so CI and cloud sessions
 * do not depend on a mirror. (A maintainer whose npm is configured with a mirror writes the mirror's
 * host into the lockfile when it is regenerated; see .npmrc.)
 */
export function checkLockfile(rel, text) {
  const hosts = new Map();
  for (const m of text.matchAll(/"resolved":\s*"(?:https?|git\+https?):\/\/([^/"]+)/g)) hosts.set(m[1], (hosts.get(m[1]) ?? 0) + 1);
  const other = [...hosts].filter(([host]) => host !== "registry.npmjs.org");
  if (!other.length) return [];
  const list = other.map(([host, n]) => `${host} (${n})`).join(", ");
  return [{ severity: "error", file: rel, line: 1, message: `${rel} resolves packages from ${list}; regenerate it against the official registry: delete the lockfile, then npm install --package-lock-only --registry=https://registry.npmjs.org/` }];
}

export function formatFinding(d) {
  return `${d.file}:${d.line}: ${d.severity}: ${d.message}`;
}

export function githubAnnotation(d) {
  const level = d.severity === "error" ? "error" : "warning";
  const msg = d.message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return `::${level} file=${d.file},line=${d.line}::${msg}`;
}
