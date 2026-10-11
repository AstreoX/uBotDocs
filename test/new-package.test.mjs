// The promise in CLAUDE.md: "The docs need no code change for a new package, only data and pages."
//
// This test keeps it. It makes a copy of the repository and does to it what releases do: every planned
// package gets its first version in data/index.json, and a package nobody planned arrives in a layer
// with no released package yet, each with its data/api file and a guide folder (the files the sync bot
// and a maintainer bring). Then the copy must still pass what CI runs on a pull request, except the
// Astro build: the whole test suite (so no test may write down which packages are released or
// planned, in any order), `npm run check` without a single warning, and the reference generator.
//
// When this test fails, the message names a test or a file that depends on today's list of packages.
// Fix that place to read the registry (lib/packages.mjs) instead; do not edit this test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyRepo, editIndex, packageKit, removeDir, repoPackages, writeKit } from "./helpers.mjs";

// The copy runs this suite again; it must not start a third level.
const INSIDE = process.env.UBOT_DOCS_RELEASE_SIMULATION === "1";

function node(dir, args, env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_TEST_CONTEXT; // a nested `node --test` must not think it is a child of this runner
  return spawnSync(process.execPath, args, { cwd: dir, env: childEnv, encoding: "utf8", timeout: 200_000, maxBuffer: 64 * 1024 * 1024 });
}

test("releases are data and pages only: the whole suite, check and the generator pass in a copy where every planned package is released", { skip: INSIDE && "this is the copy that runs the simulation", timeout: 240_000 }, () => {
  const registry = repoPackages();
  const dependency = registry.released()[0];
  const planned = registry.planned();
  const dir = mkdtempSync(join(tmpdir(), "ubot-release-"));
  try {
    copyRepo(dir);
    const kits = [];
    editIndex(dir, (index) => {
      for (const pkg of planned) {
        const entry = index.packages.find((p) => p.name === pkg.name);
        const version = entry.versions.find((v) => v.version === pkg.versions[0].version);
        delete version.planned;
        version.ref = `v${version.version}`;
        version.engine ??= "~5.5";
        kits.push(packageKit(pkg.name, { friendlyName: pkg.friendlyName, version: version.version }));
      }
      const newcomer = packageKit("UBotNewcomer", { layer: "Content", requires: [{ name: dependency.name, version: `^${dependency.latest.version}` }] });
      index.packages.push(newcomer.indexEntry);
      kits.push(newcomer);
    });
    for (const kit of kits) writeKit(dir, kit);

    const gen = node(dir, ["scripts/gen-reference.mjs"]);
    assert.equal(gen.status, 0, `${gen.stdout}${gen.stderr}`);
    for (const kit of kits) assert.ok(existsSync(join(dir, "src", "content", "docs", "reference", kit.slug, "index.md")), `${kit.name} has a reference home page`);

    const check = node(dir, ["scripts/check.mjs"]);
    assert.equal(check.status, 0, `npm run check fails after the release:\n${check.stdout}${check.stderr}`);
    assert.match(check.stdout, /check: 0 error\(s\), 0 warning\(s\)/, `npm run check warns after the release:\n${check.stdout}`);

    const suite = node(dir, ["--test", "--test-reporter=spec", "test/**/*.test.mjs"], { UBOT_DOCS_RELEASE_SIMULATION: "1" });
    const failed = suite.stdout.split("\n").filter((l) => l.trimStart().startsWith("✖")).map((l) => l.trim());
    assert.equal(suite.status, 0, `these tests depend on today's list of packages (released: ${kits.map((k) => k.name).join(", ")}):\n${[...new Set(failed)].join("\n")}\n${suite.stderr.slice(-2000)}`);
  } finally {
    removeDir(dir);
  }
});
