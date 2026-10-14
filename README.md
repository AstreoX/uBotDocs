<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/assets/ubot-mark-light.svg">
    <img alt="uBot" src="src/assets/ubot-mark-dark.svg" height="72">
  </picture>
</p>
<h1 align="center">uBot Docs</h1>
<p align="center"><b>The documentation site of the uBot plugin family for Unreal Engine 5.5.</b></p>
<p align="center">
  <a href="https://astreox.github.io/uBotDocs/">Live site</a> ·
  <a href="https://github.com/AstreoX/uBotDocs/issues">Issues</a> ·
  <a href="https://github.com/users/AstreoX/projects/2">Roadmap</a>
</p>

**English** | [简体中文](README.zh-CN.md)

## What it is

This repository is the source of the documentation site for the uBot plugins for Unreal Engine 5.5. The site is written in Simplified Chinese and built with Astro Starlight. It has a manual for each plugin, an API reference generated from the data the plugins export, and a dependency graph of the plugins.

- Blueprint examples are written as text blocks and drawn as Unreal-style node graphs at build time.
- Reference pages for classes, structs, enums and nodes are generated from each plugin's exported `docs/api.json` plus Chinese summaries.
- The sidebar, the dependency graph and the search filter read the uBot package index, so a new plugin needs data and pages, not code.
- A daily workflow opens a pull request when the package index or the exported API data change.

## Run it locally

Requires Node.js 24 (see `.nvmrc`).

```bash
npm ci          # install the exact versions from package-lock.json
npm run dev     # local server with live reload at http://localhost:4321
npm test        # unit tests
npm run check   # validate data, Chinese summaries, Blueprint blocks and writing rules
npm run build   # build dist/ with the search index and validate links
```

## How it is organized

| Path | Contents |
| --- | --- |
| `src/content/docs/` | The pages; its `reference/` folder is generated and not committed |
| `data/` | Package index, exported API data, Chinese summaries, engine node lists |
| `lib/` | Package registry, sidebar, reference generator, Blueprint graph renderer |
| `src/components/` | Astro components such as the package list and the dependency graph |
| `scripts/` | Checks, sync and onboarding commands; `export-api.ps1` needs Windows and UE 5.5 |
| `vendor/` | Plugin repositories as git submodules, for reading source only |

The full layout is in [CLAUDE.md](CLAUDE.md).

## Contributing

- Each page is written from one issue and sent as one pull request.
- Every pull request must pass `npm test`, `npm run check` and `npm run build`; CI runs the same three.
- Do not edit `src/content/docs/reference/` (generated) or `data/api/` (written by the exporter) by hand.
- [CLAUDE.md](CLAUDE.md) (in English) has the writing rules, page kinds and templates, Blueprint block syntax, and the steps for adding a new uBot package.

## Deployment

Every push to `main` runs the [Pages workflow](.github/workflows/pages.yml), which builds the site with `BASE_PATH=/uBotDocs` and publishes it to GitHub Pages.
The [deploy workflow](.github/workflows/deploy.yml) also uploads `main` to a self-hosted server over SSH when its secrets are set; see [deploy/README.md](deploy/README.md).

## uBot family

| Repository | What it is |
| --- | --- |
| [uBotCore](https://github.com/AstreoX/uBotCore) | Simulation clock, frame header, shared interfaces, package management |
| [uBotSensor](https://github.com/AstreoX/uBotSensor) | Pose, IMU, odometry, 2D/3D lidar, RGB and depth cameras |
| [uBotROS](https://github.com/AstreoX/uBotROS) | ROS 2 over a TCP bridge: sensors, TF, /clock, cmd_vel |
| [uBotAerial](https://github.com/AstreoX/uBotAerial) | Multirotor drones: simplified flight, rigid-body dynamics, wind |
| [uBotManager](https://github.com/AstreoX/uBotManager) | Desktop app and CLI to install, update and build uBot packages |
| **[uBotDocs](https://github.com/AstreoX/uBotDocs)** | **Documentation site: https://astreox.github.io/uBotDocs/** |
