import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bodyLineOffset, blueprintBuildGate } from "../src/plugins/blueprint.mjs";

const FRONTMATTER = "---\ntitle: 测试\ndescription: 说明\n---\n";
const BODY = "这一页说明一件事。\n\n```blueprint\nnodes:\n  A: X\n```";

function withFile(name, text, fn) {
  const dir = mkdtempSync(join(tmpdir(), "ubot-docs-test-"));
  try {
    const file = join(dir, name);
    writeFileSync(file, text);
    return fn(pathToFileURL(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test(".md pages: the body Astro passes has its leading and trailing blank lines trimmed; the offset restores file lines", () => {
  // The block's fence is line 3 of the body and line 8 of the file (4 frontmatter lines + a blank line).
  withFile("a.md", `${FRONTMATTER}\n${BODY}\n`, (url) => {
    assert.equal(bodyLineOffset(BODY, url), 5);
  });
});

test("an offset also works for CRLF files", () => {
  withFile("a.md", `${FRONTMATTER}\n${BODY}\n`.replaceAll("\n", "\r\n"), (url) => {
    assert.equal(bodyLineOffset(BODY, url), 5);
  });
});

test(".mdx pages keep their line numbers (frontmatter blanked in place), so there is no offset", () => {
  const blanked = FRONTMATTER.replace(/[^\n]/g, " ");
  withFile("a.mdx", `${FRONTMATTER}\n${BODY}\n`, (url) => {
    assert.equal(bodyLineOffset(`${blanked}\n${BODY}\n`, url), 0);
  });
});

test("a file without frontmatter, and an unreadable file, have offset 0", () => {
  withFile("a.md", `${BODY}\n`, (url) => {
    assert.equal(bodyLineOffset(BODY, url), 0);
  });
  assert.equal(bodyLineOffset(BODY, pathToFileURL(join(tmpdir(), "ubot-docs-does-not-exist.md"))), 0);
});

test("the build gate passes when no block failed and throws once one did", () => {
  const key = Symbol.for("ubot-docs.blueprint.failed");
  const before = globalThis[key];
  try {
    globalThis[key] = [];
    const gate = blueprintBuildGate();
    assert.doesNotThrow(() => gate.hooks["astro:build:done"]());
    globalThis[key] = ["src/content/docs/guides/a.md:12: blueprint: unknown node"];
    assert.throws(() => gate.hooks["astro:build:done"](), /1 invalid blueprint block.*a\.md:12/s);
  } finally {
    globalThis[key] = before;
  }
});
