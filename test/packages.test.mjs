import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkPackageSpecs, createPackageRegistry, docsPath, docsSlug, folderOf, loadPackages, packageLabel, packageLine, parseGitHubRepository, parsePackageSpec, requirementsOf, validateIndex,
} from "../lib/packages.mjs";
import { PACKAGE_FILTER, requiresLine } from "../lib/content-packages.mjs";
import { compareVersions, describeRange, describeVersionFamily, parseRange, parseVersion, satisfies } from "../lib/semver.mjs";
import { root } from "./helpers.mjs";

const version = (v, extra = {}) => ({ version: v, ref: `v${v}`, requires: [], enginePlugins: [], provides: [], ...extra });
const planned = (v, extra = {}) => ({ version: v, planned: true, requires: [], enginePlugins: [], provides: [], ...extra });
const pkg = (name, layer, versions, extra = {}) => ({ name, friendlyName: name.replace(/^UBot/, "uBot "), description: { en: `${name} en`, "zh-CN": `${name} 中文` }, layer, repository: `https://github.com/AstreoX/${name.replace(/^UBot/, "uBot")}.git`, versions, ...extra });

/** An index with packages in a scrambled order (the index's `layer` is data the docs do not use). */
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

test("packages keep the order of the index; ordered() lists released ones first, then planned ones, each in index order", () => {
  const r = createPackageRegistry(sampleIndex());
  assert.deepEqual(r.list().map((p) => p.name), ["UBotZeta", "UBotROS", "UBotSensor", "UBotAlpha", "UBotCore"]);
  assert.deepEqual(r.ordered().map((p) => p.name), ["UBotROS", "UBotSensor", "UBotAlpha", "UBotCore", "UBotZeta"], "the order of the sidebar");
  // layers are in the index, not in the registry: nothing can show one by accident
  const sensor = r.get("UBotSensor");
  assert.ok(!Object.keys(sensor).some((k) => /layer/i.test(k)) && !("releasedByLayer" in r), "no layer in the registry");
});

test("how the docs name a package and where its manual is: the label, the docs folder and its path", () => {
  assert.equal(packageLabel("UBotSensor"), "uBotSensor");
  assert.equal(packageLabel("UBotMCP"), "uBotMCP");
  assert.equal(packageLabel("Other"), "Other", "only the UBot prefix is lowered");
  assert.equal(docsSlug("UBotSensor"), "sensor", "the name without the UBot prefix, lower case");
  assert.equal(docsSlug("UBotROS"), "ros");
  assert.equal(docsSlug("UBotVehicles"), "vehicles");
  assert.equal(docsSlug("Rover"), "rover", "a name without the prefix is its own folder");
  assert.equal(docsSlug("UBot"), "ubot");
  assert.equal(docsPath("UBotSensor"), "/sensor/");
  const r = createPackageRegistry(sampleIndex());
  const zeta = r.get("UBotZeta");
  assert.deepEqual([zeta.label, zeta.docsSlug, zeta.docsPath, zeta.released], ["uBotZeta", "zeta", "/zeta/", false], "a planned package has its folder (the placeholder page) too");
  assert.equal(r.byDocsSlug("sensor").name, "UBotSensor");
  assert.equal(r.byDocsSlug("nope"), null);
  assert.equal(r.get("UBotSensor").path, "/reference/ubotsensor/", "the reference keeps the package name in its URL");
  assert.equal(zeta.planned.version, "0.1.0", "the planned version of a package without a release");
  assert.equal(r.get("UBotSensor").planned, null, "a released package has no planned version to show");
});

test("released and planned: a package is released when it has a version that is not planned", () => {
  const r = createPackageRegistry(sampleIndex());
  assert.deepEqual(r.released().map((p) => p.name), ["UBotROS", "UBotSensor", "UBotAlpha", "UBotCore"]);
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
  assert.equal(r.get("UBotSensor").path, "/reference/ubotsensor/", "URLs do not contain a version");
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

test("the repository's data/index.json and data/api load without errors", () => {
  // A released package without data/api/<Name>.json and an api.json of a version the index does not
  // list (the sync bot's default-branch fallback) are warnings of npm run check, not test failures.
  const { registry, diagnostics } = loadPackages({ root, fresh: true });
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  assert.ok(registry.released().length > 0, "the index has released packages");
  // data/index.json is a byte copy of uBotCore's index (format 2); the site reads it as is.
  assert.equal(JSON.parse(readFileSync(join(root, "data", "index.json"), "utf8")).formatVersion, 2);
});

test("an api.json of a version the index does not list: the data's version is shown, the latest release stands in", () => {
  const r = createPackageRegistry(sampleIndex(), { apiVersions: new Map([["UBotSensor", "0.1.7"]]) });
  const s = r.get("UBotSensor");
  assert.equal(s.documentedVersion, "0.1.7", "the reference shows the version of the data");
  assert.equal(s.documented, null, "no index entry for it");
  assert.equal(s.current.version, "0.1.1", "dependencies and binaries come from the latest release");
  assert.deepEqual(s.requires.map((x) => x.name), ["UBotCore"]);
});

test("validateIndex reports what the site cannot use, with the line of the package", () => {
  const index = sampleIndex();
  index.packages.push(pkg("UBotBad", "Middleware", [version("0.1.0", { requires: [{ name: "UBotNope", version: "^1" }] }), { version: "x.y" }]));
  index.packages.push(pkg("UBotCore", "Foundation", [version("0.1.0")]));
  index.packages.push({ ...pkg("UBotNoLayer", "", [version("0.1.0", { ref: undefined })]), layer: undefined, repository: undefined });
  index.packages.push(pkg("UBotManager", "Capability", [planned("0.1.0")])); // its docs folder "manager/" is a section of the site
  index.packages.push(pkg("Zeta", "Capability", [planned("0.1.0")])); // "zeta/" like UBotZeta
  const text = JSON.stringify(index, null, 2);
  const ds = validateIndex(index, text, "data/index.json");
  const msgs = ds.filter((d) => d.severity === "error").map((d) => d.message).join("\n");
  assert.doesNotMatch(msgs, /"layer"/, "the layer is not validated: the docs do not use it");
  assert.match(msgs, /requires "UBotNope", which is not in the index/);
  assert.match(msgs, /every version needs a SemVer "version"/);
  assert.match(msgs, /package UBotCore: listed twice/);
  assert.match(msgs, /package UBotManager: its docs folder "manager\/" is a section of the site/);
  assert.match(msgs, /package Zeta: uses the docs folder "zeta\/" like UBotZeta/);
  assert.match(msgs, /UBotNoLayer: "repository" is required for a released package/);
  assert.match(msgs, /UBotNoLayer 0.1.0: a released version needs "ref"/);
  const bad = ds.find((d) => /UBotNoLayer: "repository" is required/.test(d.message));
  assert.equal(bad.line, text.split("\n").findIndex((l) => l.includes('"name": "UBotNoLayer"')) + 1, "package errors point at the package's name");
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
  assert.ok(msgs(["UBotNope"]).includes(`unknown package "UBotNope" (known: ${r.released().map((p) => p.name).join(", ")})`), msgs(["UBotNope"]));
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
  assert.deepEqual(req.declared.map((d) => `${d.label} ${d.version} ${d.href}`), ["uBotSensor 0.1.x /reference/ubotsensor/", "uBotROS 0.1 及以上 /reference/ubotros/"]);
  assert.deepEqual(req.dependencies.map((d) => d.name), ["UBotCore"]);
  assert.deepEqual(req.enginePlugins, []);
  assert.deepEqual(requirementsOf(["UBotNope"], r), { declared: [], dependencies: [], enginePlugins: [] });
  // without a range: the family of the current version, so a 0.x page never promises the next minor
  assert.equal(requirementsOf(["UBotAlpha"], r).declared[0].version, "1.x", "1.0.0 -> ^1.0");
  assert.equal(requirementsOf(["UBotSensor@^0.1.1"], r).declared[0].version, "0.1.1 及以上 0.1.x");
});

test("the 需要 line names the engine plugins of the declared packages and of their dependencies", () => {
  const index = sampleIndex();
  index.packages.push(pkg("UBotRider", "Content", [version("0.2.0", { requires: [{ name: "UBotAlpha", version: "^1.0.0" }], enginePlugins: ["LearningAgents", "ChaosVehiclesPlugin"] })]));
  const r = createPackageRegistry(index);
  const alpha = requirementsOf(["UBotAlpha"], r);
  assert.deepEqual(alpha.enginePlugins, ["ChaosVehiclesPlugin"]);
  assert.equal(
    requiresLine(alpha),
    `需要：<a href="/reference/ubotalpha/" data-pagefind-filter="${PACKAGE_FILTER}:UBotAlpha">uBotAlpha</a> 1.x（含依赖 <a href="/reference/ubotcore/">uBotCore</a>），并启用引擎插件 ChaosVehiclesPlugin`,
  );
  const rider = requirementsOf(["UBotRider"], r);
  assert.deepEqual(rider.dependencies.map((d) => d.name), ["UBotAlpha", "UBotCore"], "index order");
  assert.deepEqual(rider.enginePlugins, ["ChaosVehiclesPlugin", "LearningAgents"], "index order, each plugin once");
  assert.match(requiresLine(rider), /^需要：<a [^>]+>uBotRider<\/a> 0\.2\.x（含依赖 <a [^>]+>uBotAlpha<\/a>、<a [^>]+>uBotCore<\/a>），并启用引擎插件 ChaosVehiclesPlugin、LearningAgents$/);
  assert.doesNotMatch(requiresLine(requirementsOf(["UBotSensor"], r)), /引擎插件/, "nothing to enable: no clause");
  assert.equal(requiresLine(requirementsOf([], r)), "", "a page that declares nothing has no line");
  assert.equal(PACKAGE_FILTER, "插件", "the search UI shows the filter name as is");
});

test("recipes: index order, packages in the order of the index, available when every package is released", () => {
  const index = sampleIndex();
  index.recipes = [
    { id: "sensors", name: { en: "Sensors", "zh-CN": "传感器" }, description: { en: "Sensors only.", "zh-CN": "只用传感器。" }, packages: ["UBotSensor", "UBotCore"], checks: [] },
    { id: "future", name: { en: "Future" }, description: { en: "Needs a planned package." }, packages: ["UBotCore", "UBotZeta"] },
    { id: "typo", name: { en: "Typo" }, description: { en: "Unknown package." }, packages: ["UBotCore", "UBotNope"] },
    { id: "", packages: [] },
  ];
  const r = createPackageRegistry(index);
  assert.deepEqual(r.recipes().map((x) => [x.id, x.name, x.description, x.packages.join(","), x.available]), [
    ["sensors", "传感器", "只用传感器。", "UBotSensor,UBotCore", true],
    ["future", "Future", "Needs a planned package.", "UBotZeta,UBotCore", false],
    ["typo", "Typo", "Unknown package.", "UBotCore", false],
  ]);
  assert.deepEqual(createPackageRegistry({ formatVersion: 2, packages: [] }).recipes(), [], "recipes are optional");
  const text = JSON.stringify(index, null, 2);
  const ds = validateIndex(index, text).filter((d) => /^recipe/.test(d.message));
  assert.deepEqual(ds.map((d) => [d.severity, d.message]), [
    ["warning", 'recipe typo: "UBotNope" is not in the index; the recipe tables leave the recipe out'],
    ["warning", 'recipe ?: needs an "id" and a non-empty "packages" list; the recipe tables leave it out'],
  ]);
  assert.equal(ds[0].line, text.split("\n").findIndex((l) => l.includes('"id": "typo"')) + 1);
  assert.equal(packageLine(text, "UBotCore"), text.split("\n").findIndex((l) => l.includes('"name": "UBotCore"')) + 1);
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
});

test("ranges in words follow UBotSemVer: a caret on 0.x pins the minor version", () => {
  const cases = [
    ["^0.1", "0.1.x"], ["^0.1.0", "0.1.x"], ["^0.1.2", "0.1.2 及以上 0.1.x"], ["^0.0", "0.0.x"], ["^0.0.3", "0.0.3"], ["^0", "0.x"],
    ["^1.2", "1.2 及以上 1.x"], ["^1", "1.x"], ["^1.0.0", "1.x"], ["^1.2.3-beta", "1.2.3-beta 及以上 1.x"],
    ["~1", "1.x"], ["~1.2", "1.2.x"], ["~0.1.2", "0.1.2 及以上 0.1.x"],
    [">=0.2", "0.2 及以上"], [">=0.1.2", "0.1.2 及以上"], [">1.2", "高于 1.2.x"], [">1.2.3", "高于 1.2.3"],
    ["<0.3", "低于 0.3"], ["<=1.2", "1.2.x 及以下"], ["<=1.2.3", "1.2.3 及以下"],
    ["1.2", "1.2.x"], ["1", "1.x"], ["v0.1", "0.1.x"], ["0.1.1", "0.1.1"], ["=0.1.1", "0.1.1"],
    [">=0.1 <0.3", "0.1 及以上且低于 0.3"], [">= 1.0 <2", "1.0 及以上且低于 2"],
    ["", ""], ["*", ""], [">>1", ">>1"],
  ];
  for (const [range, words] of cases) assert.equal(describeRange(range), words, JSON.stringify(range));
  // the words say what satisfies() does
  assert.ok(satisfies("0.1.9", "^0.1") && !satisfies("0.2.0", "^0.1"), "0.1.x");
  assert.ok(satisfies("1.9.0", "^1.2") && !satisfies("2.0.0", "^1.2") && !satisfies("1.1.9", "^1.2"), "1.2 及以上 1.x");
  assert.ok(satisfies("0.1.5", "~0.1.2") && !satisfies("0.1.1", "~0.1.2") && !satisfies("0.2.0", "~0.1.2"), "0.1.2 及以上 0.1.x");
  assert.equal(describeVersionFamily("0.1.1"), "0.1.x");
  assert.equal(describeVersionFamily("1.2.3"), "1.2 及以上 1.x");
  assert.equal(describeVersionFamily("2.0.0"), "2.x");
  assert.equal(describeVersionFamily("nope"), "");
});
