<picture>
  <source media="(prefers-color-scheme: dark)" srcset="src/assets/ubot-mark-light.svg">
  <img alt="uBot" src="src/assets/ubot-mark-dark.svg" height="72">
</picture>

# uBot 文档

uBot 插件（UBotCore、UBotSensor、UBotROS）的中文文档站，基于 Astro Starlight。蓝图示例以 UE 编辑器的样式绘制，参考页面由插件的反射数据自动生成。

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
| `data/api/*.json` | 类、节点、属性、结构体、枚举（格式 1） | 在装有 UE 5.5 的 Windows 上运行 `scripts/export-api.ps1` |
| `data/engine-nodes.txt` | 文档用到的 UE 引擎节点清单 | 手工维护，导出时写入 `data/api/engine.json` |
| `data/zh/*.yaml` | 类和节点的中文摘要 | 手工维护，`npm run zh -- todo <插件>` 列出缺的条目 |
| `src/content/docs/reference/` | 参考页面 | `npm run dev` / `npm run build` 前自动生成，不提交 |

`export-api.ps1` 对每个插件运行两次 `UBotDocExport` commandlet（`zh-Hans` 和 `en`，合并中文标题），结果写到插件仓库的 `docs/api.json`，再由 `scripts/sync-api.mjs` 复制到 `data/api/`；`data/engine-nodes.txt` 里的引擎节点同样导出两次，写入 `data/api/engine.json`。只有插件仓库已经提交了 `docs/api.json` 时，也可以 `git submodule update --init --depth 1` 后运行 `npm run sync-api`。

`data/api/` 里的文件都由导出器生成，不要手改；`"generator"` 不是 `UBotDocExport <n>` 的文件会让 `npm run check` 给出警告。

## 部署

`main` 分支的每次推送都会构建并通过 SSH 部署到自己的服务器，服务器的准备步骤见 [deploy/README.md](deploy/README.md)。
