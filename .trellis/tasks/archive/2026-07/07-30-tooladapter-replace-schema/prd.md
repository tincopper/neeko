# ToolAdapter 完全替代 + Agent 配置 Schema

## Goal

完全移除 `tool_adapters.rs`，将所有 Agent 路径知识统一到 AgentPlugin 系统中。同时实现 Agent 配置的 JSON Schema 验证和 UI 生成，让每种 Agent 的配置可声明式管理。

## Context

- AgentPlugin 系统已就绪，但 `tool_adapters.rs` 仍存在（未被删除）
- 现有 `scanner.rs`、`sync_engine.rs`、`commands.rs` 部分代码仍依赖 ToolAdapter
- AgentPlugin.configuration.schema 已定义但未充分使用
- Agent 配置（如 Claude Code 的 settings.json）缺乏结构化验证

## Requirements

### ToolAdapter 完全替代

- [ ] 删除 `src-tauri/src/skill/tool_adapters.rs`
- [ ] 迁移 `scanner.rs` 完全使用 AgentPlugin 路径
- [ ] 迁移 `sync_engine.rs` 使用 ResourceDeployer
- [ ] 迁移 `commands.rs` 中所有 `default_tool_adapters()` / `expand_skill_path()` 调用
- [ ] 确保现有 Skills 部署/扫描功能完全正常
- [ ] 移除 `customToolAdapters` 设置（合并到 AgentPlugin 自定义插件）

### Agent 配置 Schema

- [ ] 为每个内置 Agent 定义完整的 `configuration.schema`（JSON Schema）
- [ ] Schema 验证引擎：运行时校验 Agent 配置
- [ ] Schema → UI 表单生成：Settings → Agents 面板自动生成配置表单
- [ ] 凭据（secrets）声明和验证
- [ ] 项目级配置覆盖全局配置

### 统一路径解析

- [ ] 所有路径解析通过 `PathResolver` + AgentPlugin.paths
- [ ] 无残留硬编码路径
- [ ] 跨平台兼容（macOS/Linux/Windows）

## Constraints

- 不破坏现有 Skills/Prompts/Actions/MCP/Commands 数据
- 现有功能（部署、扫描、slash）必须保持可用
- 删除 ToolAdapter 后所有测试必须通过
- Schema 遵循 JSON Schema Draft-7+

## Acceptance Criteria

- [ ] `tool_adapters.rs` 文件不存在
- [ ] 所有原 ToolAdapter 功能通过 AgentPlugin 实现
- [ ] Skills 部署/扫描功能正常（回归测试通过）
- [ ] 每个内置 Agent 有完整的 configuration.schema
- [ ] Schema 验证正确拒绝无效配置
- [ ] Settings → Agents 自动生成配置表单
- [ ] 844 前端测试 + Rust 测试全绿
