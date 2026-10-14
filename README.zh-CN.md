<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/assets/ubot-mark-light.svg">
    <img alt="uBot" src="src/assets/ubot-mark-dark.svg" height="72">
  </picture>
</p>
<h1 align="center">uBot 文档</h1>
<p align="center"><b>面向 Unreal Engine 5.5 的 uBot 插件家族文档站。</b></p>
<p align="center">
  <a href="https://github.com/AstreoX/uBotDocs/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/AstreoX/uBotDocs/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/AstreoX/uBotDocs/actions/workflows/pages.yml"><img alt="Pages" src="https://github.com/AstreoX/uBotDocs/actions/workflows/pages.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/AstreoX/uBotDocs/commits/main"><img alt="最近提交" src="https://img.shields.io/github/last-commit/AstreoX/uBotDocs"></a>
</p>
<p align="center">
  <img alt="Unreal Engine 5.5" src="https://img.shields.io/badge/Unreal%20Engine-5.5-0E1128?logo=unrealengine&logoColor=white">
  <img alt="Astro Starlight" src="https://img.shields.io/badge/Astro-Starlight-BC52EE?logo=astro&logoColor=white">
  <img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white">
  <img alt="文档语言：简体中文" src="https://img.shields.io/badge/%E6%96%87%E6%A1%A3-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-blue">
</p>
<p align="center">
  <a href="https://astreox.github.io/uBotDocs/">在线文档</a> ·
  <a href="https://github.com/AstreoX/uBotDocs/issues">问题反馈</a> ·
  <a href="https://github.com/users/AstreoX/projects/2">路线图</a>
</p>

[English](README.md) | **简体中文**

## 这是什么

这个仓库是 uBot 系列 Unreal Engine 5.5 插件的文档站源码，站点用简体中文写成，基于 Astro Starlight 构建。站里有各个插件的手册、由插件导出的数据生成的 API 参考，以及插件之间的依赖图。

- **文本写蓝图图。** 蓝图示例写成文本块，构建时画成 UE 风格的节点图。
- **自动生成的 API 参考。** 类、结构体、枚举和节点的参考页，由各插件导出的 `docs/api.json` 加中文摘要生成。
- **由包索引驱动。** 侧边栏、依赖图和搜索过滤都读取 uBot 包索引，新增插件只需要数据和页面，不需要改代码。
- **跟着插件走。** 每天自动检查包索引和导出的 API 数据，有变化就开一个 PR。

## 站内导航

| 栏目 | 内容 |
| --- | --- |
| [开始](https://astreox.github.io/uBotDocs/start/introduction/) | 简介、安装、五分钟上手、选择组合 |
| [核心概念](https://astreox.github.io/uBotDocs/concepts/frame-header/) | 帧头、仿真时钟、坐标系与单位、标识与命名、插件之间怎么对接 |
| 插件手册：[uBotCore](https://astreox.github.io/uBotDocs/core/) · [uBotSensor](https://astreox.github.io/uBotDocs/sensor/) · [uBotROS](https://astreox.github.io/uBotDocs/ros/) · [uBotAerial](https://astreox.github.io/uBotDocs/aerial/) | 每个插件一本手册，配有蓝图图 |
| [uBot Manager](https://astreox.github.io/uBotDocs/manager/) | 界面导览、安装更新和移除插件、组合方案、设置、`ubot` 命令行 |
| [API 参考](https://astreox.github.io/uBotDocs/reference/) | 类、结构体、枚举和节点，节点索引，引擎节点 |
| [开发者](https://astreox.github.io/uBotDocs/develop/cpp/) | 在 C++ 中使用传感器与接口、ROS 发布器、编写 Package、从旧插件迁移 |

## uBot 家族

| 仓库 | 说明 |
| --- | --- |
| [uBotCore](https://github.com/AstreoX/uBotCore) | 仿真时钟、帧头、共享接口、插件管理 |
| [uBotSensor](https://github.com/AstreoX/uBotSensor) | 位姿、IMU、里程计、2D/3D 激光雷达、RGB 与深度相机 |
| [uBotROS](https://github.com/AstreoX/uBotROS) | 通过 TCP 桥接入 ROS 2：传感器、TF、/clock、cmd_vel |
| [uBotAerial](https://github.com/AstreoX/uBotAerial) | 多旋翼无人机：简化飞行、刚体动力学、风 |
| [uBotManager](https://github.com/AstreoX/uBotManager) | 在 UE 工程里安装、更新、构建 uBot 包的桌面程序和命令行 |
| **[uBotDocs](https://github.com/AstreoX/uBotDocs)** | **文档站：https://astreox.github.io/uBotDocs/** |
