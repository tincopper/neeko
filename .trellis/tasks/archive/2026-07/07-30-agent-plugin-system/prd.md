# Agent 插件系统

## Goal

设计并实现统一的 **Agent 插件**（Agent Plugin）抽象——一个描述 Agent 提供者的**完整契约**。通过声明式数据替代硬编码路径，从根本上解决 Agent 知识分散、扩展困难、能力不透明的问题。

对标业界最佳实践（Claude Code、Cursor、Codex、VS Code），让新增 Agent = 加一条定义，新增资源类型 = 扩展 capabilities 声明。

## Context

- Phase 1/2 已交付：Library 壳、Skills/Prompts/Actions 入库
- 现有 `tool_adapters.rs` 硬编码 Agent 目录路径，Agent 知识分散在三处
- 设计原则：**从根本上解决问题，对标业界最佳实践，而非仅满足当前需求**

## 核心理念

```
AgentPlugin = 一个 Agent 提供者的完整契约

它回答 5 个问题：
1. 如何执行？      → execution（command, args, env, detection）
2. 如何配置？      → configuration（schema + defaults + secrets）
3. 支持什么扩展？  → capabilities（mcp, commands, hooks, skills, plugins）
4. 资源存在哪？    → paths（模板化路径，支持变量）
5. 如何干预生命周期？ → lifecycle（hooks）
```

## Requirements

### 统一 Agent 插件接口

- [ ] 定义 `AgentPlugin` 类型：identity + execution + configuration + capabilities + paths + lifecycle
- [ ] 内置 10+ 主流 Agent 插件定义（Claude Code、Cursor、Codex、Gemini、Qoder、CodeBuddy、OpenCode、OMP、Pi、Reasonix、Grok）
- [ ] 支持自定义 Agent 插件（用户声明新的 Agent 提供者）
- [ ] Agent 插件的 CRUD（创建/读取/更新/删除自定义插件）
- [ ] 声明式 capabilities（每个 Agent 声明支持的资源类型）

### 路径解析引擎

- [ ] 模板变量：`{{home}}`、`{{projectPath}}`、`{{agentId}}`、`{{configDir}}`
- [ ] 全局 + 项目级路径解析
- [ ] Agent 安装检测
- [ ] 路径验证 + 目录确保

### 统一部署引擎

- [ ] 统一 `deploy(resource, plugin, target)` 接口
- [ ] 支持所有资源类型（skills, prompts, actions, mcp, commands）
- [ ] 替代现有 `tool_adapters.rs` 的部署逻辑
- [ ] 部署状态追踪

### 配置 Schema

- [ ] 每个 Agent 定义 `configuration.schema`（JSON Schema）
- [ ] Schema 用于配置验证
- [ ] Schema 自动生成 UI 表单
- [ ] 凭据（secrets）声明式管理

### ToolAdapter 替代

- [ ] `AgentPlugin` 完全替代 `tool_adapters.rs`
- [ ] 迁移 `scanner.rs`、`commands.rs`、`sync_engine.rs` 使用 AgentPlugin
- [ ] 删除 `tool_adapters.rs`
- [ ] 保持现有 Skills 部署功能不变

### UI 集成

- [ ] Settings → Agents 面板展示 Agent 插件详情
- [ ] Library 面板增加 Agent 分组视图
- [ ] 自定义 Agent 插件创建表单（schema 生成）
- [ ] Agent 安装检测展示

## Constraints

- 不破坏现有 Skills/Prompts/Actions 数据
- 现有功能（Skills 部署、slash 命令）保持可用
- 路径支持跨平台（macOS / Linux / Windows）
- 内置插件定义可扩展
- 遵循现有模式：zustand store, Tauri commands, SQLite 存储

## Acceptance Criteria

- [ ] 内置 10+ 主流 Agent 插件定义
- [ ] 可创建自定义 Agent 插件
- [ ] Agent 插件包含完整契约（execution + configuration + capabilities + paths）
- [ ] 路径解析引擎正确解析模板变量
- [ ] Agent 安装检测准确
- [ ] ToolAdapter 完全替代，现有 Skills 部署功能正常
- [ ] 统一部署引擎支持所有资源类型
- [ ] Settings → Agents 展示插件详情
- [ ] 844 前端测试 + Rust 测试通过
