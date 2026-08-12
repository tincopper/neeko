# 业界最佳实践（Best Practices）

> 供 `neeko-check` 代码审核时对齐。本目录沉淀**业界通用**的 React / Rust 开发最佳实践与通用工程实践，与项目特有规范（`.trellis/spec/`）互补。

---

## 概述

本目录聚焦跨项目可复用的**业界共识**，与 `.trellis/spec/frontend/`、`.trellis/spec/backend/` 中的 **Neeko 特有约定**分离。涉及项目特有时，直接链接到对应 spec 文件，不在此重复定义。

---

## 指南索引

| 指南 | 说明 | 状态 |
|------|------|------|
| [React 最佳实践](./react.md) | 类型安全、组件边界、数据流、Hook 规范、渲染性能、key、受控组件 | 初始 |
| [Rust 最佳实践](./rust.md) | 错误处理、所有权与借用、命名与文档、并发、类型驱动 | 初始 |
| [通用工程实践](./general.md) | 可读性、魔法数字、DRY/KISS/YAGNI、无死代码 | 初始 |

---

## 如何使用

对于每个指南文件：

1. 记录**业界通用**的最佳实践（而非项目特有约定）
2. 包含**正确 / 错误示例**与禁止模式
3. 涉及项目特有时，链接到 `.trellis/spec/` 对应文件，不重复定义
4. 按需扩展：每个主题可拆分为独立文件，保证覆盖面

目标是让 `neeko-check` 审核时能通过索引快速定位到具体规范。

---

**语言**：所有文档以**中文**编写。

---

## 相关主题

| 主题 | 说明 |
|------|------|
| [前端开发](../.trellis/spec/frontend/index.md) | React/TypeScript 前端指南（Neeko 特有） |
| [后端开发](../.trellis/spec/backend/index.md) | Rust/Tauri 后端指南（Neeko 特有） |
| [安全配置](../.trellis/spec/security/index.md) | Tauri v2 权限配置 |
| [单元测试](../.trellis/spec/unit-test/index.md) | 前后端测试指南 |
