import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { removeDir, repoPackages, root } from "./helpers.mjs";

// The script copies <from>/<folder>/docs/api.json byte for byte. Here the source is the repository's own
// data/api file, so a run changes nothing in the repository.
function run(from, ...args) {
  return spawnSync(process.execPath, [join(root, "scripts", "sync-api.mjs"), "--from", from, ...args], { encoding: "utf8" });
}

test("sync-api --package takes the package name in any letter case and says what it did", () => {
  const pkg = repoPackages().released().find((p) => p.hasApi && p.name !== p.name.toLowerCase());
  const from = mkdtempSync(join(tmpdir(), "ubot-sync-api-"));
  const file = join(root, "data", "api", `${pkg.name}.json`);
  const before = readFileSync(file);
  try {
    mkdirSync(join(from, pkg.folder, "docs"), { recursive: true });
    copyFileSync(file, join(from, pkg.folder, "docs", "api.json"));
    for (const name of [pkg.name, pkg.name.toLowerCase(), pkg.name.toUpperCase()]) {
      const r = run(from, "--package", name, "--strict");
      assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, new RegExp(`sync-api: ${pkg.name} \\S+ .*: unchanged`), `${name}: the package was synced`);
      assert.match(r.stdout, /0 changed, 0 skipped/);
    }
    assert.ok(before.equals(readFileSync(file)), "the data file is untouched");
  } finally {
    removeDir(from);
  }
});

test("sync-api --package refuses names that are not released packages", () => {
  const r = run(tmpdir(), "--package", "UBotDoesNotExist");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a released package in data\/index\.json: UBotDoesNotExist/);
});
