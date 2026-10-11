import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./helpers.mjs";

// The concept page "采样与帧头" lists the fields of UBot Frame Header and the values of
// EUBot Sample Status by hand (a table reads better there than a link). These tests fail when the
// plugin data changes and the page does not follow.

const read = (rel) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
const api = JSON.parse(read("data/api/UBotCore.json"));
const page = read("src/content/docs/concepts/sampling-and-frame-header.mdx");

/** `code` values in the first column of the first table under `## heading`. */
function firstColumn(md, heading) {
  const start = md.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `heading ## ${heading}`);
  const section = md.slice(start + 1).split(/\n## /)[0].split("\n");
  const rows = section.filter((l) => l.startsWith("|")).slice(2); // header and separator
  return rows.map((l) => /^\|\s*`([^`]+)`/.exec(l)?.[1]).filter(Boolean);
}

test("the frame header table lists exactly the fields of UBot Frame Header", () => {
  const struct = api.structs.find((s) => s.id === "FUBotFrameHeader");
  const documented = firstColumn(page, "帧头");
  assert.deepEqual([...documented].sort(), struct.fields.map((f) => f.displayName).sort());
});

test("the status table lists exactly the values of EUBot Sample Status", () => {
  const status = api.enums.find((e) => e.id === "EUBotSampleStatus");
  const documented = firstColumn(page, "状态码");
  assert.deepEqual([...documented].sort(), status.values.map((v) => v.displayName).sort());
});
