// Loads everything the site knows about the API once per process: data/api/*.json and data/zh/<Package>/*.yaml.
import { join } from "node:path";
import { loadApi } from "./api.mjs";
import { loadZh } from "./zh.mjs";
import { loadPackages } from "../packages.mjs";

const cache = new Map();

/**
 * { registry, overlay, diagnostics } for a repository root (cached). `dataDir` defaults to
 * <root>/data; tests pass a temporary one.
 */
export function loadSite(root = process.cwd(), { fresh = false, dataDir = join(root, "data") } = {}) {
  const key = `${root}|${dataDir}`;
  if (!fresh && cache.has(key)) return cache.get(key);
  const api = loadApi(join(dataDir, "api"), { root });
  const packages = loadPackages({ root, dataDir, fresh });
  const folders = new Set(["Engine", ...packages.registry.list().map((p) => p.name)]);
  const zh = loadZh(join(dataDir, "zh"), api.registry, { root, folders });
  const site = { registry: api.registry, overlay: zh.overlay, diagnostics: [...api.diagnostics, ...zh.diagnostics] };
  cache.set(key, site);
  return site;
}
