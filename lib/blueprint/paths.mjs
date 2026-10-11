// URL scheme of the generated reference. Everything that links into the reference goes through here,
// so graphs, the node index and the generator always agree.
//
//   /reference/                                  overview
//   /reference/nodes/                            node index (every node, filterable)
//   /reference/engine/#<Owner>-<Member>          curated engine nodes (data/api/engine.json)
//   /reference/<plugin>/                         plugin overview
//   /reference/<plugin>/<classid>/#<Member>      class page; nodes anchored by member name
//   /reference/<plugin>/structs/<structid>/#Break
//   /reference/<plugin>/enums/<enumid>/

export const REFERENCE_DIR = "reference";
export const NODE_INDEX_PATH = "/reference/nodes/";
export const ENGINE_PATH = "/reference/engine/";

export const pluginSlug = (plugin) => plugin.toLowerCase();
export const classPath = (plugin, id) => `/reference/${pluginSlug(plugin)}/${id.toLowerCase()}/`;
export const structPath = (plugin, id) => `/reference/${pluginSlug(plugin)}/structs/${id.toLowerCase()}/`;
export const enumPath = (plugin, id) => `/reference/${pluginSlug(plugin)}/enums/${id.toLowerCase()}/`;
export const pluginPath = (plugin) => `/reference/${pluginSlug(plugin)}/`;

/** HTML id that is safe in URLs and CSS: letters, digits, "_" and "-". */
export const safeId = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");

export function propertyAnchor(propertyId) {
  return `prop-${safeId(propertyId)}`;
}

/** Anchor of a node on the page that documents it. */
export function nodeAnchor(node, isEngine) {
  if (isEngine) return safeId(node.id);
  if (node.member) return safeId(node.member);
  if (node.kind === "make") return "Make";
  if (node.kind === "break") return "Break";
  return safeId(node.id);
}

/** Where a node is documented: { path, anchor, href }, or null when the registry cannot place it. */
export function nodeLocation(registry, id) {
  const entry = registry.nodeEntry(id);
  if (!entry) return null;
  const node = entry.item;
  const anchor = nodeAnchor(node, entry.isEngine);
  let path;
  if (entry.isEngine) path = ENGINE_PATH;
  else if (node.owner && registry.classEntry(node.owner)) {
    const owner = registry.classEntry(node.owner);
    path = owner.isEngine ? ENGINE_PATH : classPath(owner.plugin, node.owner);
  } else if ((node.kind === "make" || node.kind === "break") && node.id.includes(":")) {
    const structId = node.id.slice(node.id.indexOf(":") + 1);
    const s = registry.structs.get(structId);
    path = s ? structPath(s.plugin, structId) : pluginPath(entry.plugin);
  } else path = pluginPath(entry.plugin);
  return { path, anchor, href: `${path}#${anchor}` };
}

export function typeHref(registry, type) {
  if (!type?.subtype) return null;
  const c = registry.classEntry(type.subtype);
  if (c && !c.isEngine) return classPath(c.plugin, type.subtype);
  const s = registry.structs.get(type.subtype);
  if (s && !s.isEngine) return structPath(s.plugin, type.subtype);
  const e = registry.enums.get(type.subtype);
  if (e && !e.isEngine) return enumPath(e.plugin, type.subtype);
  return null;
}
