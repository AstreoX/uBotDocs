// Server-side HTML for Blueprint nodes, graphs and node cards. The markup is readable without
// JavaScript; src/scripts/blueprint.js only draws the wires and opens the cards.
import { NODE_KINDS, pinColor, describeType, typeText, isExec } from "./types.mjs";
import { layoutGraph } from "./layout.mjs";
import { nodeLocation, typeHref } from "./paths.mjs";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Escaped text where `backticks` become <code> (captions, notes and Chinese summaries). */
export const richText = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

const kindOf = (def) => (def.kind in NODE_KINDS ? def.kind : "node");

/** First paragraph of a UE tooltip, with single line breaks joined. */
export function firstParagraph(text) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  return t.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, " ");
}

/** Tooltip as paragraphs (UE keeps the comment's line breaks). */
export function paragraphs(text) {
  return String(text ?? "")
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------- pin glyphs

/** A pass-by-reference pin that the function may change (UPARAM(ref)); drawn as a diamond in UE. */
export const isMutableRef = (type) => Boolean(type?.byRef && !type?.const);

/** SVG glyph of a pin. `key` becomes data-pin (wire endpoint), `on` = connected (filled). */
export function pinGlyph(type, { key = "", on = false } = {}) {
  const color = pinColor(type);
  const attr = key ? ` data-pin="${esc(key)}"` : "";
  const cls = `bp-g${on ? " on" : ""}`;
  const fill = on ? color : "none";
  if (isExec(type)) {
    return `<svg class="${cls} bp-gx"${attr} viewBox="0 0 12 12" aria-hidden="true"><path d="M1.6 1.6h4.4l4.3 4.4-4.3 4.4H1.6z" fill="${on ? color : "none"}" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  }
  const container = type?.container ?? "none";
  if (container === "array") {
    const cells = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push(`<rect x="${1 + x * 3.6}" y="${1 + y * 3.6}" width="2.6" height="2.6"/>`);
    return `<svg class="${cls}"${attr} viewBox="0 0 12 12" aria-hidden="true"><g fill="${color}" fill-opacity="${on ? 1 : 0.45}">${cells.join("")}</g></svg>`;
  }
  if (container === "set") {
    return `<svg class="${cls}"${attr} viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="2.5" fill="${fill}" stroke="${color}" stroke-width="1.4"/><circle cx="6" cy="6" r="1.4" fill="${color}"/></svg>`;
  }
  if (container === "map") {
    const vcolor = pinColor(type.valueType);
    return `<svg class="${cls}"${attr} viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.4a4.6 4.6 0 0 0 0 9.2z" fill="${on ? color : "none"}" stroke="${color}" stroke-width="1.4"/><path d="M6 1.4a4.6 4.6 0 0 1 0 9.2z" fill="${on ? vcolor : "none"}" stroke="${vcolor}" stroke-width="1.4"/></svg>`;
  }
  if (type?.category === "delegate" || type?.category === "mcdelegate") {
    return `<svg class="${cls}"${attr} viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1" fill="${fill}" stroke="${color}" stroke-width="1.4"/></svg>`;
  }
  // UE draws the diamond only for mutable references (SGraphPin::IsByMutableRef). A const reference
  // (`const FVector&`, a Break node's struct input, an event's struct parameter) is a plain circle.
  if (isMutableRef(type)) {
    return `<svg class="${cls}"${attr} viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.2 10.8 6 6 10.8 1.2 6z" fill="${fill}" stroke="${color}" stroke-width="1.4"/></svg>`;
  }
  return `<svg class="${cls}"${attr} viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.3" fill="${fill}" stroke="${color}" stroke-width="1.6"/></svg>`;
}

// ---------------------------------------------------------------- node pieces

const ICONS = {
  call: `<svg class="bp-ic" viewBox="0 0 12 12" aria-hidden="true"><text x="6" y="9.6" text-anchor="middle" font-size="10.5" font-style="italic" font-weight="700" fill="currentColor">f</text></svg>`,
  event: `<svg class="bp-ic" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.6 6h3.4M6.6 4.5 8 6 6.6 7.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`,
  struct: `<svg class="bp-ic" viewBox="0 0 12 12" aria-hidden="true"><g fill="currentColor"><rect x="1.5" y="1.5" width="4" height="4" rx=".6"/><rect x="6.5" y="1.5" width="4" height="4" rx=".6"/><rect x="1.5" y="6.5" width="4" height="4" rx=".6"/><rect x="6.5" y="6.5" width="4" height="4" rx=".6"/></g></svg>`,
  node: `<svg class="bp-ic" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h3.2M5.2 6 9 2.5M5.2 6 9 9.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
};
ICONS.pure = ICONS.call;
ICONS.make = ICONS.struct;
ICONS.break = ICONS.struct;

const CLOCK = `<svg class="bp-latent" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 3.2V6l2 1.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;

function formatNumber(s) {
  const t = String(s).trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return t;
  if (!t.includes(".")) return t;
  const trimmed = t.replace(/0+$/, "");
  return trimmed.endsWith(".") ? `${trimmed}0` : trimmed;
}

const VALUE_CATEGORIES = new Set(["bool", "byte", "enum", "int", "int64", "float", "double", "name", "string", "text", "vector", "rotator"]);

/**
 * The little default-value widget UE draws next to an unconnected input. `explicit` = the value comes
 * from the graph's `set:`. Reference inputs have no widget in UE (UEdGraphSchema_K2::
 * ShouldHidePinDefaultValue) unless they carry a default (AutoCreateRefTerm).
 */
function valueWidget(pin, value, explicit = false) {
  const t = pin.type;
  if (!t || t.container !== "none") return "";
  if (t.byRef && !explicit && (value === "" || value == null)) return "";
  if (t.category === "struct" && t.subtype === "FLinearColor" && value) {
    const m = /R=([\d.]+),G=([\d.]+),B=([\d.]+)/.exec(value);
    if (m) {
      const c = [m[1], m[2], m[3]].map((x) => Math.round(Math.min(1, Math.max(0, Number(x))) ** (1 / 2.2) * 255));
      return `<span class="bp-val bp-swatch" style="background:rgb(${c.join(",")})"></span>`;
    }
    return "";
  }
  if (!VALUE_CATEGORIES.has(t.category)) return "";
  if (t.category === "bool") {
    const on = String(value).toLowerCase() === "true";
    return `<span class="bp-val bp-check${on ? " on" : ""}"></span>`;
  }
  if (value === "" || value == null) return t.category === "string" || t.category === "text" || t.category === "name" ? `<span class="bp-val bp-text"></span>` : "";
  let shown = value;
  if (["float", "double", "int", "int64", "byte"].includes(t.category)) shown = formatNumber(value);
  if (t.category === "vector" || t.category === "rotator") shown = String(value).split(",").map((x) => formatNumber(x.trim())).join(", ");
  const cls = ["string", "text", "name", "enum"].includes(t.category) ? "bp-text" : "bp-num";
  return `<span class="bp-val ${cls}">${esc(shown)}</span>`;
}

/**
 * Pins of a node that should be drawn, given connections and options, following what the Blueprint
 * editor does:
 *
 * - `hideUnconnected` is the pin visibility option of Break/Make nodes: unticked pins do not exist.
 * - A Break node with more than five pins marks every pin from the fourth on as advanced
 *   (UK2Node_BreakStruct::AllocateDefaultPins), counted over the pins that exist, so hiding pins can
 *   leave a Break node without an advanced section.
 * - A collapsed advanced section shows only linked advanced pins and the ▾ arrow. Giving an advanced
 *   pin a value (`set:`) means the reader expanded the node: every advanced pin is shown, with ▴.
 *
 * Returns { inputs: [{pin, index}], outputs: [...], delegateIndex, arrow: "" | "down" | "up" }.
 */
export function visiblePins(def, { connected = new Set(), values = {}, hideUnconnected = false, expandAdvanced = false, key = "" } = {}) {
  const isOn = (side, i) => connected.has(`${key}:${side}:${i}`);
  const isDelegateOut = (pin) => def.kind === "event" && (pin.type?.category === "delegate" || pin.type?.category === "mcdelegate");
  // Pin options only cover a struct node's field pins; its struct pin always exists.
  const optional = (side) => (def.kind === "break" ? side === "o" : def.kind === "make" ? side === "i" : true);
  const exists = (side) => ({ pin, index }) =>
    !(side === "o" && isDelegateOut(pin)) &&
    !(hideUnconnected && optional(side) && !isOn(side, index) && !isExec(pin.type) && values[pin.id] == null);
  let inputs = (def.inputs ?? []).map((pin, index) => ({ pin, index, side: "i" })).filter(exists("i"));
  let outputs = (def.outputs ?? []).map((pin, index) => ({ pin, index, side: "o" })).filter(exists("o"));

  const advanced = new Set();
  const all = [...inputs, ...outputs];
  if (def.kind === "break" && hideUnconnected) {
    if (all.length > 5) all.slice(3).forEach((p) => advanced.add(p));
  } else {
    for (const p of all) if (p.pin.advanced) advanced.add(p);
  }
  const expanded = expandAdvanced || [...advanced].some((p) => values[p.pin.id] != null);
  if (!expanded) {
    const keep = (p) => !advanced.has(p) || isOn(p.side, p.index);
    inputs = inputs.filter(keep);
    outputs = outputs.filter(keep);
  }
  const strip = ({ pin, index }) => ({ pin, index });
  const delegateIndex = def.kind === "event" ? (def.outputs ?? []).findIndex(isDelegateOut) : -1;
  return { inputs: inputs.map(strip), outputs: outputs.map(strip), delegateIndex, arrow: advanced.size ? (expanded ? "up" : "down") : "" };
}

function pinRow({ pin, index }, side, { key, connected, values, showValues, compact }) {
  const k = key ? `${key}:${side}:${index}` : "";
  const on = key ? connected.has(k) : false;
  const glyph = pinGlyph(pin.type, { key: k, on });
  const label = compact || !pin.name ? "" : `<span class="bp-pl">${esc(pin.name)}</span>`;
  const explicit = values[pin.id] != null;
  const value = side === "i" && showValues && !on && !isExec(pin.type) && !compact ? valueWidget(pin, explicit ? values[pin.id] : pin.default, explicit) : "";
  return side === "i"
    ? `<span class="bp-pin">${glyph}${label}${value}</span>`
    : `<span class="bp-pin bp-po">${label}${glyph}</span>`;
}

/** Accessible name of a node button. */
export function nodeLabel(def) {
  const kind = NODE_KINDS[kindOf(def)].label;
  const what = def.kind === "variable" ? "变量" : `${kind}节点`;
  return `${def.title}，${what}`;
}

/**
 * HTML of one node. Options: key (graph node key; enables data-pin ids), connected (Set of
 * "key:i:index"/"key:o:index"), values (pin id -> shown default), hideUnconnected, expandAdvanced,
 * interactive (button vs. static div), note (marker number).
 */
export function renderNode(def, opts = {}) {
  const { key = "", connected = new Set(), values = {}, interactive = false, note = 0 } = opts;
  const kind = kindOf(def);
  const kc = NODE_KINDS[kind].color;
  const vis = visiblePins(def, { connected, values, hideUnconnected: opts.hideUnconnected, expandAdvanced: opts.expandAdvanced, key });
  const showValues = true;
  const tag = interactive ? "button" : "div";
  const label = nodeLabel(def);
  const a11y = interactive
    ? ` type="button" data-key="${esc(key)}" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(`${label}。打开说明`)}"`
    : ` role="img" aria-label="${esc(label)}"`;
  const noteBadge = note ? `<span class="bp-note-badge" aria-hidden="true">${note}</span>` : "";
  const flags = def.flags ?? {};
  const classes = ["bp-node", `k-${kind}`];
  if (def.inline) classes.push("bp-inline");
  if (flags.deprecated) classes.push("bp-deprecated");

  if (def.kind === "variable") {
    const outs = vis.outputs.map((p) => pinRow(p, "o", { key, connected, values, showValues: false })).join("");
    const color = pinColor(def.outputs[0]?.type);
    return `<${tag} class="${classes.join(" ")} bp-var"${a11y} style="--vc:${color}"><span class="bp-bd">${outs}</span>${noteBadge}</${tag}>`;
  }

  if (flags.compact) {
    classes.push("bp-compact");
    const ins = vis.inputs.map((p) => pinRow(p, "i", { key, connected, values, showValues, compact: true })).join("");
    const outs = vis.outputs.map((p) => pinRow(p, "o", { key, connected, values, showValues, compact: true })).join("");
    return `<${tag} class="${classes.join(" ")}"${a11y}><span class="bp-bd"><span class="bp-col bp-in">${ins}</span><span class="bp-ctitle" aria-hidden="true">${esc(def.compactTitle || def.title)}</span><span class="bp-col bp-out">${outs}</span></span>${noteBadge}</${tag}>`;
  }

  // UE draws an event's delegate output as a small square in the title bar. The exporter omits that
  // pin, so draw it here as decoration unless the data includes it.
  const delegatePin = vis.delegateIndex >= 0
    ? pinRow({ pin: def.outputs[vis.delegateIndex], index: vis.delegateIndex }, "o", { key, connected, values, showValues: false, compact: true })
    : def.kind === "event" && !def.inline
      ? `<span class="bp-pin bp-po">${pinGlyph({ category: "delegate", subtype: "", subtypeDisplay: "", container: "none", valueType: null, byRef: false, const: false })}</span>`
      : "";
  const icon = ICONS[kind] ?? ICONS.node;
  const latent = flags.latent ? CLOCK : "";
  const sub = def.subtitle ? def.subtitle.split("\n").map((l) => `<span class="bp-sub">${esc(l)}</span>`).join("") : "";
  const head = `<span class="bp-hd" style="--kc:${kc}"><span class="bp-ht">${icon}<span class="bp-title">${esc(def.title)}</span>${latent}${delegatePin ? `<span class="bp-hdpin">${delegatePin}</span>` : ""}</span>${sub}</span>`;
  const ins = vis.inputs.map((p) => pinRow(p, "i", { key, connected, values, showValues })).join("");
  const outs = vis.outputs.map((p) => pinRow(p, "o", { key, connected, values, showValues })).join("");
  const body = ins || outs ? `<span class="bp-bd"><span class="bp-col bp-in">${ins}</span><span class="bp-col bp-out">${outs}</span></span>` : "";
  const adv = vis.arrow ? `<span class="bp-adv" aria-hidden="true">${vis.arrow === "down" ? "▾" : "▴"}</span>` : "";
  const dev = flags.developmentOnly ? `<span class="bp-dev" aria-hidden="true">Development Only</span>` : "";
  return `<${tag} class="${classes.join(" ")}"${a11y}>${head}${body}${adv}${dev}${noteBadge}</${tag}>`;
}

// ---------------------------------------------------------------- cards (popover content)

/** Summary text for a node: Chinese overlay when fresh, else the English tooltip, else a fallback. */
export function nodeSummary(def, overlay) {
  if (def.inline) return { text: def.tooltip || "这个节点没有登记在 API 数据里（inline 节点），引脚未经校验。", lang: def.tooltip ? "en" : "zh" };
  if (def.kind === "variable") return { text: `组件或变量引用。在 Components 面板里把 ${def.variable.name} 拖进事件图即可得到它。`, lang: "zh" };
  const s = overlay ? overlay.summary(def.id, def.tooltip) : { text: def.tooltip ?? "", lang: "en" };
  if (s.text) return { text: s.lang === "en" ? firstParagraph(s.text) : s.text, lang: s.lang };
  const struct = def.inputs?.[0]?.type?.subtypeDisplay || def.outputs?.[0]?.type?.subtypeDisplay || "";
  if (def.kind === "break") return { text: `把 ${struct} 拆成各个字段。`, lang: "zh" };
  if (def.kind === "make") return { text: `用各个字段构造 ${struct}。`, lang: "zh" };
  return { text: "暂无说明。", lang: "zh" };
}

function typeHtml(type, registry) {
  const { name, note } = describeType(type);
  const href = registry ? typeHref(registry, type) : null;
  const n = href ? `<a href="${esc(href)}"><code>${esc(name)}</code></a>` : `<code>${esc(name)}</code>`;
  return note ? `${n} <span class="bp-tn">${esc(note)}</span>` : n;
}

function cardPins(list, side, registry) {
  const pins = (list ?? []).filter((p) => !(p.type?.category === "delegate" && side === "o"));
  if (!pins.length) return `<p class="bp-card-none">无</p>`;
  return `<ul class="bp-card-pins">${pins
    .map((p) => {
      const glyph = pinGlyph(p.type, { on: true });
      const name = p.name || (isExec(p.type) ? "执行" : p.id);
      const type = isExec(p.type) ? "" : ` ${typeHtml(p.type, registry)}`;
      return `<li>${glyph}<span class="bp-card-pn">${esc(name)}</span>${type}</li>`;
    })
    .join("")}</ul>`;
}

/** Card shown when a node is clicked. `href` links to the reference. */
export function renderCard(def, { cardId, registry, overlay } = {}) {
  const kind = kindOf(def);
  const k = NODE_KINDS[kind];
  const sum = nodeSummary(def, overlay);
  const entry = registry && !def.inline && def.kind !== "variable" ? registry.nodeEntry(def.id) : null;
  const loc = entry ? nodeLocation(registry, def.id) : null;
  const ownerName = !def.subtitle && def.owner && registry ? registry.classEntry(def.owner)?.item.displayName : "";
  const zhTitle = def.titleZh ? `中文界面：${def.titleZh}` : "";
  const where = [def.subtitle?.split("\n")[0] || ownerName, entry ? (entry.isEngine ? "UE 引擎" : entry.plugin) : "", zhTitle].filter(Boolean).join(" · ");
  let foot = "";
  if (loc) foot = `<p class="bp-card-foot"><a href="${esc(loc.href)}">查看参考</a><code>${esc(def.id)}</code></p>`;
  else if (def.kind === "variable") {
    const href = registry ? typeHref(registry, def.outputs[0].type) : null;
    foot = href ? `<p class="bp-card-foot"><a href="${esc(href)}">查看 ${esc(def.variable.classDisplay)}</a></p>` : "";
  } else if (def.inline) foot = `<p class="bp-card-foot bp-card-warn">inline 节点：未在 data/api 中登记</p>`;
  const showInputs = def.kind !== "variable" && !(def.kind === "event" && !(def.inputs ?? []).length);
  const body = `${showInputs ? `<p class="bp-card-h">输入</p>${cardPins(def.inputs, "i", registry)}` : ""}<p class="bp-card-h">输出</p>${cardPins(def.outputs, "o", registry)}`;
  return `<section class="bp-card" data-card="${esc(cardId)}" aria-labelledby="${esc(cardId)}-t"><header class="bp-card-hd"><span class="bp-kind" style="background:${k.color}">${esc(k.label)}</span><div><p class="bp-card-title" id="${esc(cardId)}-t">${esc(def.title)}</p>${where ? `<p class="bp-card-sub">${esc(where)}</p>` : ""}</div></header><p class="bp-card-sum"${sum.lang === "en" ? ' lang="en"' : ""}>${richText(sum.text)}</p>${body}${foot}</section>`;
}

// ---------------------------------------------------------------- graphs

/**
 * The wires as text for screen readers (the drawn wires are decorative): one list item per wire,
 * "<node> 的 <pin>，连到 <node> 的 <pin>". Visually hidden (.bp-sr).
 */
export function renderWireList(graph) {
  if (!graph.wires.length) return "";
  const title = (key) => graph.nodes.find((n) => n.key === key)?.def.title ?? key;
  const pin = (p) => p.name || (isExec(p.type) ? "执行" : p.id);
  const items = graph.wires
    .map((w) => `<li>${esc(title(w.from.key))} 的 ${esc(pin(w.from.pin))}，连到 ${esc(title(w.to.key))} 的 ${esc(pin(w.to.pin))}</li>`)
    .join("");
  return `<div class="bp-sr" data-pagefind-ignore="all"><p>连线：</p><ol>${items}</ol></div>`;
}

/**
 * Full figure for a resolved graph (see graph.mjs). `graphId` must be unique on the page.
 */
export function renderGraph(graph, { graphId, registry, overlay }) {
  const positions = layoutGraph(graph.nodes, graph.wires);
  const connected = new Set();
  const index = (key, side, pin) => {
    const n = graph.nodes.find((x) => x.key === key);
    const list = side === "o" ? n.def.outputs : n.def.inputs;
    return list.indexOf(pin);
  };
  const wireData = graph.wires.map((w) => {
    const a = `${w.from.key}:o:${index(w.from.key, "o", w.from.pin)}`;
    const b = `${w.to.key}:i:${index(w.to.key, "i", w.to.pin)}`;
    connected.add(a);
    connected.add(b);
    return [a, b, w.exec ? "#f2f2f2" : pinColor(w.type), w.exec ? 1 : 0];
  });
  const cols = Math.max(0, ...[...positions.values()].map((p) => p.col)) + 1;
  const cells = graph.nodes
    .map((n) => {
      const pos = positions.get(n.key);
      const html = renderNode(n.def, {
        key: n.key,
        connected,
        values: n.values,
        hideUnconnected: n.hideUnconnected,
        interactive: true,
        note: n.noteIndex,
      });
      const cap = n.def.flags?.compact ? `<span class="bp-cap" aria-hidden="true">${esc(n.def.title)}</span>` : "";
      return `<div class="bp-cell" style="grid-column:${pos.col + 1};grid-row:${pos.row + 1}">${html}${cap}</div>`;
    })
    .join("");
  const cards = graph.nodes.map((n) => renderCard(n.def, { cardId: `${graphId}-${n.key}`, registry, overlay })).join("");
  const caption = graph.caption ? `<figcaption class="bp-caption">${richText(graph.caption)}</figcaption>` : `<span class="bp-caption"></span>`;
  const notes = graph.notes.length
    ? `<ol class="bp-notes">${graph.notes.map((n) => `<li><span class="bp-note-badge" aria-hidden="true">${n.index}</span><span>${richText(n.text)}</span></li>`).join("")}</ol>`
    : "";
  const label = graph.caption ? `蓝图：${graph.caption}` : "蓝图";
  const expand = `<button type="button" class="bp-expand" aria-pressed="false"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span class="bp-expand-t">全屏查看</span></button>`;
  return (
    `<figure class="bp-figure not-content" id="${esc(graphId)}" data-bp-graph>` +
    `<div class="bp-canvas" tabindex="0" role="group" aria-label="${esc(label)}"><div class="bp-fit">` +
    `<div class="bp-stage" style="grid-template-columns:repeat(${cols},max-content)" data-wires="${esc(JSON.stringify(wireData))}">` +
    `<svg class="bp-wires" aria-hidden="true"></svg>${cells}</div></div></div>${renderWireList(graph)}` +
    `<div class="bp-bar">${caption}<span class="bp-hint" hidden>左右滑动查看</span>${expand}</div>` +
    `${notes}<div class="bp-cards" hidden data-pagefind-ignore="all">${cards}</div></figure>`
  );
}

/** A single static node on a small canvas, for reference pages. */
export function renderStandaloneNode(def) {
  const html = renderNode(def, { expandAdvanced: true, interactive: false });
  const cap = def.flags?.compact ? `<span class="bp-cap" aria-hidden="true">${esc(def.title)}</span>` : "";
  return `<div class="bp-figure bp-single not-content"><div class="bp-canvas"><div class="bp-fit"><div class="bp-stage"><div class="bp-cell">${html}${cap}</div></div></div></div></div>`;
}

/** Visible error box used by the Markdown plugin in dev when a block does not validate. */
export function renderErrorBox(diagnostics) {
  const items = diagnostics.map((d) => `<li><code>${esc(d.file)}:${d.line}</code> ${esc(d.message)}</li>`).join("");
  return `<div class="bp-error not-content" role="alert"><p>蓝图代码块有错误：</p><ul>${items}</ul></div>`;
}

export { typeText };
