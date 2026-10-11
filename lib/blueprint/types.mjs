// Pin and node vocabulary shared by the renderer, the validator and the reference generator.
// Colours follow the UE 5.5 Blueprint editor (UGraphEditorSettings defaults, converted to sRGB and
// nudged for contrast on the docs canvas, as in the previous AgentSensorCore manual).

export const PIN_CATEGORIES = [
  "exec", "bool", "byte", "int", "int64", "float", "double", "name", "string", "text",
  "vector", "rotator", "transform", "struct", "object", "class", "softobject", "softclass",
  "interface", "enum", "delegate", "mcdelegate", "wildcard",
];

export const CONTAINERS = ["none", "array", "set", "map"];

export const PIN_COLORS = {
  exec: "#f2f2f2",
  bool: "#d23a3a",
  byte: "#14a898",
  enum: "#14a898",
  int: "#1fe3af",
  int64: "#abe39a",
  float: "#8fd13f",
  double: "#4fc22b",
  name: "#c77dff",
  string: "#f018c8",
  text: "#e57fb0",
  vector: "#ffc926",
  rotator: "#9fb4ff",
  transform: "#ff8a2b",
  struct: "#3b8cf0",
  object: "#00b4ff",
  class: "#8a4dff",
  softobject: "#7fe8ff",
  softclass: "#ff7fe8",
  interface: "#e8f5a6",
  delegate: "#ff4040",
  mcdelegate: "#ff4040",
  wildcard: "#9a9393",
};

export function pinColor(type) {
  if (!type) return PIN_COLORS.wildcard;
  return PIN_COLORS[type.category] ?? PIN_COLORS.wildcard;
}

/** Node kinds: Chinese label, header colour and the short word used in accessible names. */
export const NODE_KINDS = {
  event: { label: "事件", color: "#7d1f1f" },
  call: { label: "函数", color: "#2a528f" },
  pure: { label: "纯函数", color: "#3a6427" },
  make: { label: "构造结构体", color: "#1e4a86" },
  break: { label: "拆分结构体", color: "#1e4a86" },
  node: { label: "特殊节点", color: "#4a4d53" },
  variable: { label: "变量", color: "#2b2d30" },
};

export const NODE_KIND_IDS = ["call", "pure", "event", "make", "break", "node"];

const PRIMITIVE_LABELS = {
  exec: "Exec",
  bool: "Boolean",
  byte: "Byte",
  int: "Integer",
  int64: "Integer64",
  float: "Float",
  double: "Float (double)",
  name: "Name",
  string: "String",
  text: "Text",
  vector: "Vector",
  rotator: "Rotator",
  transform: "Transform",
  delegate: "Delegate",
  mcdelegate: "Multicast Delegate",
  wildcard: "Wildcard",
};

const REFERENCE_NOTES = {
  struct: "结构体",
  enum: "枚举",
  object: "对象引用",
  class: "类引用",
  softobject: "软对象引用",
  softclass: "软类引用",
  interface: "接口",
};

/** Name of the element type as UE shows it (struct/enum/class display name or the primitive name). */
export function baseTypeName(type) {
  if (!type) return "?";
  if (type.subtypeDisplay) return type.subtypeDisplay;
  if (type.subtype) return type.subtype;
  return PRIMITIVE_LABELS[type.category] ?? type.category;
}

/**
 * A short, structured description of a pin type for tables and cards:
 * { name, note } where name is the UE type name and note a Chinese hint ("结构体", "Float 数组", ...).
 */
export function describeType(type) {
  if (!type) return { name: "?", note: "" };
  const name = baseTypeName(type);
  const note = REFERENCE_NOTES[type.category] ?? "";
  if (type.container === "array") return { name, note: note ? `${note}数组` : "数组" };
  if (type.container === "set") return { name, note: note ? `${note}集合` : "集合" };
  if (type.container === "map") {
    const value = type.valueType ? baseTypeName(type.valueType) : "?";
    return { name: `${name} → ${value}`, note: "映射" };
  }
  return { name, note };
}

/** Plain text form, used in accessible names and warnings. */
export function typeText(type) {
  const { name, note } = describeType(type);
  return note ? `${name}（${note}）` : name;
}

export function isExec(type) {
  return type?.category === "exec";
}

const REAL = new Set(["float", "double"]);
const INTEGRAL = new Set(["byte", "enum"]);

/**
 * Whether a wire from `from` to `to` is type-compatible the way the Blueprint editor would accept it
 * without inserting a conversion node. `isChildOf(child, parent)` answers class hierarchy questions
 * (returns undefined when unknown, which counts as compatible).
 */
export function typesCompatible(from, to, isChildOf = () => undefined) {
  if (!from || !to) return true;
  if (from.category === "wildcard" || to.category === "wildcard") return true;
  if ((from.container ?? "none") !== (to.container ?? "none")) return false;
  const a = from.category, b = to.category;
  if (a === b) {
    if (a === "struct" || a === "enum") return !from.subtype || !to.subtype || from.subtype === to.subtype;
    if (a === "object" || a === "class" || a === "softobject" || a === "softclass" || a === "interface") {
      if (!from.subtype || !to.subtype || from.subtype === to.subtype) return true;
      const r = isChildOf(from.subtype, to.subtype);
      return r === undefined ? true : r;
    }
    return true;
  }
  if (REAL.has(a) && REAL.has(b)) return true;
  if (INTEGRAL.has(a) && INTEGRAL.has(b)) return true;
  if ((a === "object" && b === "interface") || (a === "interface" && b === "object")) return true;
  return false;
}
