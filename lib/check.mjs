// Content checks behind `npm run check`: API data, Chinese summaries, ```blueprint blocks and the
// writing rules in CLAUDE.md. Every finding is { severity, file, line, message }.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { compileBlueprint } from "./blueprint/graph.mjs";

export const CONTENT_DIR = "src/content/docs";
export const GENERATED_DIR = "src/content/docs/reference";
const PARAGRAPH_LIMIT = 200;
const SENTENCE_LIMIT = 3; // sentences per paragraph (CLAUDE.md: "at most 3 sentences")
const ADMONITION_SENTENCE_LIMIT = 2; // a callout is one or two sentences
const HOME_PAGE = `${CONTENT_DIR}/index.mdx`;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
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
    } else {
      const close = new RegExp(`^\\s{0,3}${open.char === "`" ? "`" : "~"}{${open.len},}\\s*$`);
      if (close.test(line)) {
        blocks.push({ lang: open.lang, line: open.line, body: open.body.join("\n") });
        open = null;
      } else open.body.push(line);
    }
  }
  if (open) blocks.push({ lang: open.lang, line: open.line, body: open.body.join("\n"), unclosed: true });
  return { frontmatter, fmError, bodyStart, blocks, prose, lines };
}

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

function isGuide(rel) {
  return rel.startsWith(`${CONTENT_DIR}/guides/`);
}
function isConcept(rel) {
  return rel.startsWith(`${CONTENT_DIR}/concepts/`);
}

/** Checks one hand-written page. */
export function checkPage(rel, text, registry) {
  const findings = [];
  const page = splitPage(text);
  if (page.fmError) findings.push({ severity: "error", file: rel, line: 1, message: `frontmatter: ${page.fmError}` });
  else if (!page.frontmatter) findings.push({ severity: "error", file: rel, line: 1, message: "page needs YAML frontmatter with a title" });
  else if (typeof page.frontmatter.title !== "string" || !page.frontmatter.title.trim()) findings.push({ severity: "error", file: rel, line: 1, message: "frontmatter: title is required" });
  else if (!page.frontmatter.description && page.frontmatter.template !== "splash") findings.push({ severity: "warning", file: rel, line: 1, message: "frontmatter: add a one-line description (used by search results and link previews)" });

  let graphs = 0;
  for (const b of page.blocks) {
    if (b.lang !== "blueprint") continue;
    graphs++;
    if (b.unclosed) {
      findings.push({ severity: "error", file: rel, line: b.line, message: "blueprint block is not closed" });
      continue;
    }
    const { diagnostics } = compileBlueprint(b.body, registry, { startLine: b.line, file: rel });
    findings.push(...diagnostics);
  }
  if (isGuide(rel) && graphs === 0) {
    findings.push({ severity: "error", file: rel, line: 1, message: "guide pages need at least one ```blueprint graph (see CLAUDE.md, Blueprint graphs)" });
  }
  if (isConcept(rel)) {
    const visual = graphs > 0 || page.prose.some(({ text }) => /^\s*\|.*\|\s*$/.test(text) || /<(svg|table|img)\b/.test(text) || /^\s*!\[/.test(text) || /<Image\b/.test(text));
    if (!visual) findings.push({ severity: "warning", file: rel, line: 1, message: "concept pages should have at least one diagram, graph or table" });
  }

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
  }
  findings.push(...styleFindings(page.prose, rel));
  return findings;
}

/** All hand-written pages under src/content/docs (the generated reference is skipped). */
export function contentFiles(root) {
  return walk(join(root, CONTENT_DIR))
    .map((abs) => relative(root, abs).replaceAll("\\", "/"))
    .filter((rel) => !rel.startsWith(`${GENERATED_DIR}/`));
}

export function checkContent(root, registry) {
  const findings = [];
  const files = contentFiles(root);
  for (const rel of files) {
    if (/\.mdx?$/.test(rel)) findings.push(...checkPage(rel, readFileSync(join(root, rel), "utf8"), registry));
    else if (rel.endsWith("/_group.yml")) {
      try {
        const meta = parseYaml(readFileSync(join(root, rel), "utf8")) ?? {};
        if (typeof meta.label !== "string" || !meta.label.trim()) findings.push({ severity: "error", file: rel, line: 1, message: "_group.yml needs label: <sidebar group name>" });
        const dir = rel.slice(0, -"/_group.yml".length);
        if (!files.some((f) => f.startsWith(`${dir}/`) && /\.mdx?$/.test(f))) findings.push({ severity: "warning", file: rel, line: 1, message: "folder has no pages (do not add empty stubs)" });
      } catch (e) {
        findings.push({ severity: "error", file: rel, line: 1, message: `YAML: ${e.message.split("\n")[0]}` });
      }
    }
  }
  return findings;
}

const ENGINE_LINE = [
  /^\/Script\/[A-Za-z0-9_]+\.[A-Za-z0-9_]+:[A-Za-z0-9_]+$/, // function: /Script/Module.Class:Function
  /^event \/Script\/[A-Za-z0-9_]+\.[A-Za-z0-9_]+:[A-Za-z0-9_]+$/, // event: event /Script/Module.Class:Event
  /^node \/Script\/[A-Za-z0-9_]+\.K2Node_[A-Za-z0-9_]+$/, // special node: node /Script/Module.K2Node_X
  /^macro \/[A-Za-z0-9_/]+\.[A-Za-z0-9_]+:[A-Za-z0-9_]+$/, // macro: macro /Path/Library.Library:Macro
];

/** data/engine-nodes.txt: one entry per line in the exporter's list format, no duplicates. */
export function checkEngineList(rel, text) {
  const findings = [];
  const seen = new Map();
  text.replace(/\r\n/g, "\n").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (!ENGINE_LINE.some((re) => re.test(line))) {
      findings.push({ severity: "error", file: rel, line: i + 1, message: `"${line}" is not in the list format: /Script/Module.Class:Function, event /Script/Module.Class:Event, node /Script/Module.K2Node_X or macro /Path/Lib.Lib:Macro` });
    } else if (seen.has(line)) {
      findings.push({ severity: "error", file: rel, line: i + 1, message: `"${line}" is listed twice (first on line ${seen.get(line)})` });
    } else seen.set(line, i + 1);
  });
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
