<picture>
  <source media="(prefers-color-scheme: dark)" srcset="src/assets/ubot-mark-light.svg">
  <img alt="uBot" src="src/assets/ubot-mark-dark.svg" height="72">
</picture>

# uBot 文档

uBot 插件的中文文档站，基于 Astro Starlight。蓝图示例以 UE 编辑器的样式绘制，参考页面由插件的反射数据自动生成。

有哪些插件由 `data/index.json`（uBot 包索引的副本）决定：参考页面、侧边栏、搜索的插件过滤和检查都从它读取。新增插件只需要数据和页面，不需要改代码，步骤见下面的“新增一个 uBot 插件”。

## 本地开发

需要 Node.js 24（见 `.nvmrc`）。

```bash
npm ci            # 依赖从 npm 官方源安装；想走镜像时：npm ci --registry=https://registry.npmmirror.com
npm run dev        # http://localhost:4321
npm test           # 单元测试
npm run check      # 检查 API 数据、中文摘要、蓝图代码块和写作规范
npm run build      # 构建到 dist/，同时生成搜索索引并校验站内链接
```

写页面的规则（目录、frontmatter、`blueprint` 代码块语法、写作规范）见 [CLAUDE.md](CLAUDE.md)。

## 数据从哪里来

| 路径 | 内容 | 怎么更新 |
| --- | --- | --- |
| `data/index.json` | uBot 包索引（格式 2）：插件、层级、版本、依赖 | `npm run sync-index`，逐字节复制 uBotCore 的 `Index/index.json` |
| `data/api/<插件>.json` | 类、节点、属性、结构体、枚举（格式 1） | `npm run sync-api -- --from-github`，或在装有 UE 5.5 的 Windows 上运行 `scripts/export-api.ps1` |
| `data/engine-nodes/<领域>.txt` | 文档用到的 UE 引擎节点清单（`core.txt` 等） | 手工维护，导出时合并写入 `data/api/engine.json` |
| `data/zh/<插件>/<类名>.yaml` | 中文摘要，每个类、结构体、枚举一个文件 | 手工维护，`npm run zh -- todo <插件或类名>` 列出缺的条目 |
| `src/content/docs/reference/` | 参考页面 | `npm run dev` / `npm run build` 前自动生成，不提交 |

`export-api.ps1` 从 `data/index.json` 读取已发布的插件，先检查 DevHost 工程是否启用了这些插件和所需的引擎插件（缺什么就打印要加的内容），再对每个插件运行两次 `UBotDocExport` commandlet（`zh-Hans` 和 `en`，合并中文标题），结果写到插件仓库的 `docs/api.json`，再由 `scripts/sync-api.mjs` 复制到 `data/api/`；`data/engine-nodes/*.txt` 合并成一份清单后同样导出两次，写入 `data/api/engine.json`。

插件仓库提交了 `docs/api.json` 之后，不需要 UE 也能更新：`npm run sync-api -- --from-github` 按各插件最新发布的 tag 下载（tag 里没有时改用默认分支并说明），`npm run sync-api` 则从 `vendor/` 子模块复制。工作流 `sync-packages.yml` 每天自动做这件事，测试、检查、构建通过后在 `bot/sync-packages` 分支上开或更新一个 PR；数据没变时不推送，分支上有人提交的修改不会被覆盖。

`data/api/` 里的文件都由导出器生成，不要手改；`"generator"` 不是 `UBotDocExport <n>` 的文件会让 `npm run check` 给出警告。

## 新增一个 uBot 插件

插件仓库：

1. 在 DevHost 工程（`UBotDev.uproject`）里启用插件（`"Enabled": true`，或经 `AdditionalPluginDirectories` 找到），以及它需要的引擎插件。
2. 在插件的 `.gitattributes` 里加一行 `docs/api.json text eol=lf`。
3. 在本仓库运行 `scripts/export-api.ps1 -Plugins <插件名>`，打 tag 发布之前提交插件的 `docs/api.json`。

包索引（uBotCore 的 `Index/index.json`）：加上插件条目，写好 `layer`、`description`（`en`、`zh-CN`）、`repository`、`versions`（`ref` 为 tag）、`requires`、`enginePlugins`、`provides`。

文档仓库：

1. `npm run sync-index`，然后 `npm run add-package -- <插件名>`：建 `data/zh/<插件名>/`、加 `vendor/` 子模块（只用来读插件源码，构建不需要，`--no-submodule` 可跳过），并列出剩下的步骤。
2. `npm run sync-api -- --from-github --package <插件名>`（或等同步工作流的 PR）得到 `data/api/<插件名>.json`。
3. 指南放在 `src/content/docs/guides/<主题>/`，目录里的 `_group.yml` 写 `label:` 和 `packages: [<插件名>]`。
4. 页面要用引擎插件的节点时，写进 `data/engine-nodes/<领域>.txt` 再导出一次。
5. `npm test`、`npm run check`、`npm run build` 全部通过。

参考页面（`/reference/<插件名小写>/`）、侧边栏分组、节点索引和搜索过滤都会自动出现。规划中的插件只出现在参考概览页的“规划中”表格里。

新增插件只改数据和页面，不改代码和测试：`npm test` 里的 `test/new-package.test.mjs` 会在仓库副本里模拟一次发布（让一个规划中的插件发布，再加一个新插件），副本必须通过全部测试、检查和参考页面生成。

## 部署

`main` 分支的每次推送都会构建并通过 SSH 部署到自己的服务器，服务器的准备步骤见 [deploy/README.md](deploy/README.md)。
