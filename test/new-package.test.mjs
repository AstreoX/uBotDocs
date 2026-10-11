// The promise in CLAUDE.md: "The docs need no code change for a new package, only data and pages."
//
// This test keeps it. It makes a copy of the repository and does to it what releases do: every planned
// package gets its first version in data/index.json, and a package nobody planned arrives, each with
// its data/api file and its manual folder (the files the sync bot and a maintainer bring: the overview
// page replaces the placeholder of a planned package). On top, every data/api file of an already released package documents a
// version the index does not list, as when the sync bot takes docs/api.json from the default branch
// because the release tag has none. Then the copy must still pass what CI runs on a pull request,
// except the Astro build: the whole test suite (so no test may write down which packages are released
// or planned, in any order, or which versions data/api documents), `npm run check` without errors and
// without new warnings except one per fallback file, and the reference generator.
//
// When this test fails, the message names a test or a file that depends on today's list of packages.
// Fix that place to read the registry (lib/packages.mjs) instead; do not edit this test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compareVersions, formatVersion, parseVersion } from "../lib/semver.mjs";
import { copyRepo, editIndex, packageKit, removeDir, repoPackages, writeKit } from "./helpers.mjs";

// The copy runs this suite again; it must not start a third level.
const INSIDE = process.env.UBOT_DOCS_RELEASE_SIMULATION === "1";

/** The warnings of a `npm run check` output, without line numbers (editing data/index.json moves lines). */
const warningsOf = (stdout) => stdout.split("\n").filter((l) => /^\S+:\d+: warning: /.test(l)).map((l) => l.replace(/^(\S+?):\d+: /, "$1: "));

/** A version of the package that the index does not list: the documented one with the patch raised. */
function unlistedVersion(pkg) {
  const v = parseVersion(pkg.documentedVersion);
  for (let patch = v.patch + 1; ; patch++) {
    const candidate = formatVersion({ ...v, patch, pre: "" });
    if (!pkg.versions.some((x) => compareVersions(x.version, candidate) === 0)) return candidate;
  }
}

function node(dir, args, env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_TEST_CONTEXT; // a nested `node --test` must not think it is a child of this runner
  return spawnSync(process.execPath, args, { cwd: dir, env: childEnv, encoding: "utf8", timeout: 200_000, maxBuffer: 64 * 1024 * 1024 });
}

test("releases are data and pages only: the whole suite, check and the generator pass in a copy where every planned package is released and the API data comes from default branches", { skip: INSIDE && "this is the copy that runs the simulation", timeout: 240_000 }, () => {
  const registry = repoPackages();
  const dependency = registry.released()[0];
  const planned = registry.planned();
  const dir = mkdtempSync(join(tmpdir(), "ubot-release-"));
  try {
    copyRepo(dir);
    const baseline = warningsOf(node(dir, ["scripts/check.mjs"]).stdout); // what the repository warns about today
    // the sync bot's default-branch fallback, for every package that has API data
    const fallbacks = registry.released().filter((p) => p.hasApi).map((p) => ({ name: p.name, version: unlistedVersion(p) }));
    for (const f of fallbacks) {
      const file = join(dir, "data", "api", `${f.name}.json`);
      writeFileSync(file, readFileSync(file, "utf8").replace(/"version":\s*"[^"]*"/, `"version": "${f.version}"`));
    }
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
      const newcomer = packageKit("UBotNewcomer", { requires: [{ name: dependency.name, version: `^${dependency.latest.version}` }] });
      index.packages.push(newcomer.indexEntry);
      kits.push(newcomer);
    });
    for (const kit of kits) writeKit(dir, kit);

    const gen = node(dir, ["scripts/gen-reference.mjs"]);
    assert.equal(gen.status, 0, `${gen.stdout}${gen.stderr}`);
    for (const kit of kits) assert.ok(existsSync(join(dir, "src", "content", "docs", "reference", kit.slug, "index.md")), `${kit.name} has a reference home page`);

    const check = node(dir, ["scripts/check.mjs"]);
    assert.equal(check.status, 0, `npm run check fails after the release:\n${check.stdout}${check.stderr}`);
    const added = warningsOf(check.stdout).filter((w) => !baseline.includes(w));
    const expected = fallbacks.map((f) => `data/api/${f.name}.json: warning: documents ${f.name} ${f.version}, which data/index.json does not list`);
    assert.deepEqual(added.map((w) => w.split(" (released")[0]).sort(), expected.sort(), `npm run check warns about more than the fallback versions after the release:\n${check.stdout}`);

    const suite = node(dir, ["--test", "--test-reporter=spec", "test/**/*.test.mjs"], { UBOT_DOCS_RELEASE_SIMULATION: "1" });
    const failed = suite.stdout.split("\n").filter((l) => l.trimStart().startsWith("✖")).map((l) => l.trim());
    assert.equal(suite.status, 0, `these tests depend on today's list of packages or on the versions data/api documents (released: ${kits.map((k) => k.name).join(", ")}; API data from default branches: ${fallbacks.map((f) => `${f.name} ${f.version}`).join(", ")}):\n${[...new Set(failed)].join("\n")}\n${suite.stderr.slice(-2000)}`);
  } finally {
    removeDir(dir);
  }
});
