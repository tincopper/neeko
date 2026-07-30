# Agent 配置 Schema 系统

## Goal

为每个内置 Agent 定义完整的 JSON Schema（`AgentPlugin.configuration.schema`），实现配置的声明式验证和 UI 表单自动生成。让 Agent 配置可验证、可文档化、可自动生成表单。

## Context

- AgentPlugin 系统已就绪，`configuration.schema` 字段已定义但未填充
- 现有 Agent 配置（如 Claude Code settings.json）缺乏结构化验证
- Settings → Agents 面板需要从 Schema 自动生成配置表单

## Requirements

### Schema 定义

- [ ] 为 12 个内置 Agent 定义完整的 `configuration.schema`（JSON Schema Draft-07）
- [ ] Schema 包含：字段类型、默认值、枚举约束、描述
- [ ] 支持嵌套对象（如 permissions、mcpServers）
- [ ] 支持条件验证（如 transport=sse 时需要 url 字段）

### Schema 验证

- [ ] 后端 Schema 验证引擎（运行时校验配置）
- [ ] 验证错误精确定位到字段路径
- [ ] 默认值自动填充

### Schema → UI 生成

- [ ] 前端 JSON Schema → React 表单自动生成
- [ ] 支持：string、number、boolean、enum、object、array
- [ ] 字段描述作为 tooltip/help text
- [ ] 验证错误实时展示

### Settings 集成

- [ ] Settings → Agents 面板展示 Schema 生成的配置表单
- [ ] 配置保存时验证
- [ ] 项目级配置覆盖全局

## Constraints

- JSON Schema Draft-07 标准
- 表单生成组件可复用
- 不破坏现有 Agent 配置数据
- 遵循现有模式

## Acceptance Criteria

- [ ] 12 个内置 Agent 有完整 schema
- [ ] Schema 验证正确拒绝无效配置
- [ ] Settings → Agents 自动生成配置表单
- [ ] 配置保存时通过 Schema 验证
- [ ] 测试全绿
