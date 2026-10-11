import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LAYERS, checkPackageSpecs, createPackageRegistry, folderOf, loadPackages, parseGitHubRepository, parsePackageSpec, requirementsOf, validateIndex,
} from "../lib/packages.mjs";
import { compareVersions, describeRange, parseRange, parseVersion, satisfies } from "../lib/semver.mjs";
import { root } from "./helpers.mjs";

const version = (v, extra = {}) => ({ version: v, ref: `v${v}`, requires: [], enginePlugins: [], provides: [], ...extra });
const planned = (v, extra = {}) => ({ version: v, planned: true, requires: [], enginePlugins: [], provides: [], ...extra });
const pkg = (name, layer, versions, extra = {}) => ({ name, friendlyName: name.replace(/^UBot/, "uBot "), description: { en: `${name} en`, "zh-CN": `${name} 中文` }, layer, repository: `https://github.com/AstreoX/${name.replace(/^UBot/, "uBot")}.git`, versions, ...extra });

/** An index with packages in a scrambled order. */
function sampleIndex() {
  return {
    formatVersion: 2,
    packages: [
      pkg("UBotZeta", "Content", [planned("0.1.0", { requires: [{ name: "UBotSensor", version: "^0.1.0" }] })]),
      pkg("UBotROS", "Adapter", [version("0.1.0", { requires: [{ name: "UBotCore", version: "^0.1.0" }, { name: "UBotSensor", version: "^0.1.0" }] })]),
      pkg("UBotSensor", "Capability", [version("0.1.0", { requires: [{ name: "UBotCore", version: "^0.1.0" }] }), version("0.1.1", { requires: [{ name: "UBotCore", version: "^0.1.0" }], binaries: { "5.5": { Win64: { url: "https://example.invalid/a.zip", sha256: "0".repeat(64) } } } }), planned("0.2.0")]),
      pkg("UBotAlpha", "Capability", [version("1.0.0", { requires: [{ name: "UBotCore", version: "^0.1.0" }], enginePlugins: ["ChaosVehiclesPlugin"] })], { folder: "AlphaFolder" }),
      pkg("UBotCore", "Foundation", [version("0.1.0"), version("0.1.1")], { description: { en: "Core only in English" } }),
    ],
  };
}

test("packages are ordered by layer (Foundation, Capability, Adapter, Content), then by name", () => {
  const r = createPackageRegistry(sampleIndex());
  assert.deepEqual(r.list().map((p) => p.name), ["UBotCore", "UBotAlpha", "UBotSensor", "UBotROS", "UBotZeta"]);
  assert.deepEqual(LAYERS.map((l) => l.label), ["基础", "能力", "适配", "内容"]);
  assert.deepEqual(r.releasedByLayer().map((g) => `${g.layer.label}:${g.packages.map((p) => p.name).join(",")}`), ["基础:UBotCore", "能力:UBotAlpha,UBotSensor", "适配:UBotROS"]);
  assert.equal(r.get("UBotSensor").layerLabel, "能力");
  assert.equal(r.get("UBotSensor").layer, "Capability", "the English layer name stays as data");
});

test("released and planned: a package is released when it has a version that is not planned", () => {
  const r = createPackageRegistry(sampleIndex());
  assert.deepEqual(r.released().map((p) => p.name), ["UBotCore", "UBotAlpha", "UBotSensor", "UBotROS"]);
  assert.deepEqual(r.planned().map((p) => p.name), ["UBotZeta"]);
  assert.equal(r.get("UBotSensor").latest.version, "0.1.1", "the latest released version, not the planned 0.2.0");
  assert.equal(r.get("UBotSensor").documentedVersion, "0.1.1", "without API data the latest release is documented");
  assert.deepEqual(r.get("UBotSensor").prebuilt, [{ engine: "5.5", platform: "Win64" }]);
  assert.deepEqual(r.get("UBotROS").prebuilt, []);
  assert.equal(r.get("UBotZeta").latest, null);
});

test("the documented version comes from data/api when present, and its requires/provides are used", () => {
  const r = createPackageRegistry(sampleIndex(), { apiVersions: new Map([["UBotSensor", "0.1.0"]]) });
  const s = r.get("UBotSensor");
  assert.equal(s.documentedVersion, "0.1.0");
  assert.equal(s.documented.version, "0.1.0");
  assert.equal(s.hasApi, true);
  assert.deepEqual(s.prebuilt, [], "0.1.0 has no binaries");
  assert.equal(r.get("UBotCore").hasApi, false);
});

test("folder names come from the repository URL (or the index's folder), GitHub URLs without .git", () => {
  const r = createPackageRegistry(sampleIndex());
  assert.equal(r.get("UBotSensor").folder, "uBotSensor");
  assert.equal(r.get("UBotAlpha").folder, "AlphaFolder");
  assert.equal(r.get("UBotSensor").githubUrl, "https://github.com/AstreoX/uBotSensor");
  assert.equal(folderOf({ repository: "git@github.com:AstreoX/uBotROS.git" }), "uBotROS");
  assert.equal(folderOf({ repository: "https://github.com/AstreoX/uBotROS/" }), "uBotROS");
  assert.deepEqual(parseGitHubRepository("https://github.com/AstreoX/uBotCore.git"), { owner: "AstreoX", repo: "uBotCore" });
  assert.equal(parseGitHubRepository("https://gitlab.com/a/b.git"), null);
  assert.equal(r.get("UBotSensor").slug, "ubotsensor");
  assert.equal(r.get("UBotSensor").path, "/reference/ubotsensor/", "URLs do not contain the layer");
});

test("descriptions are zh-CN with an English fallback", () => {
  const r = createPackageRegistry(sampleIndex());
  assert.equal(r.get("UBotSensor").description(), "UBotSensor 中文");
  assert.equal(r.get("UBotSensor").description("en"), "UBotSensor en");
  assert.equal(r.get("UBotCore").description(), "Core only in English");
  assert.equal(r.get("UBotSensor").friendlyName, "uBot Sensor");
});

test("dependencies are transitive and skip optional ones", () => {
  const index = sampleIndex();
  index.packages.find((p) => p.name === "UBotROS").versions[0].requires.push({ name: "UBotAlpha", version: "^1.0.0", optional: true });
  const r = createPackageRegistry(index);
  assert.deepEqual(r.dependencies("UBotROS"), ["UBotCore", "UBotSensor"]);
  assert.deepEqual(r.dependencies("UBotZeta"), ["UBotSensor", "UBotCore"], "a planned package's dependencies through its planned version");
  assert.deepEqual(r.dependencies("UBotZeta", { transitive: false }), ["UBotSensor"]);
  assert.deepEqual([...r.closure(["UBotSensor"])].sort(), ["UBotCore", "UBotSensor"]);
});

test("the repository's data/index.json loads without errors and matches data/api", () => {
  const { registry, diagnostics } = loadPackages({ root, fresh: true });
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  for (const p of registry.released()) {
    assert.ok(p.hasApi, `${p.name} is released in data/index.json but data/api/${p.name}.json is missing: its plugin repository has to commit docs/api.json, then npm run sync-api -- --from-github --package ${p.name}`);
    assert.ok(p.documented, `${p.name}: data/api/${p.name}.json documents ${p.documentedVersion}, which data/index.json does not list`);
  }
  // data/index.json is a byte copy of uBotCore's index (format 2); the site reads it as is.
  assert.equal(JSON.parse(readFileSync(join(root, "data", "index.json"), "utf8")).formatVersion, 2);
});

test("validateIndex reports what the site cannot use, with the line of the package", () => {
  const index = sampleIndex();
  index.packages.push(pkg("UBotBad", "Middleware", [version("0.1.0", { requires: [{ name: "UBotNope", version: "^1" }] }), { version: "x.y" }]));
  index.packages.push(pkg("UBotCore", "Foundation", [version("0.1.0")]));
  index.packages.push({ ...pkg("UBotNoLayer", "", [version("0.1.0", { ref: undefined })]), layer: undefined, repository: undefined });
  const text = JSON.stringify(index, null, 2);
  const ds = validateIndex(index, text, "data/index.json");
  const msgs = ds.filter((d) => d.severity === "error").map((d) => d.message).join("\n");
  assert.match(msgs, /UBotBad: "layer" is "Middleware"/);
  assert.match(msgs, /requires "UBotNope", which is not in the index/);
  assert.match(msgs, /every version needs a SemVer "version"/);
  assert.match(msgs, /package UBotCore: listed twice/);
  assert.match(msgs, /UBotNoLayer: "layer" is missing/);
  assert.match(msgs, /UBotNoLayer: "repository" is required for a released package/);
  assert.match(msgs, /UBotNoLayer 0.1.0: a released version needs "ref"/);
  const bad = ds.find((d) => /Middleware/.test(d.message));
  assert.equal(bad.line, text.split("\n").findIndex((l) => l.includes('"name": "UBotBad"')) + 1);
  assert.ok(ds.some((d) => d.severity === "warning" && /UBotCore: no "description.zh-CN"/.test(d.message)));
  assert.match(validateIndex({ formatVersion: 1, packages: [] }).map((d) => d.message).join(), /index format 2/);
});

test("package specs: names, ranges and planned packages", () => {
  const r = createPackageRegistry(sampleIndex());
  assert.deepEqual(parsePackageSpec("UBotSensor@^0.1"), { name: "UBotSensor", range: "^0.1" });
  assert.deepEqual(parsePackageSpec("UBotSensor"), { name: "UBotSensor", range: "" });
  assert.ok(parsePackageSpec("uBot Sensor").error);
  const check = (specs) => checkPackageSpecs(specs, r, { file: "p.md", line: 3 });
  assert.deepEqual(check(["UBotSensor@^0.1", "UBotROS"]).packages, [{ name: "UBotSensor", range: "^0.1" }, { name: "UBotROS", range: "" }]);
  const msgs = (specs) => check(specs).findings.map((f) => f.message).join("\n");
  assert.match(msgs(["UBotNope"]), /unknown package "UBotNope" \(known: UBotCore, UBotAlpha, UBotSensor, UBotROS\)/);
  assert.match(msgs(["ubotsensor"]), /did you mean UBotSensor/);
  assert.match(msgs(["UBotZeta"]), /UBotZeta has no released version yet/);
  assert.match(msgs(["UBotSensor@^0.2"]), /matches no released version of UBotSensor \(released: 0\.1\.1, 0\.1\.0\)/);
  assert.match(msgs(["UBotSensor@>>1"]), /"UBotSensor@>>1"/);
  assert.match(msgs("UBotSensor"), /must be a list/);
  assert.equal(check(["UBotSensor"]).findings.length, 0);
});

test("requirements for the 需要 line: declared packages with a short version, dependencies once", () => {
  const r = createPackageRegistry(sampleIndex());
  const req = requirementsOf(["UBotSensor", "UBotROS@>=0.1"], r);
  assert.deepEqual(req.declared.map((d) => `${d.friendlyName} ${d.version} ${d.href}`), ["uBot Sensor 0.1+ /reference/ubotsensor/", "uBot ROS 0.1+ /reference/ubotros/"]);
  assert.deepEqual(req.dependencies.map((d) => d.name), ["UBotCore"]);
  assert.deepEqual(requirementsOf(["UBotNope"], r), { declared: [], dependencies: [] });
});

test("semver: the grammar of uBotCore's UBotSemVer", () => {
  assert.deepEqual(parseVersion("v1.2"), { major: 1, minor: 2, patch: 0, pre: "", count: 2 });
  assert.equal(parseVersion("1.2.3.4"), null);
  assert.equal(parseVersion("1.x"), null);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
  assert.equal(compareVersions("1.0.0-alpha.beta", "1.0.0-alpha.1"), 1);
  assert.equal(compareVersions("0.1.1", "0.1.0"), 1);
  const cases = [
    ["^0.1", "0.1.0", true], ["^0.1", "0.1.9", true], ["^0.1", "0.2.0", false],
    ["^1.2.3", "1.9.0", true], ["^1.2.3", "2.0.0-beta", false], ["^0.0.3", "0.0.4", false],
    ["~1.2", "1.2.9", true], ["~1.2", "1.3.0", false], ["~1", "1.9.9", true],
    ["1.2", "1.2.5", true], [">1.2", "1.2.9", false], [">1.2", "1.3.0", true], ["<=1.2", "1.2.9", true], ["<1.2", "1.2.0", false],
    [">= 1.0 <2", "1.5.0", true], ["*", "9.9.9", true], ["", "0.0.1", true], ["=0.1.1", "0.1.1", true],
  ];
  for (const [range, v, want] of cases) assert.equal(satisfies(v, range), want, `${v} in "${range}"`);
  assert.equal(parseRange(">="), null);
  assert.equal(parseRange("^x"), null);
  assert.equal(describeRange("^0.1"), "0.1+");
  assert.equal(describeRange(">=0.1.2"), "0.1.2+");
  assert.equal(describeRange("~0.1.2"), "0.1.x");
  assert.equal(describeRange("0.1.1"), "0.1.1");
  assert.equal(describeRange(">=0.1 <0.3"), ">=0.1 <0.3");
});
