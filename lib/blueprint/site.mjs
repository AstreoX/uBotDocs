// Loads everything the site knows about the API once per process: data/api/*.json and data/zh/*.yaml.
import { join } from "node:path";
import { loadApi } from "./api.mjs";
import { loadZh } from "./zh.mjs";

const cache = new Map();

/** { registry, overlay, diagnostics } for a repository root (cached). */
export function loadSite(root = process.cwd(), { fresh = false } = {}) {
  if (!fresh && cache.has(root)) return cache.get(root);
  const api = loadApi(join(root, "data", "api"), { root });
  const zh = loadZh(join(root, "data", "zh"), api.registry, { root });
  const site = { registry: api.registry, overlay: zh.overlay, diagnostics: [...api.diagnostics, ...zh.diagnostics] };
  cache.set(root, site);
  return site;
}
