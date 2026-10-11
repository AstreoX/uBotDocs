// Client side of the Blueprint graphs: draws the wires (SVG bezier curves between measured pin
// positions), opens the node cards, expands a graph to full screen, and filters the node index.
// Everything else is server-rendered (lib/blueprint/render.mjs) and readable without JavaScript.

const GRAPH = "[data-bp-graph]";
const PHONE = "(max-width: 50rem)";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The browser top layer (Popover API) paints above every stacking context. Starlight's main pane
// isolates its stacking context, so a plain position: fixed full-screen view would stay below the
// site header and sidebar and its exit button could not be reached. Without the API the CSS falls
// back to a raised z-index and lifts the isolation (html.bp-lock in blueprint.css).
const HAS_TOP_LAYER = typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

function toTopLayer(el, on) {
  if (!HAS_TOP_LAYER) return;
  try {
    if (on) {
      if (!el.hasAttribute("popover")) el.setAttribute("popover", "manual");
      if (!el.matches(":popover-open")) el.showPopover();
    } else if (el.matches(":popover-open")) {
      el.hidePopover();
    }
  } catch {
    // a failed top-layer request leaves the CSS fallback in charge
  }
}

// ------------------------------------------------------------------ wires

function drawWires(stage) {
  const svg = stage.querySelector(":scope > .bp-wires");
  if (!svg) return;
  let wires = [];
  try {
    wires = JSON.parse(stage.dataset.wires || "[]");
  } catch {
    wires = [];
  }
  const box = stage.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const w = stage.offsetWidth;
  const h = stage.offsetHeight;
  // The stage may be scaled down to fit (see fitGraph); measure in its own, unscaled pixels.
  const scale = box.width / w || 1;
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return [(r.left + r.width / 2 - box.left) / scale, (r.top + r.height / 2 - box.top) / scale];
  };
  let paths = "";
  for (const [from, to, color, exec] of wires) {
    const a = stage.querySelector(`[data-pin="${from}"]`);
    const b = stage.querySelector(`[data-pin="${to}"]`);
    if (!a || !b) continue;
    const [x1, y1] = center(a);
    const [x2, y2] = center(b);
    const span = x2 - x1;
    // UE-like tangents: proportional to the horizontal distance, larger when the wire runs backwards.
    const dx = span >= 0 ? Math.max(30, span * 0.5) : Math.max(80, -span * 0.6);
    paths += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1 + dx).toFixed(1)} ${y1.toFixed(1)} ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${color}" stroke-width="${exec ? 2.6 : 2}" fill="none" stroke-linecap="round"/>`;
  }
  svg.innerHTML = paths;
}

// Graphs a little wider than the column are scaled down to fit (never below MIN_FIT, so labels stay
// readable); wider ones scroll inside the canvas. Phones and the full-screen view use natural size.
const MIN_FIT = 0.72;

function fitGraph(fig) {
  const canvas = fig.querySelector(".bp-canvas");
  const fit = fig.querySelector(".bp-fit");
  const stage = fig.querySelector(".bp-stage");
  if (!canvas || !fit || !stage) return;
  stage.style.transform = "";
  fit.style.width = "";
  fit.style.height = "";
  const cs = getComputedStyle(canvas);
  const avail = canvas.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const w = stage.offsetWidth;
  const h = stage.offsetHeight;
  if (!w || avail <= 0) return;
  let scale = 1;
  if (w > avail && !fig.classList.contains("is-expanded") && !window.matchMedia(PHONE).matches) {
    scale = Math.max(MIN_FIT, avail / w);
  }
  if (scale < 1) {
    stage.style.transform = `scale(${scale})`;
    fit.style.width = `${Math.ceil(w * scale)}px`;
    fit.style.height = `${Math.ceil(h * scale)}px`;
  }
  const scrollable = canvas.scrollWidth > canvas.clientWidth + 1;
  fig.classList.toggle("is-scrollable", scrollable);
  const hint = fig.querySelector(".bp-hint");
  if (hint) hint.hidden = !scrollable || fig.classList.contains("is-expanded");
}

function drawAll() {
  document.querySelectorAll(GRAPH).forEach((fig) => {
    fitGraph(fig);
    const stage = fig.querySelector(".bp-stage");
    if (stage) drawWires(stage);
  });
}

let frame = 0;
function scheduleDraw() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    drawAll();
  });
}

// ------------------------------------------------------------------ cards

let pop = null;
let scrim = null;
let current = null;
let cardHome = null;

function ensurePop() {
  if (pop) return;
  scrim = document.createElement("div");
  scrim.className = "bp-scrim";
  scrim.hidden = true;
  pop = document.createElement("div");
  pop.className = "bp-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-modal", "false");
  pop.hidden = true;
  pop.innerHTML = `<button type="button" class="bp-pop-x" aria-label="关闭说明">×</button><div class="bp-pop-body"></div>`;
  // Both join the top layer while open, so a card also shows above the full-screen graph.
  scrim.setAttribute("popover", "manual");
  pop.setAttribute("popover", "manual");
  document.body.append(scrim, pop);
  pop.querySelector(".bp-pop-x").addEventListener("click", () => closeCard(true));
  scrim.addEventListener("click", () => closeCard(true));
}

// Enter the top layer in paint order: the scrim (phone only) first, the card on top of it.
function raisePop(withScrim) {
  toTopLayer(pop, false);
  toTopLayer(scrim, false);
  if (withScrim) toTopLayer(scrim, true);
  toTopLayer(pop, true);
}

function placePop(node) {
  const phone = window.matchMedia(PHONE).matches;
  pop.classList.toggle("is-sheet", phone);
  scrim.hidden = !phone;
  if (phone) {
    if (HAS_TOP_LAYER && !scrim.matches(":popover-open")) raisePop(true);
    pop.style.left = "";
    pop.style.top = "";
    return;
  }
  const fixed = Boolean(node.closest(".bp-figure.is-expanded"));
  pop.classList.toggle("is-fixed", fixed);
  const r = node.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const gap = 12;
  let left = r.right + gap;
  if (left + pw > vw - 16) left = r.left - pw - gap;
  if (left < 16) left = Math.min(Math.max(16, r.left), vw - pw - 16);
  let top = r.top;
  const overlaps = left < r.right && left + pw > r.left;
  if (overlaps) top = r.bottom + gap;
  if (top + ph > vh - 16) top = Math.max(16, (overlaps ? r.top - ph - gap : vh - ph - 16));
  const ox = fixed ? 0 : window.scrollX;
  const oy = fixed ? 0 : window.scrollY;
  pop.style.left = `${Math.round(left + ox)}px`;
  pop.style.top = `${Math.round(top + oy)}px`;
}

function openCard(node) {
  const fig = node.closest(GRAPH);
  if (!fig) return;
  const card = fig.querySelector(`.bp-cards [data-card="${fig.id}-${node.dataset.key}"]`);
  if (!card) return;
  ensurePop();
  if (current) closeCard(false);
  cardHome = { card, parent: card.parentElement, next: card.nextSibling };
  const body = pop.querySelector(".bp-pop-body");
  body.replaceChildren(card);
  pop.setAttribute("aria-labelledby", `${card.dataset.card}-t`);
  current = node;
  node.classList.add("is-selected");
  node.setAttribute("aria-expanded", "true");
  pop.hidden = false;
  pop.classList.toggle("no-motion", reducedMotion());
  raisePop(window.matchMedia(PHONE).matches);
  placePop(node);
  pop.querySelector(".bp-pop-x").focus({ preventScroll: true });
}

function closeCard(restoreFocus) {
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  scrim.hidden = true;
  toTopLayer(pop, false);
  toTopLayer(scrim, false);
  if (cardHome) {
    cardHome.parent.insertBefore(cardHome.card, cardHome.next);
    cardHome = null;
  }
  if (current) {
    current.classList.remove("is-selected");
    current.setAttribute("aria-expanded", "false");
    if (restoreFocus) current.focus({ preventScroll: true });
  }
  current = null;
}

// ------------------------------------------------------------------ expand

function setExpanded(fig, on) {
  closeCard(false);
  fig.classList.toggle("is-expanded", on);
  if (on) toTopLayer(fig, true);
  else {
    toTopLayer(fig, false);
    fig.removeAttribute("popover");
  }
  document.documentElement.classList.toggle("bp-lock", on);
  const btn = fig.querySelector(".bp-expand");
  if (btn) {
    const text = btn.querySelector(".bp-expand-t");
    if (text) text.textContent = on ? "退出全屏" : "全屏查看";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  scheduleDraw();
  if (on) fig.querySelector(".bp-canvas")?.focus({ preventScroll: true });
  else btn?.focus({ preventScroll: true });
}

// Keep Tab inside the full-screen view (and its open card): the page behind it is not reachable.
function trapFocus(e) {
  const fig = document.querySelector(`${GRAPH}.is-expanded`);
  if (!fig) return;
  const root = pop && !pop.hidden ? pop : fig;
  const items = [...root.querySelectorAll("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])")].filter(
    (el) => !el.closest("[hidden]") && el.getClientRects().length > 0,
  );
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!root.contains(active)) {
    first.focus();
    e.preventDefault();
  } else if (e.shiftKey && active === first) {
    last.focus();
    e.preventDefault();
  } else if (!e.shiftKey && active === last) {
    first.focus();
    e.preventDefault();
  }
}

// ------------------------------------------------------------------ node index filter

function setupFilters() {
  for (const input of document.querySelectorAll("[data-node-filter]")) {
    const table = document.getElementById(input.dataset.nodeFilter);
    if (!table || !table.tBodies[0]) continue;
    const rows = [...table.tBodies[0].rows].filter((row) => row.hasAttribute("data-search"));
    const empty = table.tBodies[0].querySelector(".ref-empty");
    const counter = document.querySelector(`[data-node-count="${input.dataset.nodeFilter}"]`);
    // Latin words match at the start of a word ("imu" finds "IMU Data", not "Simulation");
    // Chinese text matches anywhere.
    const matcher = (t) => {
      if (!/^[a-z0-9_.:-]+$/.test(t)) return (hay) => hay.includes(t);
      const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
      return (hay) => re.test(hay);
    };
    const apply = () => {
      const tests = input.value.toLowerCase().split(/\s+/).filter(Boolean).map(matcher);
      let shown = 0;
      for (const row of rows) {
        const hay = row.dataset.search || "";
        const hit = tests.every((test) => test(hay));
        row.hidden = !hit;
        if (hit) shown++;
      }
      if (empty) empty.hidden = shown > 0;
      if (counter) counter.textContent = tests.length ? `${shown} / ${rows.length}` : String(rows.length);
    };
    const q = new URLSearchParams(location.search).get("q");
    if (q) input.value = q;
    input.addEventListener("input", apply);
    apply();
  }
}

// ------------------------------------------------------------------ wiring up

function init() {
  if (!document.querySelector(GRAPH) && !document.querySelector("[data-node-filter]")) return;
  setupFilters();
  drawAll();
  if (document.fonts?.ready) document.fonts.ready.then(scheduleDraw);
  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(scheduleDraw);
    document.querySelectorAll(`${GRAPH} .bp-canvas, ${GRAPH} .bp-stage`).forEach((s) => ro.observe(s));
  }
  window.addEventListener("resize", () => {
    scheduleDraw();
    if (current) placePop(current);
  });
  new MutationObserver(scheduleDraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const expand = target.closest(".bp-expand");
    if (expand) {
      const fig = expand.closest(GRAPH);
      setExpanded(fig, !fig.classList.contains("is-expanded"));
      return;
    }
    const node = target.closest(`${GRAPH} button.bp-node`);
    if (node) {
      if (current === node && pop && !pop.hidden) closeCard(true);
      else openCard(node);
      return;
    }
    if (pop && !pop.hidden && !target.closest(".bp-pop")) closeCard(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Tab") trapFocus(e);
    if (e.key !== "Escape") return;
    if (pop && !pop.hidden) {
      closeCard(true);
      e.preventDefault();
      return;
    }
    const fig = document.querySelector(`${GRAPH}.is-expanded`);
    if (fig) {
      setExpanded(fig, false);
      e.preventDefault();
    }
  });
  document.querySelectorAll(`${GRAPH} .bp-canvas`).forEach((c) =>
    c.addEventListener("scroll", () => {
      // A card placed next to its node would drift away from it; the phone bottom sheet does not.
      if (current && c.contains(current) && !pop.classList.contains("is-sheet")) closeCard(false);
    }, { passive: true }),
  );
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
