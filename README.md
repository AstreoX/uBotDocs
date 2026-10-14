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

## uBot family

| Repository | What it is |
| --- | --- |
| [uBotCore](https://github.com/AstreoX/uBotCore) | Simulation clock, frame header, shared interfaces, package management |
| [uBotSensor](https://github.com/AstreoX/uBotSensor) | Pose, IMU, odometry, 2D/3D lidar, RGB and depth cameras |
| [uBotROS](https://github.com/AstreoX/uBotROS) | ROS 2 over a TCP bridge: sensors, TF, /clock, cmd_vel |
| [uBotAerial](https://github.com/AstreoX/uBotAerial) | Multirotor drones: simplified flight, rigid-body dynamics, wind |
| [uBotManager](https://github.com/AstreoX/uBotManager) | Desktop app and CLI to install, update and build uBot packages |
| **[uBotDocs](https://github.com/AstreoX/uBotDocs)** | **Documentation site: https://astreox.github.io/uBotDocs/** |
