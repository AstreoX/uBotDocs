import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPage, checkEngineList, checkLockfile, sentenceCount, admonitions, splitPage, textLength, proseParagraphs, contentFiles } from "../lib/check.mjs";
import { tinyRegistry, site, root } from "./helpers.mjs";

const page = (body, fm = "title: 测试\ndescription: 说明") => `---\n${fm}\n---\n\n${body}`;
const msgs = (fs, sev) => fs.filter((f) => !sev || f.severity === sev).map((f) => `${f.line}: ${f.message}`).join("\n");

test("fenced blocks are found with their line numbers", () => {
  const p = splitPage(page("第一段。\n\n```blueprint\nnodes:\n  A: X\n```\n\n````md\n```blueprint\nnot a block\n```\n````\n"));
  assert.equal(p.blocks.length, 2);
  assert.equal(p.blocks[0].lang, "blueprint");
  assert.equal(p.blocks[0].line, 8);
  assert.equal(p.blocks[1].lang, "md", "a blueprint fence inside a longer fence is content, not a block");
});

test("guides need a blueprint graph", () => {
  const fs = checkPage("src/content/docs/guides/x/a.mdx", page("这一页说明一件事。"), tinyRegistry());
  assert.match(msgs(fs, "error"), /guide pages need at least one/);
  const ok = checkPage("src/content/docs/concepts/a.mdx", page("这一页说明一件事。"), tinyRegistry());
  assert.equal(msgs(ok, "error"), "");
  assert.match(msgs(ok, "warning"), /concept pages should have at least one diagram/);
});

test("blueprint errors point at page lines", () => {
  const fs = checkPage("src/content/docs/guides/a.mdx", page("这一页说明一件事。\n\n```blueprint\nnodes:\n  A: UChild.Nope\n```\n"), tinyRegistry());
  const e = fs.filter((f) => f.severity === "error");
  assert.equal(e.length, 1);
  assert.equal(e[0].line, 10);
  assert.equal(e[0].file, "src/content/docs/guides/a.mdx");
});

test("long paragraphs and style issues are warnings", () => {
  const long = "这是一段很长的说明文字".repeat(25) + "。";
  const fs = checkPage("src/content/docs/concepts/a.mdx", page(`这一页说明一件事。\n\n${long}\n\n| a | b |\n| - | - |\n| 1 | 2 |\n`), tinyRegistry());
  assert.match(msgs(fs, "warning"), /paragraph is long \(275 characters/);
  const style = checkPage("src/content/docs/concepts/b.mdx", page("这一页说明UE5的用法,很简单。\n\n| a |\n| - |\n"), tinyRegistry());
  const w = msgs(style, "warning");
  assert.match(w, /space between Chinese and Latin/);
  const punct = checkPage("src/content/docs/concepts/c.mdx", page("这一页说明一件事,很简单。\n\n| a |\n| - |\n"), tinyRegistry());
  assert.match(msgs(punct, "warning"), /full-width punctuation/);
  const fine = checkPage("src/content/docs/concepts/d.mdx", page("这一页说明 `Get Value` 节点，单位是 m/s²。\n\n| a |\n| - |\n"), tinyRegistry());
  assert.equal(msgs(fine, "warning"), "");
});

test("frontmatter and first sentence are checked", () => {
  const noTitle = checkPage("src/content/docs/a.mdx", "---\ndescription: x\n---\n\n正文。\n", tinyRegistry());
  assert.match(msgs(noTitle, "error"), /title is required/);
  const heading = checkPage("src/content/docs/a.mdx", page("## 先来一个标题\n\n正文。"), tinyRegistry());
  assert.match(msgs(heading, "warning"), /start the page with one sentence/);
});

test("engine node list format", () => {
  const ok = checkEngineList("l.txt", readPage("data/engine-nodes.txt"));
  assert.deepEqual(ok, []);
  const bad = checkEngineList("l.txt", "/Script/Engine.KismetMathLibrary:VSize\nKismetMathLibrary.VSize\n/Script/Engine.KismetMathLibrary:VSize\nnode /Script/BlueprintGraph.IfThenElse\n");
  assert.deepEqual(bad.map((f) => f.line), [2, 3, 4]);
  assert.match(bad[1].message, /listed twice \(first on line 1\)/);
});

test("text length counts Han characters and Latin words", () => {
  assert.equal(textLength("采样 Update Rate Hz 为 100"), 3 + 4);
  assert.equal(proseParagraphs([{ line: 1, text: "第一行" }, { line: 2, text: "第二行" }, { line: 3, text: "" }, { line: 4, text: "- 列表" }]).length, 1);
});

test("every hand-written page in the repository passes the checks without errors", () => {
  const { registry } = site();
  for (const rel of contentFiles(root).filter((f) => /\.mdx?$/.test(f))) {
    const findings = checkPage(rel, readPage(rel), registry).filter((f) => f.severity === "error");
    assert.deepEqual(findings, [], rel);
  }
});

function readPage(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("paragraphs over three sentences, long callouts and card grids are warnings", () => {
  const four = checkPage("src/content/docs/concepts/a.mdx", page("这一页说明一件事。\n\n第一句。第二句。第三句。第四句。\n\n| a |\n| - |\n"), tinyRegistry());
  assert.match(msgs(four, "warning"), /paragraph has 4 sentences \(at most 3\)/);
  const three = checkPage("src/content/docs/concepts/b.mdx", page("这一页说明一件事。\n\n第一句。第二句。第三句。\n\n| a |\n| - |\n"), tinyRegistry());
  assert.equal(msgs(three, "warning"), "");

  const box = checkPage("src/content/docs/concepts/c.mdx", page("这一页说明一件事。\n\n:::caution\n先做这个。再做那个。最后做这个。\n:::\n\n| a |\n| - |\n"), tinyRegistry());
  assert.match(msgs(box, "warning"), /:::caution box has 3 sentences \(at most 2\)/);
  const shortBox = checkPage("src/content/docs/concepts/d.mdx", page("这一页说明一件事。\n\n:::caution\n先做这个。再做那个。\n:::\n\n| a |\n| - |\n"), tinyRegistry());
  assert.equal(msgs(shortBox, "warning"), "");

  const cards = page("这一页说明一件事。\n\n<CardGrid>\n  <Card title=\"a\">b</Card>\n</CardGrid>\n\n| a |\n| - |\n");
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
