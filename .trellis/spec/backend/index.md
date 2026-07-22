# 后端开发指南

> 本项目 Rust/Tauri 后端开发的最佳实践。

---

## 概述

后端是一个基于 **Tauri v2** 的应用，使用 **Rust**（2021 版）编写。它提供终端管理（PTY）、Git 操作、SSH 连接和会话持久化功能——全部通过 Tauri IPC 命令暴露给 React 前端。

---

## 指南索引

| 指南 | 说明 | 状态 |
|------|------|------|
| [目录结构](./directory-structure.md) | 模块布局与文件组织 | 已填写 |
| [命令指南](./command-guidelines.md) | Tauri 命令模式、状态访问、错误返回 | 已填写 |
| [类型安全](./type-safety.md) | 结构体、枚举、serde、Rust-TS 类型同步 | 已填写 |
| [错误处理](./error-handling.md) | anyhow、Result 模式、命令边界 | 已填写 |
| [并发指南](./concurrency-guidelines.md) | 线程、Mutex、tokio、PTY/SSH I/O | 已填写 |
| [质量指南](./quality-guidelines.md) | 代码风格、命名、平台特定代码 | 已填写 |
| [会话适配器](./conversation-adapter.md) | Agent 会话管理、适配器模式、Tauri 命令 | 已填写 |
| [窗口生命周期](./window-lifecycle.md) | 窗口关闭、Cmd+W 快捷键、跨平台事件交互 | 已填写 |
| [项目 Skill 同步](./project-skill-sync.md) | Project Tag Group、target Agent、项目本地部署与解绑契约 | 已填写 |

---

## 如何使用这些指南

对于每个指南文件：

1. 记录项目**实际使用的约定**（而非理想状态）
2. 包含来自代码库的**代码示例**
3. 列出**禁止模式**及原因
4. 添加团队踩过的**常见坑**

目标是帮助 AI 助手和新团队成员理解本项目的运作方式。

---

**语言**：所有文档以**中文**编写。

---

## 相关主题

| 主题 | 说明 |
|------|------|
| [安全配置](../security/index.md) | Tauri v2 权限配置 |
| [前端开发](../frontend/index.md) | React/TypeScript 前端指南 |
