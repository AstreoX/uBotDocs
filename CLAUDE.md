# uBot docs: instructions for Claude Code

This repository is the documentation site for the uBot Unreal Engine 5.5 plugins ("packages": today
UBotCore, UBotSensor and UBotROS, more to come). It is an Astro 7 + Starlight site, written in
Simplified Chinese. Most changes come from Claude Code cloud sessions: one GitHub issue describes one
page, one session writes it and opens one PR.

Which packages exist is data, not code: `data/index.json` (a copy of the uBot package index) drives
the reference, the sidebar, the dependency graph, the search filter and the checks. Never write a list
of packages into a script or a component; ask `lib/packages.mjs` (see "Packages" below). The one
exception is the colour of a card in the dependency graph (see "Components").

The docs do not talk about layers (Foundation, Capability, Adapter, Content). The index still has a
`layer` per package, but nothing shows it: no layer groups in a sidebar, no layer column or row on a
page, no sentence that explains layers. The relations between plugins are drawn by the dependency graph.

## Commands

```bash
npm ci            # install (exact versions from package-lock.json, resolved from registry.npmjs.org)
npm test          # unit tests (node:test): graph parser, layouts, checks, page kinds, templates, reference, and a simulated package release
npm run check     # validates data/index.json, data/api, data/zh, every ```blueprint block, the packages
                  # pages declare, the page kinds and the writing rules; pages that are still stubs are warnings
npm run check -- --no-stubs   # the same, but a page that is still a stub is an error (when the writing is done)
npm run build     # generates the reference, builds dist/, builds the search index, validates links
npm run dev       # local server with live reload (http://localhost:4321)
npm run gen       # regenerate the reference pages only (dev and build do this first)
npm run find -- imu latest --pins   # find node ids and pin ids for blueprint blocks (--package UBotSensor)
npm run zh -- todo UBotSensor        # skeletons for missing/stale Chinese summaries (or one class id)
npm run zh -- status UBotSensor      # how much of a package (per class) has Chinese summaries
npm run sync-index                   # copy the package index to data/index.json (--from <file>, --from-url)
npm run sync-api -- --from-github    # download each released package's docs/api.json at its release tag
npm run add-package -- <Name>        # onboard a package (see "Adding a new uBot package")
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
  start/                    开始: introduction, install, quickstart, recipes
  concepts/                 核心概念: mechanisms every plugin shares (frame header, clock, coordinates, identity, interfaces)
  <plugin>/                 one folder per plugin, named after the package without the "UBot" prefix, lower case:
                            core/ sensor/ ros/ vehicles/ aerial/ environment/ mcp/ learning/ combat/
                            released: the manual (index = overview, feature pages, settings, faq);
                            planned: index.mdx only, a placeholder page
  manager/                  uBot Manager: tour, packages, recipes, settings, command line
  develop/                  开发者: C++, ROS publishers, writing a package, migration
  appendix/                 附录: glossary, changelog
  reference/                参考: GENERATED from data/, git-ignored. Never edit, never commit.
docs-templates/             one example page per page kind (not published, see "Page templates")
data/index.json             the uBot package index (byte copy of uBotCore's Index/index.json, format 2)
data/api/<Package>.json     API description exported from UE (format 1), one file per package + engine.json
data/zh/<Package>/<Owner>.yaml  Chinese summaries, one file per class, struct or enum (engine: data/zh/Engine/)
data/engine-nodes/<area>.txt    UE engine nodes the exporter writes into data/api/engine.json (core.txt, sensor.txt, ros.txt, ...)
lib/packages.mjs            the package registry: every package list comes from here
lib/semver.mjs              versions and ranges (the grammar of uBotCore's UBotSemVer)
lib/content-packages.mjs    which packages a page declares (frontmatter or folder default), the page kinds, the sections
lib/sidebar.mjs             the sidebar: built from the registry
lib/dependency-graph.mjs    layout of the dependency graph (columns by dependency depth, orthogonal arrows)
lib/reference/              reference generator: package framework (index.mjs) and providers (blueprint.mjs)
lib/blueprint/              graph parser, validator, layout and HTML renderer (shared by all tools)
lib/engine-nodes.mjs        engine node lists: check, merge
src/plugins/blueprint.mjs   Markdown plugin: ```blueprint block -> graph HTML
src/components/             PackageList, RecipeTable, PackageStatus, DependencyGraph (see "Components"),
                            SamplingTimeline, PageTitle (the "需要：…" line under the title and the search's package filter),
                            Hero (the home page's headline beside a Blueprint graph; replaces Starlight's Hero), HomePlugins (home page only)
src/scripts/blueprint.js    client: wires, node cards, full-screen view, node index filter
src/scripts/scrollables.js  client: tab stop and scroll hint for tables and diagrams that scroll sideways
scripts/                    gen-reference, check, sync-index, sync-api, sync-branch, add-package, export-api.ps1 (Windows + UE only), zh, find-node, rebase-links
vendor/<folder>/            plugin repositories as git submodules, for reading source only
deploy/                     server setup (nginx, SSH gate), see deploy/README.md
```

GitHub Pages: `.github/workflows/pages.yml` publishes every push to main at
https://astreox.github.io/uBotDocs/. That build sets `BASE_PATH=/uBotDocs` (Astro's `base`); pages keep
linking with root paths (`/sensor/imu/`), and `scripts/rebase-links.mjs` prefixes the base in `dist/` and
fails on a link that points at no file. Never write `/uBotDocs` into a page or a component.

The sidebar is built from the registry (`lib/sidebar.mjs`, called by `astro.config.mjs`). Do not edit a
central list to add a page or a plugin:

- The order is 开始, 核心概念, one entry per plugin, uBot Manager, 开发者, 参考, 附录. A released
  plugin is a group generated from its folder (labelled `uBotSensor`), the released ones first in index
  order; a planned plugin is one link to `<folder>/index` with the badge 规划中, after them, in index
  order. There are no layer groups and no 规划中 group.
- Order inside a group comes from `sidebar.order` in the frontmatter (use steps of 10, the overview
  first). The sidebar label is the page title, so titles of settings and faq pages start with the plugin
  ("uBotROS 常见问题"): the previous/next links at the bottom of a page use the same text.
- A plugin folder needs a `_group.yml` next to its pages once the plugin is released:
  `label: uBotSensor` and `packages: [UBotSensor]` (the default for its pages, see below).
- The 参考 section is built in `lib/reference/index.mjs` from the registry: 概览, 节点索引, 引擎节点, then
  one group per released package, listed by name. A new package appears there by itself.
- Do not create empty folders. A planned plugin's folder holds its placeholder page and nothing else.

## Writing a page

Frontmatter:

```yaml
---
title: IMU 传感器
description: 一句话说明这一页解决什么问题（搜索结果和链接预览会用到）。
pageKind: feature           # overview | feature | concept | guide | settings | faq | placeholder (required)
packages: [UBotSensor]      # optional when the folder's _group.yml sets it; "UBotSensor@^0.1" adds a range
graph: false                # only for a feature page that is not about Blueprint nodes (install, command line, C++)
sidebar:
  order: 40
---
```

`pageKind` decides the structure of the page (see "Page templates") and what `npm run check` requires:

| pageKind | check |
| --- | --- |
| `overview` | needs a table (what the plugin can do, its components) |
| `feature` | needs at least one `blueprint` graph, unless the frontmatter says `graph: false` |
| `concept` | warns when there is no diagram, graph or table (`<DependencyGraph />` and the other components count) |
| `guide` | opens with one sentence and the last `##` section is 下一步; no graph or table needed (a graph is allowed) |
| `settings`, `faq` | no extra rule |
| `placeholder` | no `blueprint` graph, no link into the reference, must show `<PackageStatus name="UBotX" />`; warns when that package is released (turn the page into the manual) |

`packages` names the uBot packages the page is about (names from `data/index.json`). The site shows
it as one line under the title ("需要：uBotSensor 0.1.x（含依赖 uBotCore），并启用引擎插件 …"), the
search can be filtered by it, and the package's reference page lists the page under 相关页面. A page's
own list replaces its folder's default. The version text is the family of the package's current version
("0.1.x", never "0.1+": a caret on 0.x pins the minor version), or the range written out. `npm run check`:

- fails when a page of a released plugin's manual declares no package (directly or through the folder's
  `_group.yml`); placeholders are exempt;
- fails on unknown names, planned packages and ranges that match no released version;
- fails when a graph uses a node of a package that is neither declared nor a dependency (direct or
  transitive) of a declared one; engine nodes are always fine. A page that declares nothing (a concept
  or start page without `packages`) may use engine nodes only; the home page is exempt;
- warns when a declared package is not used by any graph of a page that has graphs.

Use `.mdx` when you need Starlight components (`import { Steps } from "@astrojs/starlight/components";`),
otherwise `.md`. Link with absolute paths: `/sensor/imu/`. Broken internal links and anchors fail the
build.

Where things go:

- A task ("how do I …") in a plugin's manual is a feature page: `src/content/docs/<plugin>/<slug>.mdx`,
  with a graph. A mechanism ("how does … work") that more than one plugin shares is a concept page in
  `concepts/`; one that belongs to a single plugin is a `concept` page in its folder.
- The first page of every manual (`index.mdx`) is its overview; settings and faq pages end the manual.
- Facts about a class, node or property belong in the generated reference, not in the manual. Pages link
  to it instead of copying pin tables.

### Stub pages

The skeleton of the site (every page, its kind and its sections) is created as stubs: frontmatter
(Chinese title and description, sidebar order, `pageKind`, `packages` where relevant) and a body that is
only the marker `{/* STUB */}` plus a comment with the checklist of the sections to write. A page that
is a stub is a warning in `npm run check` (one line per page); `npm run check -- --no-stubs` makes them
errors, for when the writing is done. To write a page: copy the structure of its kind from
`docs-templates/`, write the sections of the checklist, delete the marker and the checklist. Stubs are
not listed on the reference pages and are exempt from the content rules until the marker is gone.

## Page templates

`docs-templates/` has one example file per page kind. They are outside `src/content`, so they are not
published; `npm test` checks that each passes `npm run check` and has its sections in this order.
Copy the one you need, replace the content, delete the comments. The sections of a fixed template are a
minimum: keep them in this order, and extra sections after them are allowed (the settings page of uBot
Manager ends with an 索引源 section). A tutorial or a tour does not fit a fixed template: it is a
`guide`, whose sections follow the skeleton of the site instead of a template.

| pageKind | used for | sections, in this order |
| --- | --- | --- |
| `overview` (`overview.mdx`) | the first page of a manual | 一句话定位 → 能做什么（表）→ 依赖与安装（`<PackageStatus />`）→ 组件一览（表，链到参考）→ 下一步 |
| `feature` (`feature.mdx`) | most pages of a manual | 一句话目标 → 快速用法（节点图）→ 步骤 → 关键属性（表，只列常用的）→ 输出与事件 → 注意事项 → 相关参考 |
| `concept` (`concept.mdx`) | core concepts | 一句话 → 图或表 → 分节说明 → 相关页面 |
| `guide` (`guide.mdx`) | tutorial and tour pages (start/install, start/quickstart, manager/index) | 一句话 → 自己安排的章节（跟着做的步骤，或一块一块的导览；节点图可有可无）→ 下一步 |
| `settings` (`settings.mdx`) | the 设置项 page of a manual | 在哪里改 → 设置表（名称、默认值、作用）→ 保存位置 |
| `faq` (`faq.mdx`) | the last page of a manual | 按主题分组（二级标题），每题（三级标题）1 到 3 句加链接 |
| `placeholder` (`placeholder.mdx`) | a planned plugin | 状态行和包信息（`<PackageStatus />`，从索引生成）→ 定位 → 计划提供的能力 → 与现有插件的关系 → 发布前可以先怎么做 |

The "一句话" is the opening sentence of the page, not a heading; the status line and the package data
of a placeholder are the `<PackageStatus />` component. The writing style below applies to every kind.

## Components

Components read `data/index.json` through `lib/packages.mjs`, so a release changes them without a
page edit. Import them with a relative path (`import PackageList from "../../../components/PackageList.astro";`).

| component | what it draws |
| --- | --- |
| `<PackageList />` | every package as a table: name (link to its manual or placeholder), status (version or 规划中), description |
| `<RecipeTable />` | the recipes of the index with their packages, planned ones marked 规划中; `<RecipeTable available />` only those that can be applied today |
| `<PackageStatus name="UBotX" />` | status line, description, required packages (links), engine plugins, what it provides, the recipes that include it |
| `<DependencyGraph />` | the dependency graph, drawn like uBot Manager's 依赖图 view |
| `<HomePlugins />` | the home page only: every package as one row of a plain list (name, description, version or 规划中), released first |

The dependency graph (`src/components/DependencyGraph.astro`, layout in `lib/dependency-graph.mjs`,
tests in `test/dependency-graph.test.mjs`): columns by dependency depth from left to right (a package
without dependencies in column 0, any other one column right of the deepest package it requires),
"A → B" means B depends on A, orthogonal arrows. A package every other package requires and that is
alone in column 0 (uBotCore) is one tall card, "所有 Package 都依赖", without arrows. A card shows the
name, the latest released version or 规划中 (dashed, dimmed), and links to the plugin's manual or
placeholder. It is rendered on the server, works in the light and the dark theme, and scrolls sideways
inside its own box on a phone. The colour of a card's top bar comes from a small palette keyed by
package name inside the component (decoration only; an unknown package gets a stable spare colour), not
from the index. If you change the layout, keep `test/dependency-graph.test.mjs` green: arrows never
overlap and stay inside the canvas, also in 500 random graphs.

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
- Every feature page has at least one blueprint graph (unless it sets `graph: false`). Overview pages
  have a table; concept pages have at least one diagram, graph or table. Follow the sections of the
  page kind (see "Page templates").
- Node, pin and property names stay in English exactly as the Blueprint editor shows them, in code
  style: `Get Latest IMUData`, `Update Rate Hz`, `X (Roll)`. On first use of a Chinese technical term,
  give the English term: 横滚（Roll）, 自动启动（`Auto Start`）.
- Labels you read or click in a window are quoted with 「」, in uBot Manager and in the Unreal Editor:
  menu paths (「Window > uBot」), buttons (「Play」, 「Add」), tabs, panels and dialogs (在「Details」面板),
  checkboxes and panel entries (「Loaded Packages」). Code names stay in backticks: nodes, pins and
  properties (also the ones shown in Details or Project Settings), console commands, files and
  command-line options. “” is for ordinary prose only (a term, the name of a section of a page).
- Pages link to the reference instead of copying pin tables. Numbers carry units (100 Hz, 0.5 s,
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
warning) and add its path to a list in `data/engine-nodes/` in the same PR (`core.txt` for general
nodes; nodes only one manual needs into the file of its area: `sensor.txt` and `ros.txt` (empty for now), or
`vehicles.txt` for nodes of an engine plugin), e.g.
`/Script/Engine.KismetMathLibrary:Add_VectorVector`, `event /Script/Engine.Actor:ReceiveEndPlay`,
`node /Script/BlueprintGraph.K2Node_DynamicCast`. The next local export picks it up; then replace the
inline node with its id.

## Generated reference and Chinese summaries

`src/content/docs/reference/` is regenerated from `data/` on every `npm run dev`/`build`
(`scripts/gen-reference.mjs`, see "Reference providers"). Never edit it and never commit it. URLs are
`/reference/<package in lower case>/...` and never contain a version.

Chinese text for API items goes into `data/zh/<Package>/<Owner>.yaml`: one file per class, struct or
enum, so sessions that describe different classes never touch the same file. Nodes and properties go
into their owner class's file, fields into their struct's, values into their enum's, Make/Break nodes
into their struct's; engine nodes into `data/zh/Engine/<Owner>.yaml`. `npm run zh -- where <id>`
prints the file of an id.

```yaml
# data/zh/UBotSensor/UUBotImuSensorComponent.yaml
UUBotImuSensorComponent.GetLatestIMUData:
  summary: 返回最近一次采样的 IMU 数据副本，不会触发新的采样。
  sourceHash: "e3b0c44298fc"
```

- Keys are ids from data/api: a class or struct (`FUBotFrameHeader`), a node, `Class.Property`,
  `Struct.Field` or `Enum.Value`. An entry in the wrong file fails `npm run check` with the right path.
- `sourceHash` is the hash of the English tooltip the summary was written from:
  `npm run zh -- hash <id>`, or take the skeletons from `npm run zh -- todo <Package or ClassId>`
  (grouped by file).
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

Each plugin repository commits its export as `docs/api.json` before tagging a release. The workflow
`.github/workflows/sync-packages.yml` (daily, by hand, or on a `package-released` repository_dispatch)
downloads the index and every released package's `docs/api.json` at its release tag
(`npm run sync-index -- --from-url`, `npm run sync-api -- --from-github`; the default branch when the
tag has no file, said in the PR), runs test, check and build, and opens or updates the PR from
`bot/sync-packages`. No Unreal Engine is needed for that. `scripts/sync-branch.mjs` pushes the branch
only when its data would change, and never over a commit by a person: fix a summary or a page on the
PR branch and the next run leaves it alone (with a warning) until the PR is merged or closed.

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

`vendor/<folder>/` (`vendor/uBotCore`, `vendor/uBotSensor`, ...) are git submodules of the plugin
repositories, for reading the C++ source when writing pages and summaries (`npm run add-package` adds
the one of a new package):

```bash
git submodule update --init --depth 1
```

The build never reads vendor/. Do not change the submodule commits in a docs PR unless the issue asks
for it.

## Packages (lib/packages.mjs)

`data/index.json` is a byte-for-byte copy of uBotCore's `Index/index.json` (format 2, the file uBot
Manager reads, spec in uBotManager's docs/SPEC.md). Update it with `npm run sync-index` (local file,
`--from <file>` or `--from-url`); never edit it here, change the index in uBotCore.

`loadPackages()` returns the registry every script, component and test uses:

- `list()` all packages in the order of the index; `released()` (a version without `planned: true`) and
  `planned()` in that order; `ordered()` released first, then planned (the order of the sidebar and of
  `<PackageList />`);
- per package: `friendlyName` (the index value, "uBot Sensor"), `label` (how the docs write the name:
  "uBotSensor"), `description()` (zh-CN, English fallback), `latest` released version, `planned` (the
  planned version of a package without a release), `documentedVersion` (the version of
  `data/api/<Name>.json`, else the latest), `requires`/`enginePlugins`/`provides`/`prebuilt` of that
  version, `folder` (the index value `folder`, else the repository name: `uBotSensor`), `githubUrl`,
  `hasApi`, `path` (`/reference/<slug>/`), `docsSlug` (`sensor`: the name without "UBot", lower case) and
  `docsPath` (`/sensor/`, the manual or the placeholder page of the plugin);
- `dependencies(name)` (transitive, optional ones skipped), `closure(names)`, `byDocsSlug(slug)`,
  `recipes()` (the recipes of the index, `available` when every package in them is released).

The registry has no layer: the `layer` of the index is ignored on purpose. A docs folder name may not be
one of the sections of the site or the folder of another package (`validateIndex`).

Released packages get a reference home page, a group in the reference and one in the main sidebar, and
a search filter value; planned ones a row in the "规划中" table on `/reference/`, a link in the sidebar
and a card in the dependency graph, all pointing at the placeholder page.

## Reference providers (lib/reference/)

`lib/reference/index.mjs` is the framework: it writes the overview (`/reference/`, with the 规划中
table) and one home page per released package (description, link to the manual, documented version,
dependencies, engine plugins, provides, prebuilt binaries, repository, 相关页面, then the sections of
the providers; stub and placeholder pages are not listed). Each
kind of data has a provider, registered in `PROVIDERS`:

- `blueprint` (`lib/reference/blueprint.mjs`): classes, structs, enums and nodes from
  `data/api/<Package>.json` and `data/zh/`; writes the class/struct/enum pages, the node index and the
  engine node page. It is the only provider today.

A provider is `{ id, label, dataFiles(pkg), siteDataFiles, sidebarLinks({ dataDir }), load(ctx) }`;
`load` reads its data once and returns an instance with optional `covers(pkg)`, `sources(pkg)`,
`packageMeta(pkg)`, `packageSections(pkg)`, `packagePages(pkg, emit, { base })`, `overviewColumns()`,
`overviewIntro()`, `overviewNotes()` and `sitePages(emit)` (the comment at the top of
`lib/reference/index.mjs` is the contract). To add one, for example ROS topics for UBotROS or MCP tools
for UBotMCP:

1. Define the data first, produced by the plugin like `docs/api.json` (for example a `docs/ros.json`
   the plugin exports and commits), and how it reaches `data/` (`sync-api` downloads `docs/api.json`;
   extend it for the new file). Do not write such data by hand and do not add a provider before the
   data exists.
2. Add `lib/reference/<id>.mjs` exporting the provider, append it to `PROVIDERS`. Its pages go under
   `<package slug>/<something>/` (never a version in the path); site-wide pages (an index of
   all topics) get a `sidebarLinks` entry.
3. Validate the data in `npm run check`, test the provider with a temporary data folder (see
   `test/extensibility.test.mjs`), and document the data file here.

## Adding a new uBot package

The docs need no code change for a new package, only data and pages: `data/index.json`,
`data/api/<Name>.json`, `data/engine-nodes/<area>.txt` if needed, `data/zh/<Name>/` and the manual.
`test/new-package.test.mjs` keeps that true: it copies the repository, releases every planned package
and adds a new one (data and a manual folder each), and the copy must pass the whole test suite,
`npm run check` without new warnings and the generator. If it fails, a test or a file depends on today's list of packages;
fix that place to read `lib/packages.mjs` (tests: `repoPackages()` and `packageKit()` in
`test/helpers.mjs`). The sync bot releases packages by changing data only, so a red `npm test` there
means no PR.

Plugin repository:

1. Enable the plugin in the DevHost project (`UBotDev.uproject`: listed with `"Enabled": true`, or found
   through `AdditionalPluginDirectories`), and the engine plugins it needs.
2. Add `docs/api.json text eol=lf` to its `.gitattributes`.
3. Run `scripts/export-api.ps1 -Plugins <Name>` here (Windows, UE 5.5); it checks the project first and
   prints what to add. Commit the plugin's `docs/api.json` before tagging the release.

Index (uBotCore `Index/index.json`): the package entry with `description` (`en`, `zh-CN`),
`repository`, `versions` (`ref` = the tag), `requires`, `enginePlugins`, `provides` (and the `layer`
that uBot Manager uses; the docs ignore it).

Docs repository:

1. `npm run sync-index`, then `npm run add-package -- <Name>` (`data/zh/<Name>/`, and the `vendor/`
   submodule for reading the plugin's source, which the build does not need: `--no-submodule` skips it;
   it prints what is left).
2. `npm run sync-api -- --from-github --package <Name>` (or the sync workflow's PR) for `data/api/<Name>.json`.
3. The folder of the plugin, `src/content/docs/<slug>/` (`<slug>` = the name without "UBot", lower case).
   While the plugin is planned it holds one page, `index.mdx`, a placeholder
   (`docs-templates/placeholder.mdx`): the sidebar and the dependency graph link to it. When the plugin is
   released, turn `index.mdx` into the manual overview (`docs-templates/overview.mdx`), add `_group.yml`
   with `label: <uBotName>` and `packages: [<Name>]`, and write the feature, settings and faq pages
   (stubs first, see "Stub pages"). `npm run check` warns while a released plugin still has a placeholder.
4. Engine nodes from an engine plugin the pages need: `data/engine-nodes/<area>.txt`, then an export.
5. `npm test`, `npm run check`, `npm run build`.

## Versions

The site documents one version per package: the version of `data/api/<Package>.json`, shown on the
package page (文档版本) and in every class, struct and enum header. Data paths and URLs carry no version.
Multi-version docs, when needed, would come from a version plugin such as starlight-versions, which
copies the docs of a release into a versioned folder and keeps the current docs at today's URLs.
Prepare for it by never putting a version into a URL, a file name or a link (`/reference/ubotsensor/`,
not `/reference/ubotsensor-0.1/`); write version-specific facts as text ("从 0.2 起").

## Do not

- edit or commit `src/content/docs/reference/`, `dist/`, `.astro/` or `node_modules/`;
- add web fonts, CDNs or other runtime requests to third-party hosts (readers may be in mainland China);
- add a page without a description or a `pageKind`, a feature page without a graph (unless `graph: false`),
  or a page of a plugin manual without `packages`;
- show layers anywhere (sidebar groups, table columns, explanations): the `layer` of the index is not for readers;
- list packages, plugin folders or versions in code (scripts, components, tests that mean "every
  package", "the released ones" or "the planned one"): read them from `lib/packages.mjs`; a test that
  needs a package that does not exist builds one with `packageKit()`. The one list is the colour
  palette of the dependency graph cards, which is decoration;
- write version numbers into URLs or file names under `src/content/docs/` and `data/`;
- add empty folders, or "coming soon" text outside the stubs and placeholder pages of the skeleton;
- put secrets or server details in the repository (deployment uses GitHub secrets, see deploy/README.md).
