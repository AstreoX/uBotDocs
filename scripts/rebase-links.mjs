#!/usr/bin/env node
// Prefixes the base path to the root links in a build made for a site under a path (GitHub Pages:
// https://astreox.github.io/uBotDocs/), then checks that every internal link points at a built file.
//
//   BASE_PATH=/uBotDocs npm run build
//   BASE_PATH=/uBotDocs node scripts/rebase-links.mjs [--dist dist]
//
// Pages, components and the blueprint cards link with root paths (/sensor/imu/). Astro and Starlight
// already add the base to their own URLs (assets, search, sidebar), so a URL that starts with the base
// is left alone. Exit code 1 when a link points at no file or a root link is left without the base.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const distArg = args.includes("--dist") ? args[args.indexOf("--dist") + 1] : "dist";
const dist = resolve(root, distArg);
const base = `/${String(process.env.BASE_PATH ?? "").replace(/^\/+|\/+$/g, "")}`;

if (base === "/") {
  console.error("rebase-links: set BASE_PATH (for example /uBotDocs), the same value the build used");
  process.exit(1);
}
if (!existsSync(dist)) {
  console.error(`rebase-links: ${distArg}/ does not exist; run the build first`);
  process.exit(1);
}

const isRootLink = (url) => url.startsWith("/") && !url.startsWith("//");
const hasBase = (url) => url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`) || url.startsWith(`${base}#`);
const rebase = (url) => (isRootLink(url) && !hasBase(url) ? `${base}${url}` : url);

const ATTR = /(\s(?:href|src|action|poster)=)(["'])([^"']*)\2/g;
const SRCSET = /(\ssrcset=)(["'])([^"']*)\2/g;

function htmlFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) htmlFiles(abs, out);
    else if (name.endsWith(".html")) out.push(abs);
  }
  return out;
}

/** The built file a site path points at, or null. */
function target(pathname) {
  let p = pathname;
  try {
    p = decodeURIComponent(p);
  } catch {
    return null;
  }
  const rel = p.slice(base.length).replace(/^\/+/, "");
  const abs = join(dist, rel);
  if (p.endsWith("/") || rel === "") return existsSync(join(abs, "index.html")) ? abs : null;
  if (existsSync(abs) && statSync(abs).isFile()) return abs;
  if (existsSync(join(abs, "index.html"))) return abs;
  return existsSync(`${abs}.html`) ? abs : null;
}

const files = htmlFiles(dist);
let changed = 0;
const problems = [];

for (const file of files) {
  const before = readFileSync(file, "utf8");
  const after = before
    .replace(ATTR, (m, attr, q, url) => `${attr}${q}${rebase(url)}${q}`)
    .replace(SRCSET, (m, attr, q, list) => {
      const items = list.split(",").map((item) => {
        const [url, ...rest] = item.trim().split(/\s+/);
        return [rebase(url), ...rest].join(" ");
      });
      return `${attr}${q}${items.join(", ")}${q}`;
    });
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
  }

  const page = `/${file.slice(dist.length + 1).replaceAll("\\", "/")}`;
  for (const [, , , url] of after.matchAll(ATTR)) {
    if (!isRootLink(url)) continue;
    if (!hasBase(url)) {
      problems.push(`${page}: ${url} has no base`);
      continue;
    }
    const pathname = url.split(/[?#]/)[0];
    if (!target(pathname)) problems.push(`${page}: ${url} points at no file`);
  }
}

const unique = [...new Set(problems)];
for (const p of unique.slice(0, 50)) console.error(`rebase-links: ${p}`);
if (unique.length > 50) console.error(`rebase-links: … and ${unique.length - 50} more`);
console.log(`rebase-links: base ${base}, ${files.length} pages, ${changed} rewritten, ${unique.length} broken link(s)`);
process.exit(unique.length ? 1 : 0);
