// Tables and diagrams that are wider than the column scroll sideways inside their own box (see
// theme.css). Such a box needs two things the CSS cannot give: a way to reach it with the keyboard
// (tabindex) and a sign for touch readers that there is more to the right. Once the layout is known,
// every box that really overflows gets a tab stop, a name and a short hint underneath.
// (Blueprint graphs have their own handling in blueprint.js.)

const BOXES = ".sl-markdown-content table, [data-scrollable]";
const HINT = "左右滑动查看";

function enhance(box) {
  if (box.closest(".bp-figure")) return null;
  const hint = document.createElement("p");
  hint.className = "scroll-hint";
  hint.textContent = HINT;
  hint.setAttribute("aria-hidden", "true");
  hint.hidden = true;
  box.insertAdjacentElement("afterend", hint);
  const name = box.dataset.scrollable || (box.tagName === "TABLE" ? "表格" : "");
  const update = () => {
    const wide = box.scrollWidth > box.clientWidth + 1;
    hint.hidden = !wide;
    if (wide) {
      box.tabIndex = 0;
      if (name && !box.hasAttribute("aria-label") && !box.hasAttribute("aria-labelledby")) {
        box.setAttribute("aria-label", `${name}，可左右滚动`);
        if (box.tagName !== "TABLE") box.setAttribute("role", "group");
      }
    } else if (box.getAttribute("tabindex") === "0") {
      box.removeAttribute("tabindex");
    }
  };
  return update;
}

function init() {
  const updates = [...document.querySelectorAll(BOXES)].map(enhance).filter(Boolean);
  if (!updates.length) return;
  let frame = 0;
  const run = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const update of updates) update();
    });
  };
  run();
  window.addEventListener("resize", run);
  if (document.fonts?.ready) document.fonts.ready.then(run);
  // A filtered node index changes the size of its table.
  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(run);
    document.querySelectorAll(BOXES).forEach((box) => ro.observe(box));
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
