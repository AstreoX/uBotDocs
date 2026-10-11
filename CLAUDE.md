# uBot docs: instructions for Claude Code

This repository is the documentation site for the uBot Unreal Engine 5.5 plugins ("packages": today
UBotCore, UBotSensor and UBotROS, more to come). It is an Astro 7 + Starlight site, written in
Simplified Chinese. Most changes come from Claude Code cloud sessions: one GitHub issue describes one
page, one session writes it and opens one PR.

Which packages exist is data, not code: `data/index.json` (a copy of the uBot package index) drives
the reference, the sidebar, the search filter and the checks. Never write a list of packages into a
script or a component; ask `lib/packages.mjs` (see "Packages" below).

## Commands

```bash
npm ci            # install (exact versions from package-lock.json, resolved from registry.npmjs.org)
npm test          # unit tests (node:test): graph parser, layout, checks, reference, and a simulated package release
npm run check     # validates data/index.json, data/api, data/zh, every ```blueprint block, the packages
                  # pages declare and the writing rules
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
  start/                    开始: introduction, install, first sensor
  guides/<topic>/           指南: one task per page (sensors/, ros/, manager/, ...)
  concepts/                 概念: mechanisms worth understanding once
  reference/                参考: GENERATED from data/, git-ignored. Never edit, never commit.
data/index.json             the uBot package index (byte copy of uBotCore's Index/index.json, format 2)
data/api/<Package>.json     API description exported from UE (format 1), one file per package + engine.json
data/zh/<Package>/<Owner>.yaml  Chinese summaries, one file per class, struct or enum (engine: data/zh/Engine/)
data/engine-nodes/<area>.txt    UE engine nodes the exporter writes into data/api/engine.json (core.txt, ...)
lib/packages.mjs            the package registry: every package list comes from here
lib/semver.mjs              versions and ranges (the grammar of uBotCore's UBotSemVer)
lib/content-packages.mjs    which packages a page declares (frontmatter or folder default)
lib/reference/              reference generator: package framework (index.mjs) and providers (blueprint.mjs)
lib/blueprint/              graph parser, validator, layout and HTML renderer (shared by all tools)
lib/engine-nodes.mjs        engine node lists: check, merge
src/plugins/blueprint.mjs   Markdown plugin: ```blueprint block -> graph HTML
src/components/PageTitle.astro  the "需要：…" line under the title and the search's package filter
src/scripts/blueprint.js    client: wires, node cards, full-screen view, node index filter
src/scripts/scrollables.js  client: tab stop and scroll hint for tables and diagrams that scroll sideways
scripts/                    gen-reference, check, sync-index, sync-api, sync-branch, add-package, export-api.ps1 (Windows + UE only), zh, find-node
vendor/<folder>/            plugin repositories as git submodules, for reading source only
deploy/                     server setup (nginx, SSH gate), see deploy/README.md
```

The sidebar is generated from folders. Do not edit a central list to add a page:

- Order inside a group comes from `sidebar.order` in the frontmatter (use steps of 10).
- A new folder needs a `_group.yml` next to its pages: `label: 传感器` (the Chinese group name), and
  for a guide folder about one package `packages: [UBotSensor]` (the default for its pages).
- The 参考 section is built in `astro.config.mjs` from the package registry: 概览, 节点索引, 引擎节点,
  then one group per layer (基础, 能力, 适配, 内容) with a group per released package. A new package
  appears there by itself.
- Do not create empty folders or stub pages for future content.

## Writing a page

Frontmatter:

```yaml
---
title: 读取 IMU 姿态角
description: 一句话说明这一页解决什么问题（搜索结果和链接预览会用到）。
packages: [UBotSensor]      # optional when the folder's _group.yml sets it; "UBotSensor@^0.1" adds a range
sidebar:
  order: 20
---
```

`packages` names the uBot packages the page is about (names from `data/index.json`). The site shows
it as one line under the title ("需要：uBot Sensor 0.1+（含依赖 uBot Core）"), the search can be
filtered by it, and the package's reference page lists the page under 相关指南. A page's own list
replaces its folder's default. `npm run check`:

- fails when a guide declares no package (directly or through its folder);
- fails on unknown names, planned packages and ranges that match no released version;
- fails when a graph uses a node of a package that is neither declared nor a dependency (direct or
  transitive) of a declared one; engine nodes are always fine. A page that declares nothing (a concept
  or start page without `packages`) may use engine nodes only; the home page is exempt;
- warns when a declared package is not used by any graph of a page that has graphs.

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
warning) and add its path to a list in `data/engine-nodes/` in the same PR (`core.txt` for general
nodes; nodes of an engine plugin go into the file of their area, e.g. `vehicles.txt`), e.g.
`/Script/Engine.KismetMathLibrary:Add_VectorVector`, `event /Script/Engine.Actor:ReceiveEndPlay`,
`node /Script/BlueprintGraph.K2Node_DynamicCast`. The next local export picks it up; then replace the
inline node with its id.

## Generated reference and Chinese summaries

`src/content/docs/reference/` is regenerated from `data/` on every `npm run dev`/`build`
(`scripts/gen-reference.mjs`, see "Reference providers"). Never edit it and never commit it. URLs are
`/reference/<package in lower case>/...` and never contain the layer or a version.

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

- `list()` all packages, ordered by layer (Foundation 基础, Capability 能力, Adapter 适配, Content 内容),
  then by name; `released()` (a version without `planned: true`) and `planned()`;
- per package: `friendlyName`, `description()` (zh-CN, English fallback), `layer` and `layerLabel`,
  `latest` released version, `documentedVersion` (the version of `data/api/<Name>.json`, else the
  latest), `requires`/`enginePlugins`/`provides`/`prebuilt` of that version, `folder` (the index's
  `folder`, else the repository name: `uBotSensor`), `githubUrl`, `hasApi`, `path` (`/reference/<slug>/`);
- `dependencies(name)` (transitive, optional ones skipped), `closure(names)`, `releasedByLayer()`.

Released packages get a reference home page, a sidebar group and a search filter value; planned ones
only a row in the "规划中" table on `/reference/`.

## Reference providers (lib/reference/)

`lib/reference/index.mjs` is the framework: it writes the overview (`/reference/`, with the 规划中
table) and one home page per released package (description, layer, documented version, dependencies,
engine plugins, provides, prebuilt binaries, repository, 相关指南, then the providers' sections). Each
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
   `<package slug>/<something>/` (never a layer or version in the path); site-wide pages (an index of
   all topics) get a `sidebarLinks` entry.
3. Validate the data in `npm run check`, test the provider with a temporary data folder (see
   `test/extensibility.test.mjs`), and document the data file here.

## Adding a new uBot package

The docs need no code change for a new package, only data and pages: `data/index.json`,
`data/api/<Name>.json`, `data/engine-nodes/<area>.txt` if needed, `data/zh/<Name>/` and the guides.
`test/new-package.test.mjs` keeps that true: it copies the repository, releases a planned package and
adds a new one (data and a guide each), and the copy must pass the whole test suite, `npm run check`
without warnings and the generator. If it fails, a test or a file depends on today's list of packages;
fix that place to read `lib/packages.mjs` (tests: `repoPackages()` and `packageKit()` in
`test/helpers.mjs`). The sync bot releases packages by changing data only, so a red `npm test` there
means no PR.

Plugin repository:

1. Enable the plugin in the DevHost project (`UBotDev.uproject`: listed with `"Enabled": true`, or found
   through `AdditionalPluginDirectories`), and the engine plugins it needs.
2. Add `docs/api.json text eol=lf` to its `.gitattributes`.
3. Run `scripts/export-api.ps1 -Plugins <Name>` here (Windows, UE 5.5); it checks the project first and
   prints what to add. Commit the plugin's `docs/api.json` before tagging the release.

Index (uBotCore `Index/index.json`): the package entry with `layer`, `description` (`en`, `zh-CN`),
`repository`, `versions` (`ref` = the tag), `requires`, `enginePlugins`, `provides`.

Docs repository:

1. `npm run sync-index`, then `npm run add-package -- <Name>` (`data/zh/<Name>/`, and the `vendor/`
   submodule for reading the plugin's source, which the build does not need: `--no-submodule` skips it;
   it prints what is left).
2. `npm run sync-api -- --from-github --package <Name>` (or the sync workflow's PR) for `data/api/<Name>.json`.
3. Guides in `src/content/docs/guides/<topic>/` with a `_group.yml` that sets `label:` and
   `packages: [<Name>]`.
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
- add a page without a description, or a guide without a graph or without `packages`;
- list packages, plugin folders or versions in code (scripts, components, tests that mean "every
  package", "the released ones" or "the planned one"): read them from `lib/packages.mjs`; a test that
  needs a package that does not exist builds one with `packageKit()`;
- write version numbers into URLs or file names under `src/content/docs/` and `data/`;
- add empty folders, stub pages or "coming soon" content;
- put secrets or server details in the repository (deployment uses GitHub secrets, see deploy/README.md).
