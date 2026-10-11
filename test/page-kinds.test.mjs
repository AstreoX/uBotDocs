// Page kinds (frontmatter pageKind): what `npm run check` requires of each, how stubs are treated, and
// the templates in docs-templates/ (one example file per kind, in the fixed order of its sections).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PAGE_KINDS } from "../lib/content-packages.mjs";
import { checkPage, contentFiles, splitPage } from "../lib/check.mjs";
import { createPackageRegistry } from "../lib/packages.mjs";
import { repoPackages, root, site, tinyRegistry } from "./helpers.mjs";

const front = (kind, extra = "") => `title: 测试\ndescription: 说明${kind ? `\npageKind: ${kind}` : ""}${extra}`;
const page = (body, fm) => `---\n${fm}\n---\n\n${body}`;
const FENCE = "```";
const GRAPH = `${FENCE}blueprint\nnodes:\n  B: K2Node_IfThenElse\n${FENCE}\n`;
const STUB = "{/* STUB */}\n{/*\n待写章节：\n- [ ] 一节\n*/}\n";
const check = (rel, text, opts = {}) => checkPage(`src/content/docs/${rel}`, text, tinyRegistry(), opts);
const msgs = (findings, severity) => findings.filter((f) => f.severity === severity).map((f) => `${f.line}: ${f.message}`).join("\n");

/** The repository's packages plus one that is only planned: pages never depend on which packages the index plans. */
function withPlanned(name) {
  const { index } = repoPackages();
  const entry = { name, friendlyName: name, description: { en: "Not released." }, repository: `https://github.com/AstreoX/${name}.git`, versions: [{ version: "0.1.0", planned: true, requires: [], enginePlugins: [], provides: [] }] };
  return createPackageRegistry({ ...index, packages: [...index.packages, entry] });
}

test("every page needs a pageKind from the list; the home page and 404 are exempt", () => {
  const none = check("concepts/a.mdx", page("这一页说明一件事。\n\n| a |\n| - |\n", front("")));
  assert.match(msgs(none, "error"), new RegExp(`pageKind is required \\(${PAGE_KINDS.join(" \\| ")}\\)`));
  const bad = check("concepts/a.mdx", page("这一页说明一件事。\n\n| a |\n| - |\n", front("guide")));
  assert.match(msgs(bad, "error"), /^4: frontmatter: pageKind "guide" is not one of overview \| feature/);
  for (const kind of PAGE_KINDS) assert.doesNotMatch(msgs(check("concepts/a.mdx", page("这一页说明一件事。\n\n| a |\n| - |\n", front(kind))), "error"), /pageKind/, kind);
  assert.equal(msgs(check("index.mdx", page("正文。", "title: 首页\ntemplate: splash")), "error"), "", "the splash page has no kind");
  assert.equal(msgs(check("404.md", page("找不到这一页。", "title: 页面不存在\ndescription: 找不到")), "error"), "", "404 has no kind");
  assert.deepEqual(PAGE_KINDS, ["overview", "feature", "concept", "settings", "faq", "placeholder"]);
});

test("feature pages need a blueprint graph, unless the page sets graph: false", () => {
  const without = check("sensor/a.mdx", page("这一页说明一件事。", front("feature")));
  assert.match(msgs(without, "error"), /feature pages need at least one ```blueprint graph/);
  assert.equal(msgs(check("sensor/a.mdx", page(`这一页说明一件事。\n\n${GRAPH}`, front("feature"))), "error"), "");
  assert.equal(msgs(check("start/install.mdx", page("这一页说明一件事。", front("feature", "\ngraph: false"))), "error"), "", "graph: false for a page about installation, the command line or C++");
  assert.match(msgs(check("start/install.mdx", page("这一页说明一件事。", front("feature", "\ngraph: nope"))), "error"), /graph must be true or false/);
  assert.equal(msgs(check("concepts/a.mdx", page("这一页说明一件事。", front("concept"))), "error"), "", "only feature pages need a graph");
});

test("overview pages need a table, written or generated", () => {
  assert.match(msgs(check("sensor/index.mdx", page("这一页说明一件事。", front("overview"))), "error"), /overview pages need a table/);
  assert.equal(msgs(check("sensor/index.mdx", page("这一页说明一件事。\n\n| a | b |\n| - | - |\n| 1 | 2 |\n", front("overview"))), "error"), "");
  assert.equal(msgs(check("sensor/index.mdx", page('这一页说明一件事。\n\n<table><tr><td>1</td></tr></table>\n', front("overview"))), "error"), "");
  assert.equal(msgs(check("start/index.mdx", page("这一页说明一件事。\n\n<PackageList />\n", front("overview"))), "error"), "", "a component that draws a table counts");
});

test("concept pages accept the diagram components as their picture", () => {
  assert.match(msgs(check("concepts/a.mdx", page("这一页说明一件事。", front("concept"))), "warning"), /concept pages should have at least one diagram/);
  for (const component of ["DependencyGraph", "SamplingTimeline", "PackageList", "RecipeTable"]) {
    assert.doesNotMatch(msgs(check("concepts/a.mdx", page(`这一页说明一件事。\n\n<${component} />\n`, front("concept"))), "warning"), /diagram/, component);
  }
});

test("placeholder pages: no graphs, no node references, <PackageStatus> of a planned package", () => {
  const packages = withPlanned("UBotPlannedOnly");
  const ok = '这一页说明一件事。\n\n<PackageStatus name="UBotPlannedOnly" />\n';
  const run = (body, p = packages) => check("plannedonly/index.mdx", page(body, front("placeholder")), { packages: p });
  assert.equal(msgs(run(ok), "error") + msgs(run(ok), "warning"), "", "the template shape passes");
  assert.match(msgs(run(`${ok}\n${GRAPH}`), "error"), /placeholder pages describe a plugin that is not released: no ```blueprint graph/);
  assert.match(msgs(run(`${ok}\n见[节点](/reference/ubotsensor/uubotimusensorcomponent/)。\n`), "error"), /^\d+: placeholder pages may not link to the reference/m);
  assert.match(msgs(run('这一页说明一件事。\n'), "error"), /placeholder pages show the status and the package data with <PackageStatus/);
  assert.match(msgs(run('这一页说明一件事。\n\n<PackageStatus name="UBotNope" />\n'), "error"), /PackageStatus: unknown package "UBotNope"/);
  assert.match(msgs(run('这一页说明一件事。\n\n<PackageStatus name={name} />\n'), "error"), /PackageStatus needs a literal name/);
  // a released package: the placeholder is out of date, a warning that says what to do
  const released = repoPackages().released()[0];
  const stale = run(`这一页说明一件事。\n\n<PackageStatus name="${released.name}" />\n`, repoPackages());
  assert.equal(msgs(stale, "error"), "");
  assert.match(msgs(stale, "warning"), new RegExp(`${released.name} is released: turn this placeholder into the manual \\(pageKind: overview`));
  // a placeholder in a released plugin's manual folder declares no package (nothing is released there to declare)
  const manual = repoPackages().get("UBotSensor");
  assert.equal(msgs(check(`${manual.docsSlug}/index.mdx`, page('这一页说明一件事。\n\n<PackageStatus name="UBotSensor" />\n', front("placeholder")), { packages: repoPackages() }), "error"), "");
});

test("stub pages: a warning that names the marker line, an error with stubs: error, and no content rules", () => {
  const stub = page(STUB, front("feature"));
  const warned = check("sensor/a.mdx", stub);
  assert.equal(msgs(warned, "error"), "", "a feature stub has no graph and that is fine");
  assert.match(msgs(warned, "warning"), /^7: stub page, not written yet: .*docs-templates\/feature\.mdx/m);
  const strict = check("sensor/a.mdx", stub, { stubs: "error" });
  assert.match(msgs(strict, "error"), /^7: stub page, not written yet/m);
  assert.equal(strict.length, warned.length, "the same finding, only the severity changes");
  // an overview stub needs no table, a placeholder stub still has to show the package data
  assert.equal(msgs(check("sensor/index.mdx", page(STUB, front("overview"))), "error"), "");
  assert.match(msgs(check("plannedonly/index.mdx", page(STUB, front("placeholder")), { packages: withPlanned("UBotPlannedOnly") }), "error"), /<PackageStatus/);
  // a stub still needs its frontmatter: kind and description
  assert.match(msgs(check("sensor/a.mdx", page(STUB, front(""))), "error"), /pageKind is required/);
  assert.match(msgs(check("sensor/a.mdx", page(STUB, "title: 测试\npageKind: feature")), "warning"), /add a one-line description/);
  // the marker is only a marker in the body outside code fences
  assert.equal(splitPage(page(`${FENCE}md\n${STUB}${FENCE}\n`, front("feature"))).stubLine, 0);
  assert.equal(splitPage(page(STUB, front("feature"))).stubLine, 7);
  assert.equal(splitPage(page("正文。\n", front("feature"))).stubLine, 0);
});

test("the repository's stubs name their kind, and their checklist lists sections", () => {
  for (const rel of contentFiles(root).filter((f) => /\.mdx$/.test(f))) {
    const text = readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
    const parsed = splitPage(text);
    if (!parsed.stubLine) continue;
    assert.ok(PAGE_KINDS.includes(parsed.frontmatter.pageKind), `${rel}: pageKind`);
    assert.match(text, /待写章节（[^）]+，章节顺序见 docs-templates\/\w+\.mdx）：\n- \[ \]/, `${rel}: a checklist of the sections to write`);
    assert.ok(text.includes(`docs-templates/${parsed.frontmatter.pageKind}.mdx`), `${rel}: names the template of its own kind`);
  }
});

// ------------------------------------------------------------------ docs-templates/

const TEMPLATES = join(root, "docs-templates");
const template = (kind) => readFileSync(join(TEMPLATES, `${kind}.mdx`), "utf8").replace(/\r\n/g, "\n");
const headings = (text, level) => splitPage(text).prose.filter(({ text: t }) => t.startsWith(`${"#".repeat(level)} `)).map(({ text: t }) => t.slice(level + 1).trim());

test("there is one template per page kind, and nothing else in docs-templates/", () => {
  assert.deepEqual(readdirSync(TEMPLATES).sort(), PAGE_KINDS.map((k) => `${k}.mdx`).sort());
  for (const kind of PAGE_KINDS) assert.equal(splitPage(template(kind)).frontmatter.pageKind, kind);
  // the stubs' checklists point at these files
  for (const kind of PAGE_KINDS) assert.ok(existsSync(join(TEMPLATES, `${kind}.mdx`)), kind);
});

test("every template passes the checks without errors or warnings, as a page of its kind", () => {
  const packages = withPlanned("UBotTemplateDemo");
  const { registry } = site();
  for (const kind of PAGE_KINDS) {
    // the placeholder names a plugin that is planned today; the test uses its own planned package
    const text = template(kind).replace(/<PackageStatus name="UBotVehicles" \/>/, '<PackageStatus name="UBotTemplateDemo" />');
    const findings = checkPage(`src/content/docs/templates/${kind}.mdx`, text, registry, { packages });
    assert.deepEqual(findings, [], `${kind}.mdx`);
  }
});

test("each template has the sections of its page kind in the fixed order", () => {
  assert.deepEqual(headings(template("overview"), 2), ["能做什么", "依赖与安装", "组件一览", "下一步"]);
  assert.deepEqual(headings(template("feature"), 2), ["快速用法", "步骤", "关键属性", "输出与事件", "注意事项", "相关参考"]);
  assert.deepEqual(headings(template("settings"), 2), ["在哪里改", "设置表", "保存位置"]);
  assert.deepEqual(headings(template("placeholder"), 2), ["定位", "计划提供的能力", "与现有插件的关系", "发布前可以先怎么做"]);
  const concept = headings(template("concept"), 2);
  assert.ok(concept.length >= 3 && concept.at(-1) === "相关页面", `concept: sections, then 相关页面 (${concept.join(", ")})`);
  // 一句话 -> 图或表 -> 分节说明: the first prose line is a sentence and a table comes before the first section
  const body = template("concept");
  assert.ok(body.indexOf("| --- |") < body.indexOf("\n## "), "the table comes before the first section");
  const faq = template("faq");
  assert.ok(headings(faq, 2).length >= 1 && headings(faq, 3).length >= 2, "groups (##) of questions (###)");
  // the opening sentence comes first on every kind but the placeholder (which opens with the status
  // line of <PackageStatus>): no heading, list or table before it
  for (const kind of PAGE_KINDS.filter((k) => k !== "placeholder")) {
    const first = splitPage(template(kind)).prose.find(({ text }) => text.trim() && !/^\s*(import|export|\{\/\*|<PackageStatus)/.test(text));
    assert.ok(first && !/^\s*(#|\||-|<|\d+\.)/.test(first.text), `${kind}: the first line is a sentence`);
  }
});
