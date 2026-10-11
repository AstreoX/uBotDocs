import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addPackage } from "../scripts/add-package.mjs";
import { packageKit, removeDir } from "./helpers.mjs";

// A small index of its own: add-package works from whatever data/index.json lists, so this test does
// not read the repository's (which gains a released package with every plugin release).
const planned = { ...packageKit("UBotBeta").indexEntry, versions: [{ version: "0.1.0", planned: true, requires: [], enginePlugins: [], provides: [] }] };
const index = { formatVersion: 2, packages: [packageKit("UBotAlpha").indexEntry, planned, packageKit("UBotGamma").indexEntry] };

test("add-package: needs the package in the index, creates data/zh/<Name>/, is idempotent, touches nothing else", () => {
  const dir = mkdtempSync(join(tmpdir(), "ubot-add-"));
  try {
    mkdirSync(join(dir, "data", "api"), { recursive: true });
    writeFileSync(join(dir, "data", "index.json"), `${JSON.stringify(index, null, 4)}\n`);
    writeFileSync(join(dir, ".gitmodules"), "[submodule \"vendor/uBotGamma\"]\n\tpath = vendor/uBotGamma\n\turl = https://github.com/AstreoX/uBotGamma.git\n");
    const calls = [];
    const run = (cmd, args) => calls.push([cmd, ...args].join(" "));

    assert.throws(() => addPackage({ root: dir, name: "UBotNope", run }), /UBotNope is not in data\/index\.json/);
    assert.throws(() => addPackage({ root: dir, name: "ubotalpha", run }), /did you mean UBotAlpha/);

    const first = addPackage({ root: dir, name: "UBotAlpha", run });
    assert.deepEqual(calls, [
      "git submodule add --depth 1 -- https://github.com/AstreoX/uBotAlpha.git vendor/uBotAlpha",
      "git config -f .gitmodules submodule.vendor/uBotAlpha.shallow true",
    ]);
    assert.ok(existsSync(join(dir, "data", "zh", "UBotAlpha", ".gitkeep")));
    assert.ok(first.todo.some((l) => /sync-api -- --from-github --package UBotAlpha/.test(l)), "no data/api/UBotAlpha.json here");
    assert.ok(!existsSync(join(dir, ".github")), "no file outside data/ and vendor/ is written: the docs need no other file for a new package");
    assert.ok(first.todo.some((l) => /write the manual in src\/content\/docs\/alpha\/: index\.mdx \(overview\), _group\.yml with label: uBotAlpha and packages: \[UBotAlpha\]/.test(l)), first.todo.join("\n"));

    // second run: the submodule is registered now (simulate what git wrote), nothing else changes
    writeFileSync(join(dir, ".gitmodules"), `${readFileSync(join(dir, ".gitmodules"), "utf8")}[submodule "vendor/uBotAlpha"]\n\tpath = vendor/uBotAlpha\n\turl = https://github.com/AstreoX/uBotAlpha.git\n`);
    calls.length = 0;
    const second = addPackage({ root: dir, name: "UBotAlpha", run });
    assert.deepEqual(calls, []);
    assert.ok(second.done.includes("submodule vendor/uBotAlpha is already registered"));
    assert.ok(second.done.includes("data/zh/UBotAlpha/ exists"));

    const gamma = addPackage({ root: dir, name: "UBotGamma", submodule: false, run });
    assert.ok(gamma.done.includes("submodule vendor/uBotGamma is already registered"));
    const beta = addPackage({ root: dir, name: "UBotBeta", submodule: false, run });
    assert.match(beta.todo[0], /UBotBeta has no released version/);
    assert.ok(beta.todo.some((l) => /git submodule add --depth 1 https:\/\/github\.com\/AstreoX\/uBotBeta\.git vendor\/uBotBeta/.test(l)));
    assert.deepEqual(calls, [], "--no-submodule runs no git command");
  } finally {
    removeDir(dir);
  }
});
