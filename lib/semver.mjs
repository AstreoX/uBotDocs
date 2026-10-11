// Versions and version ranges of uBot packages. A port of uBotCore's UBotSemVer.h/.cpp (the grammar
// the plugins and uBot Manager use), so a range means the same thing on this site as in the editor.
//
//   parseVersion("v1.2")          -> { major: 1, minor: 2, patch: 0, pre: "", count: 2 }
//   parseRange("^0.1")            -> { comparators: [...], text: "^0.1" }  (null when invalid)
//   satisfies("0.1.1", "^0.1")    -> true
//
// Range grammar: empty or "*" (any), or whitespace-separated comparators that must all hold; a
// comparator is [op]version with op in = >= > <= < ^ ~ (no op means =). Partial versions are X-ranges
// ("1.2" means >=1.2.0 <1.3.0). Upper bounds from ^, ~ and partials exclude that bound's prereleases.

const MAX = 2147483647;
const isDigits = (s) => /^[0-9]+$/.test(s);

/** Lenient parse: "1", "1.2", "1.2.3", optional "v", optional "-pre", "+build" ignored. null when invalid. */
export function parseVersion(input) {
  let text = String(input ?? "").trim();
  if (/^v/i.test(text)) text = text.slice(1);
  const plus = text.indexOf("+");
  if (plus >= 0) text = text.slice(0, plus);
  let release = text;
  let pre = "";
  const dash = text.indexOf("-");
  if (dash >= 0) {
    release = text.slice(0, dash);
    pre = text.slice(dash + 1);
    if (!pre || pre.split(".").some((id) => !/^[0-9A-Za-z-]+$/.test(id))) return null;
  }
  const parts = release.split(".");
  if (parts.length < 1 || parts.length > 3) return null;
  const values = [0, 0, 0];
  for (let i = 0; i < parts.length; i++) {
    if (!isDigits(parts[i])) return null;
    const n = Number(parts[i]);
    if (n > MAX) return null;
    values[i] = n;
  }
  return { major: values[0], minor: values[1], patch: values[2], pre, count: parts.length };
}

function compareNumericIds(a, b) {
  const ta = a.replace(/^0+(?=.)/, "");
  const tb = b.replace(/^0+(?=.)/, "");
  if (ta.length !== tb.length) return ta.length < tb.length ? -1 : 1;
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

function comparePre(a, b) {
  if (!a || !b) return !a === !b ? 0 : !a ? 1 : -1;
  const ia = a.split(".");
  const ib = b.split(".");
  for (let i = 0; i < Math.min(ia.length, ib.length); i++) {
    const na = isDigits(ia[i]);
    const nb = isDigits(ib[i]);
    let r;
    if (na && nb) r = compareNumericIds(ia[i], ib[i]);
    else if (na !== nb) r = na ? -1 : 1;
    else r = ia[i] < ib[i] ? -1 : ia[i] > ib[i] ? 1 : 0;
    if (r) return r;
  }
  return Math.sign(ia.length - ib.length);
}

/** -1, 0 or 1 by SemVer precedence. Accepts version objects or strings (invalid strings sort first). */
export function compareVersions(a, b) {
  const va = typeof a === "string" ? parseVersion(a) : a;
  const vb = typeof b === "string" ? parseVersion(b) : b;
  if (!va || !vb) return !va === !vb ? 0 : !va ? -1 : 1;
  for (const k of ["major", "minor", "patch"]) if (va[k] !== vb[k]) return va[k] < vb[k] ? -1 : 1;
  return comparePre(va.pre, vb.pre);
}

export const formatVersion = (v) => `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}` : ""}`;

function upperBound(v, index) {
  const values = [v.major, v.minor, v.patch];
  if (values[index] === MAX) return null;
  values[index]++;
  for (let i = index + 1; i < 3; i++) values[i] = 0;
  return { major: values[0], minor: values[1], patch: values[2], pre: "0", count: 3 };
}

const OPERATORS = [">=", "<=", ">", "<", "=", "^", "~"];

/** Parses a range: { comparators, text }, or null when the text is not a valid range. */
export function parseRange(input) {
  return tryParseRange(input).range;
}

/** { range, error }: range is null when the text is not a valid range. */
export function tryParseRange(input) {
  const tokens = String(input ?? "").trim().split(/\s+/).filter(Boolean);
  const comparators = [];
  const normalized = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "*") {
      normalized.push(token);
      continue;
    }
    const op = OPERATORS.find((o) => token.startsWith(o)) ?? "";
    let versionText = token.slice(op.length);
    if (!versionText) {
      if (i + 1 >= tokens.length) return { range: null, error: `operator "${op}" has no version` };
      versionText = tokens[++i];
    }
    const v = parseVersion(versionText);
    if (!v) return { range: null, error: `"${versionText}" is not a version` };
    const count = v.pre ? 3 : v.count;
    const partial = count < 3;
    const last = count - 1;
    const add = (cmp, bound) => comparators.push({ cmp, v: bound });
    const addUpper = (index) => {
      const b = upperBound(v, index);
      if (b) add("<", b);
    };
    if (op === "^") {
      let bump = 2;
      if (v.major !== 0 || count === 1) bump = 0;
      else if (v.minor !== 0 || count === 2) bump = 1;
      add(">=", v);
      addUpper(bump);
    } else if (op === "~") {
      add(">=", v);
      addUpper(count === 1 ? 0 : 1);
    } else if (op === ">=") add(">=", v);
    else if (op === ">") {
      if (partial) {
        const b = upperBound(v, last);
        if (b) add(">=", { ...b, pre: "" });
        else add(">", { major: MAX, minor: MAX, patch: MAX, pre: "", count: 3 });
      } else add(">", v);
    } else if (op === "<") add("<", partial ? { ...v, pre: "0" } : v);
    else if (op === "<=") {
      if (partial) addUpper(last);
      else add("<=", v);
    } else if (partial) {
      add(">=", v);
      addUpper(last);
    } else add("=", v);
    normalized.push(op + versionText);
  }
  return { range: { comparators, text: normalized.join(" ") }, error: null };
}

/** True when `version` (string or object) satisfies `range` (string or parsed range). */
export function satisfies(version, range) {
  const v = typeof version === "string" ? parseVersion(version) : version;
  const r = typeof range === "string" ? parseRange(range) : range;
  if (!v || !r) return false;
  return r.comparators.every(({ cmp, v: bound }) => {
    const o = compareVersions(v, bound);
    return cmp === "=" ? o === 0 : cmp === ">" ? o > 0 : cmp === ">=" ? o >= 0 : cmp === "<" ? o < 0 : o <= 0;
  });
}

/**
 * Short reader-facing form of a range for the "需要" line: "^0.1" and ">=0.1" -> "0.1+", "~0.1.2" ->
 * "0.1.x", an exact version stays as written; anything else is shown as the normalized range.
 */
export function describeRange(text) {
  const t = String(text ?? "").trim();
  if (!t || t === "*") return "";
  const m = /^(\^|>=|~|=)?\s*v?(\d+(?:\.\d+){0,2})$/.exec(t);
  if (!m) return parseRange(t)?.text ?? t;
  const [, op = "", ver] = m;
  if (op === "^" || op === ">=") return `${ver}+`;
  if (op === "~") return `${ver.split(".").slice(0, 2).join(".")}.x`;
  return ver;
}
