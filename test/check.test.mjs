import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { generateReference } from "../lib/reference/index.mjs";
import { checkPage, checkEngineList, checkLockfile, checkContent, contentGroups, sentenceCount, admonitions, splitPage, textLength, proseParagraphs, contentFiles } from "../lib/check.mjs";
import { groupDefaults } from "../lib/content-packages.mjs";
import { createPackageRegistry } from "../lib/packages.mjs";
import { tinyRegistry, site, root, repoPackages, removeDir } from "./helpers.mjs";

const page = (body, fm = "title: 测试\ndescription: 说明\npageKind: concept") => `---\n${fm}\n---\n\n${body}`;
const msgs = (fs, sev) => fs.filter((f) => !sev || f.severity === sev).map((f) => `${f.line}: ${f.message}`).join("\n");

test("fenced blocks are found with their line numbers", () => {
  const p = splitPage(page("第一段。\n\n```blueprint\nnodes:\n  A: X\n```\n\n````md\n```blueprint\nnot a block\n```\n````\n"));
  assert.equal(p.blocks.length, 2);
  assert.equal(p.blocks[0].lang, "blueprint");
  assert.equal(p.blocks[0].line, 9);
  assert.equal(p.blocks[1].lang, "md", "a blueprint fence inside a longer fence is content, not a block");
});

test("a first paragraph that talks about the page is a warning", () => {
  const rule = /talks about the page/;
  for (const opening of ["这一页说明一件事。", "本页说明一件事。", "本文说明一件事。", "uBotX 是规划中的插件，这一页说明它打算做什么。"]) {
    const found = checkPage("src/content/docs/concepts/a.mdx", page(`${opening}\n\n| a |\n| - |\n`), tinyRegistry());
    assert.match(msgs(found, "warning"), rule, opening);
  }
  const fine = checkPage("src/content/docs/concepts/b.mdx", page("说明一件事。\n\n| a |\n| - |\n"), tinyRegistry());
  assert.doesNotMatch(msgs(fine, "warning"), rule);
  const later = checkPage("src/content/docs/concepts/c.mdx", page("说明一件事。\n\n见这一页的下一节。\n\n| a |\n| - |\n"), tinyRegistry());
  assert.doesNotMatch(msgs(later, "warning"), rule, "only the first paragraph is checked");
});

test("a concept page without a diagram, graph or table is a warning", () => {
  const ok = checkPage("src/content/docs/concepts/a.mdx", page("说明一件事。"), tinyRegistry());
  assert.equal(msgs(ok, "error"), "");
  assert.match(msgs(ok, "warning"), /concept pages should have at least one diagram/);
});

test("blueprint errors point at page lines", () => {
  const fs = checkPage("src/content/docs/develop/a.mdx", page("说明一件事。\n\n```blueprint\nnodes:\n  A: UChild.Nope\n```\n"), tinyRegistry());
  const e = fs.filter((f) => f.severity === "error");
  assert.equal(e.length, 1);
  assert.equal(e[0].line, 11);
  assert.equal(e[0].file, "src/content/docs/develop/a.mdx");
});

test("long paragraphs and style issues are warnings", () => {
  const long = "这是一段很长的说明文字".repeat(25) + "。";
  const fs = checkPage("src/content/docs/concepts/a.mdx", page(`说明一件事。\n\n${long}\n\n| a | b |\n| - | - |\n| 1 | 2 |\n`), tinyRegistry());
  assert.match(msgs(fs, "warning"), /paragraph is long \(275 characters/);
  const style = checkPage("src/content/docs/concepts/b.mdx", page("说明UE5的用法,很简单。\n\n| a |\n| - |\n"), tinyRegistry());
  const w = msgs(style, "warning");
  assert.match(w, /space between Chinese and Latin/);
  const punct = checkPage("src/content/docs/concepts/c.mdx", page("说明一件事,很简单。\n\n| a |\n| - |\n"), tinyRegistry());
  assert.match(msgs(punct, "warning"), /full-width punctuation/);
  const fine = checkPage("src/content/docs/concepts/d.mdx", page("说明 `Get Value` 节点，单位是 m/s²。\n\n| a |\n| - |\n"), tinyRegistry());
  assert.equal(msgs(fine, "warning"), "");
});

test("frontmatter and first sentence are checked", () => {
  const noTitle = checkPage("src/content/docs/a.mdx", "---\ndescription: x\n---\n\n正文。\n", tinyRegistry());
  assert.match(msgs(noTitle, "error"), /title is required/);
  const heading = checkPage("src/content/docs/a.mdx", page("## 先来一个标题\n\n正文。"), tinyRegistry());
  assert.match(msgs(heading, "warning"), /start the page with one sentence/);
});

test("engine node list format", () => {
  const ok = checkEngineList("l.txt", readPage("data/engine-nodes/core.txt"));
  assert.deepEqual(ok, []);
  const bad = checkEngineList("l.txt", "# comment\n/Script/Engine.KismetMathLibrary:VSize  # trailing comment\nKismetMathLibrary.VSize\n/Script/Engine.KismetMathLibrary:VSize\nnode /Script/BlueprintGraph.IfThenElse\n");
  assert.deepEqual(bad.map((f) => f.line), [3, 4, 5]);
  assert.match(bad[1].message, /listed twice \(first on line 2\)/);
});

test("text length counts Han characters and Latin words", () => {
  assert.equal(textLength("采样 Update Rate Hz 为 100"), 3 + 4);
  assert.equal(proseParagraphs([{ line: 1, text: "第一行" }, { line: 2, text: "第二行" }, { line: 3, text: "" }, { line: 4, text: "- 列表" }]).length, 1);
});

test("every hand-written page in the repository passes the checks without errors", () => {
  const { registry } = site();
  const packages = repoPackages();
  const defaults = groupDefaults(contentGroups(root));
  for (const rel of contentFiles(root).filter((f) => /\.mdx?$/.test(f))) {
    const findings = checkPage(rel, readPage(rel), registry, { packages, defaults }).filter((f) => f.severity === "error");
    assert.deepEqual(findings, [], rel);
  }
  assert.deepEqual(checkContent(root, registry, { packages }).filter((f) => f.severity === "error"), []);
});

// ------------------------------------------------------------------ packages pages declare

const IMU = "  I: UUBotImuSensorComponent.GetLatestIMUData";
const FRAME = "  F: Break:FUBotFrameHeader";
const ROS = "  R: UUBotROSBridgeSubsystem.GetBridgeEndpoint";
const BRANCH = "  B: K2Node_IfThenElse";
const FENCE = "```";
const graph = (...nodes) => `\n\n${FENCE}blueprint\nnodes:\n${nodes.join("\n")}\n${FENCE}\n`;
const withPackages = (list, body, kind = "feature") => page(`说明一件事。${body}`, `title: 测试\ndescription: 说明\npageKind: ${kind}${list === null ? "" : `\npackages: ${JSON.stringify(list)}`}`);
function checkWith(rel, text, defaults = new Map(), packages = repoPackages()) {
  const findings = checkPage(rel, text, site().registry, { packages, defaults });
  return { errors: msgs(findings, "error"), warnings: msgs(findings, "warning"), findings };
}

/** The repository's packages plus one that is only planned, so the test never depends on which packages the index plans. */
function registryWithPlanned(name) {
  const { index } = repoPackages();
  const entry = { name, friendlyName: name, description: { en: "Not released." }, layer: "Capability", repository: `https://github.com/AstreoX/${name}.git`, versions: [{ version: "0.1.0", planned: true, requires: [], enginePlugins: [], provides: [] }] };
  return createPackageRegistry({ ...index, packages: [...index.packages, entry] });
}

test("pages of a plugin's manual declare their packages, directly or through the folder's _group.yml", () => {
  const sensor = repoPackages().get("UBotSensor");
  const rel = `src/content/docs/${sensor.docsSlug}/a.mdx`;
  const none = checkWith(rel, withPackages(null, graph(IMU)));
  assert.ok(none.errors.includes(`pages of the ${sensor.label} manual (${sensor.docsSlug}/) declare the packages they are about`), none.errors);
  const empty = checkWith(rel, withPackages([], graph(IMU)));
  assert.match(empty.errors, /declare the packages they are about/);
  const viaFolder = checkWith(rel, withPackages(null, graph(IMU)), new Map([[sensor.docsSlug, ["UBotSensor"]]]));
  assert.equal(viaFolder.errors, "");
  assert.equal(viaFolder.warnings, "");
  const pageWins = checkWith(rel, withPackages(["UBotROS"], graph(ROS)), new Map([[sensor.docsSlug, ["UBotSensor"]]]));
  assert.equal(pageWins.errors, "", "the page's own list replaces the folder default");
  assert.ok(none.errors.includes(`add packages: [${sensor.name}] to the frontmatter`), "the hint names the package of the folder");
  assert.equal(checkWith("src/content/docs/develop/a.mdx", withPackages(null, graph(BRANCH))).errors, "", "pages outside the manuals need no package");
});

test("pages that declare no package may use engine nodes only", () => {
  for (const rel of ["src/content/docs/concepts/a.mdx", "src/content/docs/start/a.mdx"]) {
    const engine = checkWith(rel, withPackages(null, graph(BRANCH)));
    assert.equal(engine.errors, "", `${rel}: engine nodes need no package`);
    const sensor = checkWith(rel, withPackages(null, graph(IMU, "  J: UUBotImuSensorComponent.GetLatestIMUData", ROS)));
    assert.match(sensor.errors, /^11: blueprint: node I \("Get Latest IMUData"\) comes from UBotSensor, but the page declares no package; add packages: \[UBotSensor\] to the frontmatter/m, rel);
    assert.match(sensor.errors, /^13: blueprint: node R \("Get Bridge Endpoint"\) comes from UBotROS, but the page declares no package/m);
    assert.equal(sensor.findings.filter((f) => f.severity === "error").length, 2, "one error per package, not per node");
    const empty = checkWith(rel, withPackages([], graph(IMU)));
    assert.match(empty.errors, /comes from UBotSensor, but the page declares no package/, "an empty list declares nothing either");
    assert.equal(checkWith(rel, withPackages(["UBotSensor"], graph(IMU))).errors, "", "declaring the package fixes it");
  }
  const viaFolder = checkWith("src/content/docs/concepts/a.mdx", withPackages(null, graph(IMU)), new Map([["concepts", ["UBotSensor"]]]));
  assert.equal(viaFolder.errors, "", "a folder default counts as a declaration");
  const sensor = repoPackages().get("UBotSensor");
  const manual = checkWith(`src/content/docs/${sensor.docsSlug}/a.mdx`, withPackages(null, graph(IMU)));
  assert.equal(manual.findings.filter((f) => f.severity === "error").length, 1, "a manual page without packages gets the one error that says how to fix it");
  assert.equal(checkWith("src/content/docs/index.mdx", withPackages(null, graph(IMU))).errors, "", "the home page shows what a graph looks like and is about no package");
});

test("unknown names and ranges that match no released version are errors on the packages: line", () => {
  const unknown = checkWith("src/content/docs/develop/a.mdx", withPackages(["UBotNope"], graph(IMU)));
  const known = repoPackages().released().map((p) => p.name).join(", ");
  assert.ok(unknown.errors.includes(`5: frontmatter packages: unknown package "UBotNope" (known: ${known})`), unknown.errors);
  const range = checkWith("src/content/docs/develop/a.mdx", withPackages(["UBotSensor@^9"], graph(IMU)));
  assert.match(range.errors, /"UBotSensor@\^9" matches no released version of UBotSensor/);
  const planned = checkWith("src/content/docs/develop/a.mdx", withPackages(["UBotPlannedOnly"], graph(IMU)), new Map(), registryWithPlanned("UBotPlannedOnly"));
  assert.match(planned.errors, /UBotPlannedOnly has no released version yet/);
  const ok = checkWith("src/content/docs/develop/a.mdx", withPackages(["UBotSensor@^0.1"], graph(IMU)));
  assert.equal(ok.errors, "");
});

test("graphs may use nodes of declared packages, their transitive dependencies and the engine", () => {
  const sensor = checkWith("src/content/docs/develop/a.mdx", withPackages(["UBotSensor"], graph(IMU, FRAME, BRANCH)));
  assert.equal(sensor.errors, "", "UBotCore is a dependency of UBotSensor; engine nodes are always fine");
  const ros = checkWith("src/content/docs/develop/a.mdx", withPackages(["UBotROS"], graph(ROS, IMU, FRAME)));
  assert.equal(ros.errors, "", "UBotROS -> UBotSensor -> UBotCore");
  const missing = checkWith("src/content/docs/develop/a.mdx", withPackages(["UBotSensor"], graph(IMU, ROS)));
  assert.match(missing.errors, /^13: blueprint: node R \("Get Bridge Endpoint"\) comes from UBotROS, which the page does not declare/m);
  const variable = checkWith("src/content/docs/develop/a.mdx", withPackages(["UBotCore"], graph("  V: { var: IMU, class: UUBotImuSensorComponent }")));
  assert.match(variable.errors, /node V \("IMU"\) comes from UBotSensor/, "a variable counts for its class's package");
});

test("a declared package that no graph uses is a warning", () => {
  const unused = checkWith("src/content/docs/develop/a.mdx", withPackages(["UBotROS"], graph(IMU)));
  assert.equal(unused.errors, "");
  assert.match(unused.warnings, /package UBotROS is declared but no graph on the page uses its nodes/);
  const noGraphs = checkWith("src/content/docs/concepts/a.mdx", withPackages(["UBotROS"], "\n\n| a |\n| - |\n", "concept"));
  assert.doesNotMatch(noGraphs.warnings, /declared but no graph/, "only pages with graphs");
});

test("the content walker never enters the generated reference, so regenerating it cannot break a walk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ubot-walk-"));
  try {
    const docs = join(root, "src", "content", "docs");
    cpSync(join(root, "data"), join(dir, "data"), { recursive: true });
    cpSync(docs, join(dir, "src", "content", "docs"), { recursive: true, filter: (src) => relative(docs, src) !== "reference" });
    generateReference({ root: dir });
    const files = contentFiles(dir);
    assert.ok(files.length > 3 && files.every((f) => f.startsWith("src/content/docs/") && !f.startsWith("src/content/docs/reference/")), files.join(", "));

    // another process deletes and rewrites src/content/docs/reference over and over while this one walks
    const generator = `import { generateReference } from ${JSON.stringify(pathToFileURL(join(root, "lib", "reference", "index.mjs")).href)};
for (let i = 0; i < 12; i++) generateReference({ root: ${JSON.stringify(dir)} });`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", generator], { stdio: "ignore" });
    let running = true;
    const exited = new Promise((resolve) => child.on("exit", (code) => { running = false; resolve(code); }));
    let walks = 0;
    const errors = [];
    while (running) {
      try {
        contentFiles(dir);
      } catch (e) {
        errors.push(e.message);
      }
      walks++;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(await exited, 0, "the generator ran");
    assert.ok(walks > 0);
    assert.deepEqual(errors.slice(0, 3), []);
  } finally {
    removeDir(dir);
  }
});

function readPage(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("paragraphs over three sentences, long callouts and card grids are warnings", () => {
  const four = checkPage("src/content/docs/concepts/a.mdx", page("说明一件事。\n\n第一句。第二句。第三句。第四句。\n\n| a |\n| - |\n"), tinyRegistry());
  assert.match(msgs(four, "warning"), /paragraph has 4 sentences \(at most 3\)/);
  const three = checkPage("src/content/docs/concepts/b.mdx", page("说明一件事。\n\n第一句。第二句。第三句。\n\n| a |\n| - |\n"), tinyRegistry());
  assert.equal(msgs(three, "warning"), "");

  const box = checkPage("src/content/docs/concepts/c.mdx", page("说明一件事。\n\n:::caution\n先做这个。再做那个。最后做这个。\n:::\n\n| a |\n| - |\n"), tinyRegistry());
  assert.match(msgs(box, "warning"), /:::caution box has 3 sentences \(at most 2\)/);
  const shortBox = checkPage("src/content/docs/concepts/d.mdx", page("说明一件事。\n\n:::caution\n先做这个。再做那个。\n:::\n\n| a |\n| - |\n"), tinyRegistry());
  assert.equal(msgs(shortBox, "warning"), "");

  const cards = page("说明一件事。\n\n<CardGrid>\n  <Card title=\"a\">b</Card>\n</CardGrid>\n\n| a |\n| - |\n");
  assert.match(msgs(checkPage("src/content/docs/concepts/e.mdx", cards, tinyRegistry()), "warning"), /card grids are for navigation on the home page only/);
  assert.doesNotMatch(msgs(checkPage("src/content/docs/index.mdx", cards, tinyRegistry()), "warning"), /card grids/);
});

test("sentences are counted on Chinese marks and ASCII ones before a capital, code is ignored", () => {
  assert.equal(sentenceCount("一句。两句！三句？"), 3);
  assert.equal(sentenceCount("用 `a。b` 表示。"), 1);
  assert.equal(sentenceCount("See the docs. Then run it."), 2);
  assert.equal(sentenceCount("版本 1.5 之后可用。"), 1);
  const a = admonitions([{ line: 3, text: ":::tip[小技巧]" }, { line: 4, text: "一句。" }, { line: 5, text: ":::" }]);
  assert.deepEqual(a, [{ line: 3, kind: "tip", text: "一句。" }]);
});

test("the lockfile must resolve from the official registry", () => {
  const ok = `{"packages":{"node_modules/a":{"resolved":"https://registry.npmjs.org/a/-/a-1.0.0.tgz"}}}`;
  assert.deepEqual(checkLockfile("package-lock.json", ok), []);
  const bad = `{"packages":{"node_modules/a":{"resolved": "https://registry.npmmirror.com/a/-/a-1.0.0.tgz"},"node_modules/b":{"resolved":"https://registry.npmmirror.com/b/-/b-1.0.0.tgz"}}}`;
  const f = checkLockfile("package-lock.json", bad);
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "error");
  assert.match(f[0].message, /registry\.npmmirror\.com \(2\)/);
  assert.deepEqual(checkLockfile("package-lock.json", readFileSync(join(root, "package-lock.json"), "utf8")), [], "the repository's own lockfile");
});
