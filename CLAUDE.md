# uBot docs: instructions for Claude Code

This repository is the documentation site for the uBot Unreal Engine 5.5 plugins (UBotCore, UBotSensor,
UBotROS). It is an Astro 7 + Starlight site, written in Simplified Chinese. Most changes come from
Claude Code cloud sessions: one GitHub issue describes one page, one session writes it and opens one PR.

## Commands

```bash
npm ci            # install (exact versions from package-lock.json, resolved from registry.npmjs.org)
npm test          # unit tests (node:test) for the graph parser, validation, layout and checks
npm run check     # validates data/api, data/zh, every ```blueprint block and the writing rules
npm run build     # generates the reference, builds dist/, builds the search index, validates links
npm run dev       # local server with live reload (http://localhost:4321)
npm run gen       # regenerate the reference pages only (dev and build do this first)
npm run find -- imu latest --pins   # find node ids and pin ids for blueprint blocks
npm run zh -- todo UBotSensor        # skeletons for missing/stale Chinese summaries
```

**Every PR must pass `npm test`, `npm run check` and `npm run build`.** CI runs the same three.
Warnings from `npm run check` do not fail, but fix the ones your page causes. An invalid `blueprint`
block also fails `npm run build` (for a `.md` page only at the end of the build, after the page was
rendered empty), so do not stop at a green page preview.

The lockfile resolves every package from the official registry and `.npmrc` pins it, so CI does not
depend on a mirror. With a slow connection to npmjs.org install through a mirror for one command only:
`npm ci --registry=https://registry.npmmirror.com` (the lockfile stays unchanged). `npm run check`
fails when `package-lock.json` points at another host.

## Layout

```
src/content/docs/
  index.mdx                 home page (splash)
  start/                    开始: introduction, install, first sensor
  guides/<topic>/           指南: one task per page (sensors/, ros/, manager/, ...)
  concepts/                 概念: mechanisms worth understanding once
  reference/                参考: GENERATED from data/api, git-ignored. Never edit, never commit.
data/api/*.json             API description exported from UE (format 1), one file per plugin + engine.json
data/zh/<Plugin>.yaml       Chinese summaries for API items (classes, nodes, properties, fields, values)
data/engine-nodes.txt       UE engine nodes the exporter writes into data/api/engine.json
lib/blueprint/              graph parser, validator, layout and HTML renderer (shared by all tools)
src/plugins/blueprint.mjs   Markdown plugin: ```blueprint block -> graph HTML
src/scripts/blueprint.js    client: wires, node cards, full-screen view, node index filter
src/scripts/scrollables.js  client: tab stop and scroll hint for tables and diagrams that scroll sideways
scripts/                    gen-reference, check, sync-api, export-api.ps1 (Windows + UE only), zh, find-node
vendor/                     plugin repositories as git submodules, for reading source only
deploy/                     server setup (nginx, SSH gate), see deploy/README.md
```

The sidebar is generated from folders. Do not edit a central list to add a page:

- Order inside a group comes from `sidebar.order` in the frontmatter (use steps of 10).
- A new folder needs a `_group.yml` next to its pages: `label: 传感器` (the Chinese group name).
- Do not create empty folders or stub pages for future content.

## Writing a page

Frontmatter:

```yaml
---
title: 读取 IMU 姿态角
description: 一句话说明这一页解决什么问题（搜索结果和链接预览会用到）。
sidebar:
  order: 20
---
```

Use `.mdx` when you need Starlight components (`import { Steps } from "@astrojs/starlight/components";`),
otherwise `.md`. Link with absolute paths: `/guides/sensors/imu-orientation/`. Broken internal links and
anchors fail the build.

Where things go:

- A task ("how do I …") is a guide: `src/content/docs/guides/<topic>/<slug>.mdx`. Every guide has at
  least one blueprint graph (`npm run check` fails otherwise).
- A mechanism ("how does … work") is a concept page: `src/content/docs/concepts/<slug>.mdx`, with at
  least one diagram, graph or table.
- Facts about a class, node or property belong in the generated reference, not in guides. Guides link
  to it instead of copying pin tables.

## Writing style

This is the main thing the maintainer asked for: short pages, no walls of text, no card grids full of
prose. Follow every rule.

- Start each page with one sentence saying what problem it solves.
- Paragraphs have at most 3 sentences. Prefer steps (`<Steps>`), tables and blueprint graphs over
  prose. `npm run check` warns about paragraphs longer than about 200 characters or with more than
  3 sentences, about `:::note|tip|caution|danger` boxes with more than 2 sentences, and about
  `<Card>`/`<CardGrid>` outside the home page.
- No cards or boxes of text (the maintainer does not like long text rectangles): use lists, tables and
  blueprint graphs. Keep `:::caution` for real warnings only, one or two sentences.
- Every guide has at least one blueprint graph. Concept pages have at least one diagram, graph or table.
- Node, pin and property names stay in English exactly as the Blueprint editor shows them, in code
  style: `Get Latest IMUData`, `Update Rate Hz`, `X (Roll)`. On first use of a Chinese technical term,
  give the English term: 横滚（Roll）, 自动启动（`Auto Start`）.
- Guides link to the reference instead of copying pin tables. Numbers carry units (100 Hz, 0.5 s,
  9.8 m/s²). Defaults come from the reference data, not from memory.
- Chinese typography: full-width punctuation（，。：；！？（））, and a space between Chinese and Latin
  letters or digits: 采样频率 100 Hz，`Sequence` 每次加 1。
- Plain, factual tone. No marketing language ("强大", "轻松", "极致").

## Blueprint graphs

Write a fenced block with the language `blueprint`; the build turns it into a UE-style graph (nodes,
coloured pins, wires, click a node for its card). Nothing else is needed on the page.

````md
```blueprint
caption: 每次采样时把姿态换算成三个角度          # optional, shown under the graph
nodes:
  A: UUBotImuSensorComponent.OnImuDataUpdated     # node id from data/api
  B: { ref: Break:FUBotImuSensorData, hideUnconnected: true }
  C: UKismetMathLibrary.Quat_Rotator
  D: UKismetMathLibrary.BreakRotator
  V: { var: IMU, class: UUBotImuSensorComponent }  # component/variable reference getter
  P: { ref: UKismetSystemLibrary.PrintString, set: { Key: imu } }   # show a pin value
wires:
  - A.Data -> B.UBotImuSensorData
  - B.Orientation Quaternion -> C.Q
  - C.ReturnValue -> D.Rotation
notes:                                            # optional numbered markers, listed under the graph
  B: 选中节点，在 Details 面板里取消勾选不用的字段，引脚就会隐藏。
```
````

Rules:

- Node keys are short identifiers (`A`, `B`, `Tick`). A plain string is a node id. Object forms:
  `{ ref: <id> }` with optional `at: [column, row]`, `hideUnconnected: true` (hide unwired data pins,
  like UE's pin visibility options on break nodes) and `set: { <input pin>: <value> }`;
  `{ var: <name>, class: <ClassId> }` for a component or variable reference;
  `{ inline: { title, kind, inputs: [{ name, type }], outputs: [...] } }` only as a last resort.
- Pins are referenced by internal id (`ReturnValue`, `InRot`, `bValid`) or by display name, case and
  spaces ignored (`Return Value`, `Rotation`, `Valid`). `exec`/`in` mean the input exec pin,
  `then`/`out` the output exec pin; Branch outputs are `True`/`False`.
- Wires always go output -> input. A data input takes one wire; an exec output connects to one input.
- Layout is automatic: flow left to right, the exec line on top, pure nodes next to their consumer.
  Use `at` only when the automatic layout is clearly worse.
- Keep graphs small (3 to 6 nodes). Split a long chain into two graphs and say "后面与上一节相同".
- Captions and notes are one short sentence each; `backticks` render as code. A YAML value that starts
  with a backtick must be quoted: `B: "`Valid` 为 false 时跳过"`.

Finding node ids and pins:

- `npm run find -- <words> --pins` (searches titles, ids, owners and keywords).
- The node index page `/reference/nodes/` in `npm run dev`, last column.
- `grep -n '"id": "' data/api/UBotSensor.json`. Ids are `<OwnerCpp>.<Function>` (for example
  `UUBotImuSensorComponent.GetLatestIMUData`), `Break:<FStruct>` / `Make:<FStruct>`, a K2Node
  class name for special nodes (`K2Node_IfThenElse` is Branch) or `Macro:<Name>` for standard macros
  (`Macro:ForLoop`).

If an engine node you need is not in `data/api/engine.json`, use an `inline` node (it produces a check
warning) and add its path to `data/engine-nodes.txt` in the same PR, e.g.
`/Script/Engine.KismetMathLibrary:Add_VectorVector`, `event /Script/Engine.Actor:ReceiveEndPlay`,
`node /Script/BlueprintGraph.K2Node_DynamicCast`. The next local export picks it up; then replace the
inline node with its id.

## Generated reference and Chinese summaries

`src/content/docs/reference/` is regenerated from `data/api/*.json` on every `npm run dev`/`build`
(`scripts/gen-reference.mjs`). Never edit it and never commit it.

Chinese text for API items goes into `data/zh/<Plugin>.yaml`:

```yaml
UUBotImuSensorComponent.GetLatestIMUData:
  summary: 返回最近一次采样的 IMU 数据副本，不会触发新的采样。
  sourceHash: "e3b0c44298fc"
```

- Keys are ids from data/api: a class or struct (`FUBotFrameHeader`), a node, `Class.Property`,
  `Struct.Field` or `Enum.Value`.
- `sourceHash` is the hash of the English tooltip the summary was written from:
  `npm run zh -- hash <id>`, or take the skeletons from `npm run zh -- todo <Plugin>`.
- When the English tooltip changes, the summary becomes stale: the site shows English again and
  `npm run check` warns. Update the text and the hash together.
- Entries for ids that no longer exist fail `npm run check`.
- Write summaries from the source code (vendor/), not from guesses: one or two short sentences, units
  included.

## API data (data/api)

`data/api/*.json` is produced on a Windows machine with UE 5.5 by the `UBotDocExport` commandlet
(`scripts/export-api.ps1`, then `scripts/sync-api.mjs`). Cloud sessions cannot run it: do not hand-edit
these files to "fix" a missing node or pin; describe the problem in the PR instead. A file whose
`"generator"` is not `UBotDocExport <n>` produces a check warning.

What the exporter writes, so pages match it:

- Titles, pin names, pin order and advanced pins are what the editor draws. A Break node with more than
  five pins shows only its first two fields and folds the rest behind ▾ (`advanced: true`); wiring an
  advanced pin shows it. With `hideUnconnected: true` the renderer recomputes this like UE does.
- A component's event is exported as `"<Delegate>"` (`On Imu Data Updated`); in a graph write
  `{ ref: UUBotImuSensorComponent.OnImuDataUpdated, component: IMU }` to get the editor's title
  `On Imu Data Updated (IMU)`. The event's red delegate pin is not exported; the renderer draws it.
- A subclass lists an inherited property again only when it changes the default (the IMU's
  `Update Rate Hz` is 100, the sensor base class says 10). Unchanged inherited properties are linked
  from the class page's "继承的节点和属性" section.
- `titleZh` is the node title in a Chinese editor; reference pages and the node index show it.

## Plugin source (vendor/)

`vendor/uBotCore`, `vendor/uBotSensor` and `vendor/uBotROS` are git submodules of the plugin
repositories, for reading the C++ source when writing pages and summaries:

```bash
git submodule update --init --depth 1
```

The build never reads vendor/. Do not change the submodule commits in a docs PR unless the issue asks
for it.

## Do not

- edit or commit `src/content/docs/reference/`, `dist/`, `.astro/` or `node_modules/`;
- add web fonts, CDNs or other runtime requests to third-party hosts (readers may be in mainland China);
- add a page without a description, or a guide without a graph;
- add empty folders, stub pages or "coming soon" content;
- put secrets or server details in the repository (deployment uses GitHub secrets, see deploy/README.md).
