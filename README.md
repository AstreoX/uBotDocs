<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/assets/ubot-mark-light.svg">
    <img alt="uBot" src="src/assets/ubot-mark-dark.svg" height="72">
  </picture>
</p>
<h1 align="center">uBot Docs</h1>
<p align="center"><b>The documentation site of the uBot plugin family for Unreal Engine 5.5.</b></p>
<p align="center">
  <a href="https://github.com/AstreoX/uBotDocs/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/AstreoX/uBotDocs/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/AstreoX/uBotDocs/actions/workflows/pages.yml"><img alt="Pages" src="https://github.com/AstreoX/uBotDocs/actions/workflows/pages.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/AstreoX/uBotDocs/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/AstreoX/uBotDocs"></a>
</p>
<p align="center">
  <img alt="Unreal Engine 5.5" src="https://img.shields.io/badge/Unreal%20Engine-5.5-0E1128?logo=unrealengine&logoColor=white">
  <img alt="Astro Starlight" src="https://img.shields.io/badge/Astro-Starlight-BC52EE?logo=astro&logoColor=white">
  <img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white">
  <img alt="Docs language: Simplified Chinese" src="https://img.shields.io/badge/docs-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-blue">
</p>
<p align="center">
  <a href="https://astreox.github.io/uBotDocs/">Live site</a> ·
  <a href="https://github.com/AstreoX/uBotDocs/issues">Issues</a> ·
  <a href="https://github.com/users/AstreoX/projects/2">Roadmap</a>
</p>

**English** | [简体中文](README.zh-CN.md)

## What it is

This repository is the source of the documentation site for the uBot plugins for Unreal Engine 5.5. The site is written in Simplified Chinese and built with Astro Starlight. It has a manual for each plugin, an API reference generated from the data the plugins export, and a dependency graph of the plugins.

- **Blueprint graphs from text.** Examples are written as text blocks and drawn as Unreal-style node graphs at build time.
- **Generated API reference.** Pages for classes, structs, enums and nodes come from each plugin's exported `docs/api.json` plus Chinese summaries.
- **Driven by the package index.** The sidebar, the dependency graph and the search filter read the uBot package index, so a new plugin needs data and pages, not code.
- **In step with the plugins.** A daily workflow opens a pull request when the package index or the exported API data change.

## On the site

| Section | What you find |
| --- | --- |
| [Get started](https://astreox.github.io/uBotDocs/start/introduction/) | Introduction, installation, a five-minute quickstart, choosing a recipe |
| [Core concepts](https://astreox.github.io/uBotDocs/concepts/frame-header/) | Frame header, simulation clock, coordinates and units, identity, how plugins connect |
| Plugin manuals: [uBotCore](https://astreox.github.io/uBotDocs/core/) · [uBotSensor](https://astreox.github.io/uBotDocs/sensor/) · [uBotROS](https://astreox.github.io/uBotDocs/ros/) · [uBotAerial](https://astreox.github.io/uBotDocs/aerial/) | One manual per plugin, with Blueprint graphs |
| [uBot Manager](https://astreox.github.io/uBotDocs/manager/) | Interface tour, installing and updating packages, recipes, settings, the `ubot` command line |
| [API reference](https://astreox.github.io/uBotDocs/reference/) | Classes, structs, enums and nodes, a node index, engine nodes |
| [Developers](https://astreox.github.io/uBotDocs/develop/cpp/) | Sensors and interfaces from C++, ROS publishers, writing a package, migration |

## uBot family

| Repository | What it is |
| --- | --- |
| [uBotCore](https://github.com/AstreoX/uBotCore) | Simulation clock, frame header, shared interfaces, package management |
| [uBotSensor](https://github.com/AstreoX/uBotSensor) | Pose, IMU, odometry, 2D/3D lidar, RGB and depth cameras |
| [uBotROS](https://github.com/AstreoX/uBotROS) | ROS 2 over a TCP bridge: sensors, TF, /clock, cmd_vel |
| [uBotAerial](https://github.com/AstreoX/uBotAerial) | Multirotor drones: simplified flight, rigid-body dynamics, wind |
| [uBotManager](https://github.com/AstreoX/uBotManager) | Desktop app and CLI to install, update and build uBot packages |
| **[uBotDocs](https://github.com/AstreoX/uBotDocs)** | **Documentation site: https://astreox.github.io/uBotDocs/** |
