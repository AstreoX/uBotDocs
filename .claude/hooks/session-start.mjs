#!/usr/bin/env node
// SessionStart hook: prepares a Claude Code cloud session (CLAUDE_CODE_REMOTE=true) by installing
// dependencies and fetching the plugin source submodules. Locally it does nothing. It never fails the
// session: every problem is reported and the hook still exits 0.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.CLAUDE_CODE_REMOTE !== "true") process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const isWin = process.platform === "win32";

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: ["ignore", "inherit", "inherit"], shell: isWin, timeout: 8 * 60 * 1000 });
  if (r.error || r.status !== 0) {
    console.error(`session-start: ${label} failed (${r.error?.message ?? `exit ${r.status}`}); continuing`);
    return false;
  }
  return true;
}

try {
  if (!existsSync(join(root, "node_modules", ".package-lock.json"))) run("npm ci", "npm", ["ci", "--no-audit", "--no-fund"]);
  run("submodules", "git", ["submodule", "update", "--init", "--depth", "1"]);
} catch (e) {
  console.error(`session-start: ${e?.message ?? e}; continuing`);
}
process.exit(0);
