#!/usr/bin/env node
// Generates the reference section (src/content/docs/reference/) from data/index.json, data/api/*.json
// and the Chinese summaries in data/zh/. Runs before `npm run dev` and `npm run build`. The output is
// git-ignored and rebuilt from scratch every time: never edit it by hand. The work is done by
// lib/reference/ (the package framework and its providers).
//
//   node scripts/gen-reference.mjs [--data <dir>] [--out <dir>]    (defaults: data/, src/content/docs/reference/)
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReference } from "../lib/reference/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (flag) => {
  const i = args.indexOf(flag);
  if (i < 0 || !args[i + 1]) return undefined;
  return isAbsolute(args[i + 1]) ? args[i + 1] : resolve(process.cwd(), args[i + 1]);
};

try {
  const outDir = opt("--out") ?? join(root, "src", "content", "docs", "reference");
  const { written, nodes } = generateReference({ root, dataDir: opt("--data"), outDir });
  const where = opt("--out") ? outDir : "src/content/docs/reference/";
  console.log(`gen-reference: wrote ${written.length} files to ${where} (${nodes} nodes)`);
} catch (e) {
  console.error(e.message);
  console.error("gen-reference: failed");
  process.exit(1);
}
