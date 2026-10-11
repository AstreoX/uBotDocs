// Reference provider "blueprint": classes, structs, enums and Blueprint nodes from data/api/<Package>.json
// (UBotDocExport, format 1), Chinese summaries from data/zh, engine nodes from data/api/engine.json.
//
// Pages it writes (paths relative to src/content/docs/reference/):
//   nodes.md                              node index of every package and the engine nodes
//   engine.md                             engine nodes (only when data/api/engine.json exists)
//   <package>/<classid>.md                one page per class
//   <package>/structs/<structid>.md       one page per struct (folder only when there are structs)
//   <package>/enums/<enumid>.md           one page per enum
// and the class, struct and enum tables on the package's home page (<package>/index.md, written by
// the framework in lib/reference/index.mjs).
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { loadSite } from "../blueprint/site.mjs";
import { NODE_KINDS, describeType, isExec } from "../blueprint/types.mjs";
import { firstParagraph, paragraphs, renderStandaloneNode, richText } from "../blueprint/render.mjs";
import {
  ENGINE_PATH, NODE_INDEX_PATH, classPath, enumPath, nodeAnchor, nodeLocation, propertyAnchor, safeId, structPath, typeHref,
} from "../blueprint/paths.mjs";
import { GENERATED, byName, esc, frontmatter, mdText, shortDescription } from "./common.mjs";

const CLASS_KIND_LABELS = {
  component: "组件",
  object: "对象",
  library: "函数库",
  subsystem: "子系统",
  settings: "设置",
  interface: "接口",
  actor: "Actor",
};
const ACCESS_LABELS = { readWrite: "读写", readOnly: "只读", none: "不可访问" };
const EDITABLE_LABELS = { anywhere: "可编辑", defaultsOnly: "仅默认值可编辑", instanceOnly: "仅实例可编辑", none: "不可编辑" };
// The access most properties have (BlueprintReadOnly, EditAnywhere). The property table states it
// once above the table and repeats it only on the rows that differ.
const isCommonAccess = (p) => p.access === "readOnly" && p.editable === "anywhere";
const COMMON_ACCESS_NOTE = "未特别标注的属性：蓝图里只读，Details 面板里可以编辑。";

export const blueprintProvider = {
  id: "blueprint",
  label: "蓝图 API",
  /** Data files (relative to data/) this provider reads for one package. */
  dataFiles: (pkg) => [`api/${pkg.name}.json`, `zh/${pkg.name}/`],
  /** Data files (relative to data/) it reads for the whole site. */
  siteDataFiles: ["api/engine.json", "zh/Engine/"],
  /** Fixed sidebar entries after 概览, from the data folder alone (astro.config.mjs calls this). */
  sidebarLinks({ dataDir }) {
    const links = [{ label: "节点索引", link: NODE_INDEX_PATH }];
    if (existsSync(join(dataDir, "api", "engine.json"))) links.push({ label: "引擎节点", link: ENGINE_PATH });
    return links;
  },
  /** Reads the data once; throws when data/api has errors. Returns the provider's instance. */
  load(ctx) {
    const site = loadSite(ctx.root, { dataDir: ctx.dataDir });
    const apiDir = relative(ctx.root, join(ctx.dataDir, "api")).replaceAll("\\", "/");
    const fatal = site.diagnostics.filter((d) => d.severity === "error" && d.file.startsWith(apiDir));
    if (fatal.length) {
      const lines = fatal.map((d) => `${d.file}:${d.line}: error: ${d.message}`);
      throw new Error(`${lines.join("\n")}\ndata/api has errors; fix them (npm run check) before generating.`);
    }
    return createInstance(site, ctx);
  },
};

function createInstance({ registry, overlay }, ctx) {
  const fileOf = (plugin) => registry.files.find((f) => f.plugin === plugin);

  /** Summary block: Chinese overlay when fresh, else the English tooltip paragraphs. */
  function summaryHtml(id, tooltip, { fallback = "" } = {}) {
    const s = overlay.summary(id, tooltip);
    if (s.lang === "zh" && s.text) return `<p>${richText(s.text)}</p>`;
    const ps = paragraphs(tooltip);
    if (ps.length) return `<div class="ref-en" lang="en">${ps.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`;
    return fallback ? `<p>${esc(fallback)}</p>` : "";
  }
  const summaryText = (id, tooltip) => overlay.summary(id, tooltip).text;

  function typeCell(type) {
    const { name, note } = describeType(type);
    const href = typeHref(registry, type);
    const n = href ? `<a href="${esc(href)}"><code>${esc(name)}</code></a>` : `<code>${esc(name)}</code>`;
    return note ? `${n}<span class="ref-sub">${esc(note)}</span>` : n;
  }

  function formatNumber(t) {
    if (!/^-?\d+\.\d+$/.test(t)) return t;
    const trimmed = t.replace(/0+$/, "");
    return trimmed.endsWith(".") ? `${trimmed}0` : trimmed;
  }
  function formatDefault(value, type) {
    const v = String(value ?? "");
    if (v === "") return type?.category === "string" || type?.category === "name" || type?.category === "text" ? '<code>""</code>' : "—";
    if (type?.category === "bool") return `<code>${v.toLowerCase()}</code>`;
    if (["float", "double"].includes(type?.category)) return `<code>${esc(formatNumber(v))}</code>`;
    const xyz = /^\(X=([^,]+),Y=([^,]+),Z=([^)]+)\)$/.exec(v);
    if (xyz) return `<code>(${[xyz[1], xyz[2], xyz[3]].map(formatNumber).join(", ")})</code>`;
    return `<code>${esc(v)}</code>`;
  }

  function headerLink(file, header) {
    if (!header) return "<dd>—</dd>";
    if (!file.repository) return `<dd><code>${esc(header)}</code></dd>`;
    const url = `${file.repository}/blob/v${file.version}/${header}`;
    return `<dd><a href="${esc(url)}"><code>${esc(header)}</code></a></dd>`;
  }

  // --------------------------------------------------------------------- node sections

  function pinsTable(node) {
    // UE falls back to the function's name for an undocumented return value; that adds nothing here.
    const tipOf = (p) => (p.tooltip && p.tooltip !== node.title && p.tooltip !== node.tooltip ? p.tooltip : "");
    const rows = [];
    for (const [side, list] of [["输入", node.inputs], ["输出", node.outputs]]) {
      for (const p of list ?? []) {
        if (isExec(p.type) && !p.name) continue;
        if (p.id === "self") continue; // the subtitle ("Target is …") and the drawing already say it
        if (node.kind === "event" && (p.type?.category === "delegate" || p.type?.category === "mcdelegate")) continue;
        rows.push({ side, p });
      }
    }
    if (!rows.length) return "";
    const hasDefault = rows.some(({ side, p }) => side === "输入" && p.default !== "" && !isExec(p.type));
    const hasTip = rows.some(({ p }) => tipOf(p));
    const head = `<tr><th>引脚</th><th>方向</th><th>类型</th>${hasDefault ? "<th>默认值</th>" : ""}${hasTip ? "<th>说明</th>" : ""}</tr>`;
    const body = rows
      .map(({ side, p }) => {
        const name = p.name || p.id;
        const idNote = p.name && p.name.replace(/\s+/g, "") !== p.id ? `<span class="ref-sub"><code>${esc(p.id)}</code></span>` : "";
        const type = isExec(p.type) ? "执行" : typeCell(p.type);
        const def = hasDefault ? `<td>${side === "输入" && !isExec(p.type) && p.default !== "" ? formatDefault(p.default, p.type) : ""}</td>` : "";
        const tip = hasTip ? `<td lang="en">${esc(tipOf(p))}</td>` : "";
        const adv = p.advanced ? `<span class="ref-badge">高级</span>` : "";
        return `<tr><td>${esc(name)}${adv}${idNote}</td><td class="ref-dir">${side}</td><td>${type}</td>${def}${tip}</tr>`;
      })
      .join("");
    return `<table class="ref-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  function nodeSection(node, { isEngine = false, level = 3 } = {}) {
    const anchor = nodeAnchor(node, isEngine);
    const hashes = "#".repeat(level);
    const kind = NODE_KINDS[node.kind] ?? NODE_KINDS.node;
    const flags = [];
    if (node.flags?.latent) flags.push("延迟节点");
    if (node.flags?.developmentOnly) flags.push("仅开发版本");
    if (node.flags?.deprecated) flags.push("已弃用");
    if (node.flags?.callInEditor) flags.push("可在编辑器中调用");
    const zhTitle = node.titleZh ? `<span class="ref-zh"> · 中文界面：${esc(node.titleZh)}</span>` : "";
    const meta = `<p class="ref-meta-line"><span class="ref-kind" style="background:${kind.color}"></span>${esc(kind.label)}${flags.map((f) => `<span class="ref-badge">${esc(f)}</span>`).join("")} · <code>${esc(node.id)}</code>${zhTitle}</p>`;
    const fallback = node.kind === "break" ? "把结构体拆成各个字段。" : node.kind === "make" ? "用各个字段构造结构体。" : "";
    return [
      `${hashes} ${mdText(node.title)} {#${anchor}}`,
      "",
      `${renderStandaloneNode(node)}${meta}${summaryHtml(node.id, node.tooltip, { fallback })}${pinsTable(node)}`,
      "",
    ].join("\n");
  }

  // --------------------------------------------------------------------- class pages

  /** Exported ancestors of a class, nearest first (plugin classes only; engine classes are not exported). */
  function ancestorsOf(cls) {
    const list = [];
    const seen = new Set([cls.id]);
    let cur = registry.classEntry(cls.parent);
    while (cur && !cur.isEngine && !seen.has(cur.item.id)) {
      seen.add(cur.item.id);
      list.push(cur);
      cur = registry.classEntry(cur.item.parent);
    }
    return list;
  }

  /**
   * The exporter lists an inherited property again on a subclass when the subclass changes its default
   * (a sensor's Update Rate Hz). The nearest ancestor that lists it holds the value the subclass replaces.
   */
  function inheritedEntry(cls, propId) {
    for (const a of ancestorsOf(cls)) {
      const prop = (a.item.properties ?? []).find((x) => x.id === propId);
      if (prop) return { owner: a, prop };
    }
    return null;
  }

  function propertyRows(cls) {
    const props = [...(cls.properties ?? [])].filter((p) => p.type?.category !== "mcdelegate");
    props.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : a.displayName < b.displayName ? -1 : 1));
    return props
      .map((p) => {
        const base = inheritedEntry(cls, p.id);
        const inherited = base?.prop;
        const defCell = formatDefault(p.default, p.type) + (inherited && inherited.default !== p.default ? `<span class="ref-sub">父类默认 ${formatDefault(inherited.default, p.type)}</span>` : "");
        const meta = [];
        const m = p.meta ?? {};
        if (m.ClampMin && m.ClampMax) meta.push(`范围 ${m.ClampMin} – ${m.ClampMax}`);
        else if (m.ClampMin) meta.push(`最小 ${m.ClampMin}`);
        else if (m.ClampMax) meta.push(`最大 ${m.ClampMax}`);
        if (m.Units || m.ForceUnits) meta.push(`单位 ${m.Units ?? m.ForceUnits}`);
        if (m.EditCondition) {
          const cond = (cls.properties ?? []).find((x) => x.id === m.EditCondition) ?? inheritedEntry(cls, m.EditCondition)?.prop;
          meta.push(`需先勾选 ${cond ? cond.displayName : m.EditCondition}`);
        }
        // An inherited row has no summary of its own: use the declaring class's (Chinese if written).
        const own = overlay.summary(`${cls.id}.${p.id}`, p.tooltip);
        const s = inherited && own.lang === "en" ? overlay.summary(`${base.owner.item.id}.${p.id}`, inherited.tooltip) : own;
        const desc = s.text;
        const descHtml = desc ? `<span${s.lang === "en" ? ' lang="en"' : ""}>${richText(firstParagraph(desc))}</span>` : "";
        if (!isCommonAccess(p)) meta.push(`蓝图${ACCESS_LABELS[p.access] ?? p.access}，Details ${EDITABLE_LABELS[p.editable] ?? p.editable}`);
        const metaHtml = meta.length ? `<span class="ref-sub">${esc(meta.join("；"))}</span>` : "";
        const badge = inherited ? `<a class="ref-badge" href="${esc(`${classPath(base.owner.plugin, base.owner.item.id)}#${propertyAnchor(p.id)}`)}" title="${esc(`在 ${base.owner.item.displayName} 中声明`)}">继承</a>` : "";
        return `<tr id="${propertyAnchor(p.id)}"><td>${esc(p.displayName)}${badge}<span class="ref-sub"><code>${esc(p.id)}</code> · ${esc(p.category)}</span></td><td>${typeCell(p.type)}</td><td>${defCell}</td><td>${descHtml}${metaHtml}</td></tr>`;
      })
      .join("");
  }

  function classPage(entry, order) {
    const cls = entry.item;
    const file = fileOf(entry.plugin);
    const parent = registry.classEntry(cls.parent);
    const parentHtml = parent && !parent.isEngine
      ? `<a href="${esc(classPath(parent.plugin, cls.parent))}">${esc(parent.item.displayName)}</a> <code>${esc(cls.parent)}</code>`
      : `<code>${esc(cls.parent || "—")}</code>`;
    const kindBits = [CLASS_KIND_LABELS[cls.kind] ?? cls.kind];
    if (cls.flags?.abstract) kindBits.push("抽象类");
    if (cls.kind === "component" && cls.flags?.spawnable) kindBits.push("可在 Components 面板添加");
    if (cls.flags?.blueprintable) kindBits.push("可作为蓝图父类");
    if (cls.flags?.deprecated) kindBits.push("已弃用");
    const meta = `<dl class="ref-meta"><dt>C++</dt><dd><code>${esc(cls.id)}</code></dd><dt>父类</dt><dd>${parentHtml}</dd><dt>类型</dt><dd>${esc(kindBits.join(" · "))}</dd><dt>模块</dt><dd><code>${esc(cls.module)}</code> · ${esc(entry.plugin)} ${esc(entry.version)}</dd><dt>头文件</dt>${headerLink(file, cls.header)}</dl>`;

    const nodes = (cls.nodes ?? []).map((id) => registry.node(id)).filter(Boolean);
    const events = nodes.filter((n) => n.kind === "event").sort((a, b) => (a.title < b.title ? -1 : 1));
    const functions = nodes.filter((n) => n.kind !== "event").sort((a, b) => (a.title < b.title ? -1 : 1));
    const parts = [frontmatter({ title: cls.displayName, description: shortDescription(summaryText(cls.id, cls.tooltip)) || `${cls.displayName}（${cls.id}）的蓝图节点和属性。`, label: cls.displayName, order }), GENERATED(entry.file), "", meta, "", summaryHtml(cls.id, cls.tooltip), ""];

    if (functions.length) {
      parts.push("## 函数 {#functions}", "");
      for (const n of functions) parts.push(nodeSection(n));
    }
    if (events.length) {
      parts.push("## 事件 {#events}", "", "<p>在 Components 面板选中组件，在 Details 面板底部 Events 区点事件旁的 <strong>+</strong> 即可生成事件节点。</p>", "");
      for (const n of events) parts.push(nodeSection(n));
    }
    const rows = propertyRows(cls);
    if (rows) {
      parts.push("## 属性 {#properties}", "");
      const hasCommon = (cls.properties ?? []).some((p) => p.type?.category !== "mcdelegate" && isCommonAccess(p));
      if (hasCommon) parts.push(`<p class="ref-legend">${COMMON_ACCESS_NOTE}</p>`, "");
      parts.push(`<table class="ref-table ref-props"><thead><tr><th>属性</th><th>类型</th><th>默认值</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>`, "");
    }

    // Nodes and properties inherited from exported ancestors: compact lists of links. Properties this
    // class (or a nearer ancestor) lists again with a new default are in the table above instead.
    const inherited = [];
    const listed = new Set((cls.properties ?? []).map((p) => p.id));
    for (const a of ancestorsOf(cls)) {
      const ns = (a.item.nodes ?? []).map((id) => registry.node(id)).filter(Boolean).sort((x, y) => (x.title < y.title ? -1 : 1));
      const ps = (a.item.properties ?? []).filter((p) => p.type?.category !== "mcdelegate" && !listed.has(p.id)).sort((x, y) => (x.displayName < y.displayName ? -1 : 1));
      for (const p of a.item.properties ?? []) listed.add(p.id);
      if (ns.length || ps.length) inherited.push({ cls: a, nodes: ns, props: ps });
    }
    if (inherited.length) {
      parts.push("## 继承的节点和属性 {#inherited}", "");
      const chips = (links) => `<ul class="ref-chips">${links.map((l) => `<li>${l}</li>`).join("")}</ul>`;
      for (const { cls: c, nodes: ns, props: ps } of inherited) {
        const page = classPath(c.plugin, c.item.id);
        const rows2 = [];
        if (ns.length) rows2.push(`<dt>节点</dt><dd>${chips(ns.map((n) => `<a href="${esc(nodeLocation(registry, n.id).href)}"><code>${esc(n.title)}</code></a>`))}</dd>`);
        if (ps.length) rows2.push(`<dt>属性</dt><dd>${chips(ps.map((p) => `<a href="${esc(`${page}#${propertyAnchor(p.id)}`)}"><code>${esc(p.displayName)}</code></a>`))}</dd>`);
        parts.push(`<p class="ref-from">来自 <a href="${esc(page)}">${esc(c.item.displayName)}</a></p><dl class="ref-inherited">${rows2.join("")}</dl>`, "");
      }
    }
    return parts.join("\n");
  }

  // --------------------------------------------------------------------- structs and enums

  function structPage(entry, order) {
    const s = entry.item;
    const file = fileOf(entry.plugin);
    const breakNode = s.break ? registry.node(s.break) : null;
    const makeNode = s.make ? registry.node(s.make) : null;
    const order2 = breakNode ? new Map(breakNode.outputs.map((p, i) => [p.id, i])) : new Map();
    const fields = [...(s.fields ?? [])].sort((a, b) => (order2.get(a.id) ?? 999) - (order2.get(b.id) ?? 999) || (a.id < b.id ? -1 : 1));
    const nodesBits = [breakNode ? `<a href="#Break">Break</a>` : "", makeNode ? `<a href="#Make">Make</a>` : ""].filter(Boolean).join(" · ") || "无";
    const meta = `<dl class="ref-meta"><dt>C++</dt><dd><code>${esc(s.id)}</code></dd><dt>模块</dt><dd><code>${esc(s.module)}</code> · ${esc(entry.plugin)} ${esc(entry.version)}</dd><dt>节点</dt><dd>${nodesBits}</dd><dt>头文件</dt>${headerLink(file, s.header)}</dl>`;
    const hasDesc = fields.some((f) => summaryText(`${s.id}.${f.id}`, f.tooltip));
    const rows = fields
      .map((f) => {
        const d = summaryText(`${s.id}.${f.id}`, f.tooltip);
        const sl = overlay.summary(`${s.id}.${f.id}`, f.tooltip);
        return `<tr id="${propertyAnchor(f.id)}"><td>${esc(f.displayName)}<span class="ref-sub"><code>${esc(f.id)}</code></span></td><td>${typeCell(f.type)}</td><td>${esc(ACCESS_LABELS[f.access] ?? f.access)}</td>${hasDesc ? `<td${sl.lang === "en" ? ' lang="en"' : ""}>${richText(firstParagraph(d))}</td>` : ""}</tr>`;
      })
      .join("");
    const parts = [
      frontmatter({ title: s.displayName, description: shortDescription(summaryText(s.id, s.tooltip)) || `结构体 ${s.displayName}（${s.id}）的字段。`, label: s.displayName, order }),
      GENERATED(entry.file), "", meta, "", summaryHtml(s.id, s.tooltip), "",
      "## 字段 {#fields}", "",
      `<table class="ref-table"><thead><tr><th>字段</th><th>类型</th><th>蓝图</th>${hasDesc ? "<th>说明</th>" : ""}</tr></thead><tbody>${rows}</tbody></table>`, "",
    ];
    if (breakNode || makeNode) {
      parts.push("## 节点 {#nodes}", "");
      if (breakNode) parts.push(nodeSection(breakNode));
      if (makeNode) parts.push(nodeSection(makeNode));
    }
    return parts.join("\n");
  }

  function enumPage(entry, order) {
    const e = entry.item;
    const file = fileOf(entry.plugin);
    const values = [...(e.values ?? [])].sort((a, b) => a.value - b.value);
    const meta = `<dl class="ref-meta"><dt>C++</dt><dd><code>${esc(e.id)}</code></dd><dt>模块</dt><dd><code>${esc(e.module)}</code> · ${esc(entry.plugin)} ${esc(entry.version)}</dd><dt>头文件</dt>${headerLink(file, e.header)}</dl>`;
    const rows = values
      .map((v) => {
        const s = overlay.summary(`${e.id}.${v.id}`, v.tooltip);
        return `<tr id="${propertyAnchor(v.id)}"><td>${esc(v.displayName)}<span class="ref-sub"><code>${esc(v.id)}</code></span></td><td>${v.value}</td><td${s.lang === "en" ? ' lang="en"' : ""}>${esc(firstParagraph(s.text))}</td></tr>`;
      })
      .join("");
    return [
      frontmatter({ title: e.displayName, description: shortDescription(summaryText(e.id, e.tooltip)) || `枚举 ${e.displayName}（${e.id}）的取值。`, label: e.displayName, order }),
      GENERATED(entry.file), "", meta, "", summaryHtml(e.id, e.tooltip), "",
      "## 取值 {#values}", "",
      `<table class="ref-table"><thead><tr><th>值</th><th>数值</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>`, "",
    ].join("\n");
  }

  // --------------------------------------------------------------------- package home page sections

  const itemsOf = (map, plugin) =>
    [...map.values()].filter((e) => e.plugin === plugin && !e.isEngine).sort((a, b) => byName(a.item.displayName, b.item.displayName) || byName(a.item.id, b.item.id));

  function packageSections(pkg) {
    const plugin = pkg.name;
    const classes = itemsOf(registry.classes, plugin);
    const structs = itemsOf(registry.structs, plugin);
    const enums = itemsOf(registry.enums, plugin);
    const parts = [];
    if (classes.length) {
      parts.push("## 类 {#classes}", "");
      parts.push(`<table class="ref-table"><thead><tr><th>名称</th><th>类型</th><th>节点</th><th>说明</th></tr></thead><tbody>${classes
        .map((c) => `<tr><td><a href="${esc(classPath(plugin, c.item.id))}">${esc(c.item.displayName)}</a><span class="ref-sub"><code>${esc(c.item.id)}</code></span></td><td>${esc(CLASS_KIND_LABELS[c.item.kind] ?? c.item.kind)}</td><td>${(c.item.nodes ?? []).length}</td><td class="ref-desc">${esc(shortDescription(summaryText(c.item.id, c.item.tooltip)))}</td></tr>`)
        .join("")}</tbody></table>`, "");
    }
    if (structs.length) {
      parts.push("## 结构体 {#structs}", "");
      parts.push(`<table class="ref-table"><thead><tr><th>名称</th><th>字段</th><th>说明</th></tr></thead><tbody>${structs
        .map((s) => `<tr><td><a href="${esc(structPath(plugin, s.item.id))}">${esc(s.item.displayName)}</a><span class="ref-sub"><code>${esc(s.item.id)}</code></span></td><td>${(s.item.fields ?? []).length}</td><td class="ref-desc">${esc(shortDescription(summaryText(s.item.id, s.item.tooltip)))}</td></tr>`)
        .join("")}</tbody></table>`, "");
    }
    if (enums.length) {
      parts.push("## 枚举 {#enums}", "");
      parts.push(`<table class="ref-table"><thead><tr><th>名称</th><th>取值</th><th>说明</th></tr></thead><tbody>${enums
        .map((e) => `<tr><td><a href="${esc(enumPath(plugin, e.item.id))}">${esc(e.item.displayName)}</a><span class="ref-sub"><code>${esc(e.item.id)}</code></span></td><td>${(e.item.values ?? []).length}</td><td class="ref-desc">${esc(shortDescription(summaryText(e.item.id, e.item.tooltip)))}</td></tr>`)
        .join("")}</tbody></table>`, "");
    }
    return parts;
  }

  // --------------------------------------------------------------------- site pages

  /** UE's display name of a C++ class that is not exported (engine classes): "UKismetMathLibrary" -> "Kismet Math Library". */
  function classDisplayName(cppName) {
    const bare = String(cppName).replace(/^[UAFI](?=[A-Z])/, "");
    return bare.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  }

  function ownerLabel(node, entry) {
    if (node.owner) return registry.classEntry(node.owner)?.item.displayName ?? classDisplayName(node.owner);
    if (node.kind === "make" || node.kind === "break") return node.inputs?.[0]?.type?.subtypeDisplay || node.outputs?.[0]?.type?.subtypeDisplay || "";
    return entry.isEngine ? "UE" : entry.plugin;
  }

  function nodeIndexPage(order) {
    const all = [...registry.nodes.values()].sort((a, b) => (a.item.title.toLowerCase() < b.item.title.toLowerCase() ? -1 : a.item.title.toLowerCase() > b.item.title.toLowerCase() ? 1 : a.item.id < b.item.id ? -1 : 1));
    const rows = all
      .map((entry) => {
        const n = entry.item;
        const kind = NODE_KINDS[n.kind] ?? NODE_KINDS.node;
        const loc = nodeLocation(registry, n.id);
        const owner = ownerLabel(n, entry);
        const summary = summaryText(n.id, n.tooltip);
        const camelWords = n.id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
        const search = [n.title, n.titleZh ?? "", n.id, camelWords, owner, n.keywords, summary, kind.label, entry.plugin].join(" ").toLowerCase().replace(/"/g, "");
        const source = entry.isEngine ? "UE 引擎" : entry.plugin;
        const ownerCell = owner && owner !== "UE" ? `${esc(owner)}<span class="ref-sub">${esc(source)}</span>` : esc(source);
        return `<tr data-search="${esc(search)}" data-package="${esc(entry.plugin)}"><td><span class="ref-kind" style="background:${kind.color}" title="${esc(kind.label)}"></span><a href="${esc(loc.href)}">${esc(n.title)}</a><span class="ref-sub">${esc(kind.label)}</span></td><td>${ownerCell}</td><td><code>${esc(n.id).replace(/([.:])/g, "$1<wbr>")}</code></td></tr>`;
      })
      .join("");
    // One option per package that has nodes, in registry order, then the engine nodes.
    const withNodes = new Set(all.map((e) => e.plugin));
    const options = ctx.packages.released().filter((p) => withNodes.has(p.name)).map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`);
    if (withNodes.has("Engine")) options.push(`<option value="Engine">UE 引擎</option>`);
    return [
      frontmatter({ title: "节点索引", description: "所有已登记蓝图节点的列表，可按名称、所属类、id 或插件过滤。", label: "节点索引", order }),
      GENERATED("data/api/*.json"), "",
      "<p>这里列出 uBot 插件的蓝图节点，以及文档用到的 UE 引擎节点。输入名称、所属类或 id 的一部分即可过滤，也可以只看一个插件；最后一列是写 <code>blueprint</code> 代码块时用的节点 id。</p>", "",
      `<div class="ref-filter"><input type="search" placeholder="例如 imu、Get Latest、Break" aria-label="过滤节点" data-node-filter="node-index" autocomplete="off"><select aria-label="按插件过滤" data-node-package="node-index"><option value="">全部插件</option>${options.join("")}</select><output data-node-count="node-index" aria-live="polite">${all.length}</output></div>`, "",
      `<table class="ref-table" id="node-index"><thead><tr><th>节点</th><th>所属</th><th>id</th></tr></thead><tbody>${rows}<tr class="ref-empty" hidden><td colspan="3">没有匹配的节点。换一个词或插件，或者清空过滤条件。</td></tr></tbody></table>`, "",
    ].join("\n");
  }

  function enginePage(order) {
    const nodes = [...registry.nodes.values()].filter((e) => e.isEngine);
    const groups = new Map();
    for (const e of nodes) {
      const label = e.item.owner ? registry.classEntry(e.item.owner)?.item.displayName ?? classDisplayName(e.item.owner) : "流程控制与特殊节点";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(e.item);
    }
    const engineFile = registry.files.find((f) => f.isEngine);
    const parts = [
      frontmatter({ title: "引擎节点", description: "文档示例里用到的 UE 5.5 自带蓝图节点。", label: "引擎节点", order }),
      GENERATED(engineFile?.file ?? "data/api/engine.json"), "",
      `<p>这些是 UE ${esc(engineFile?.version ?? "5.5")} 自带的节点，列在这里是因为文档里的蓝图图用到了它们。清单在 <code>data/engine-nodes/</code> 下的 <code>.txt</code> 文件里，数据由导出器写入 <code>data/api/engine.json</code>。完整说明见 Epic 的官方文档。</p>`, "",
    ];
    for (const label of [...groups.keys()].sort()) {
      parts.push(`## ${label} {#${safeId(label) || "nodes"}}`, "");
      for (const n of groups.get(label).sort((a, b) => (a.title < b.title ? -1 : 1))) parts.push(nodeSection(n, { isEngine: true }));
    }
    return parts.join("\n");
  }

  // --------------------------------------------------------------------- the provider interface

  return {
    /** True when data/api/<Package>.json exists. */
    covers: (pkg) => Boolean(fileOf(pkg.name)),
    /** The UE version of the documented data ("5.5"). */
    engineVersion: (pkg) => fileOf(pkg.name)?.data.engine ?? "",
    /** Data files the package's pages come from (for the "generated from" comment). */
    sources: (pkg) => (fileOf(pkg.name) ? [fileOf(pkg.name).file] : []),
    /** Rows of the package home page's metadata list: [[label, html]]. */
    packageMeta(pkg) {
      const file = fileOf(pkg.name);
      if (!file) return [];
      const modules = (file.data.modules ?? []).map((m) => `<code>${esc(m.name)}</code>（${esc(m.type)}）`).join("、");
      return [["模块", modules || "—"], ["数据", `<code>${esc(file.data.generator)}</code>`]];
    },
    packageSections,
    /** Writes the class, struct and enum pages of a package. `base` is the package's sidebar order. */
    packagePages(pkg, emit, { base }) {
      const plugin = pkg.name;
      const slug = pkg.slug;
      let order = base + 1;
      for (const c of itemsOf(registry.classes, plugin)) emit(`${slug}/${c.item.id.toLowerCase()}.md`, classPage(c, order++));
      const structs = itemsOf(registry.structs, plugin);
      if (structs.length) {
        emit(`${slug}/structs/_group.yml`, `# Generated by scripts/gen-reference.mjs\nlabel: 结构体\ncollapsed: true\n`);
        for (const s of structs) emit(`${slug}/structs/${s.item.id.toLowerCase()}.md`, structPage(s, base + 50 + structs.indexOf(s)));
      }
      const enums = itemsOf(registry.enums, plugin);
      if (enums.length) {
        emit(`${slug}/enums/_group.yml`, `# Generated by scripts/gen-reference.mjs\nlabel: 枚举\ncollapsed: true\n`);
        for (const e of enums) emit(`${slug}/enums/${e.item.id.toLowerCase()}.md`, enumPage(e, base + 80 + enums.indexOf(e)));
      }
    },
    /** Columns of the overview table of released packages. */
    overviewColumns: () => [
      { label: "类", cell: (pkg) => String(itemsOf(registry.classes, pkg.name).length) },
      { label: "节点", cell: (pkg) => String([...registry.nodes.values()].filter((e) => e.plugin === pkg.name).length) },
    ],
    /** Lines at the top of the overview page and under its table of released packages. */
    overviewIntro: () => [`参考页面由 UE 反射数据自动生成：节点标题、引脚名和默认值与蓝图编辑器里看到的一致。按名称找节点请用[节点索引](${NODE_INDEX_PATH})。`],
    overviewNotes: () => (registry.files.some((f) => f.isEngine) ? [`另有文档示例用到的 [UE 引擎节点](${ENGINE_PATH})。`] : []),
    /** Writes the node index and the engine node page. */
    sitePages(emit) {
      emit("nodes.md", nodeIndexPage(1));
      if (registry.files.some((f) => f.isEngine)) emit("engine.md", enginePage(9000));
    },
    nodeCount: () => registry.nodes.size,
  };
}
