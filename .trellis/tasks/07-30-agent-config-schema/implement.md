# Agent 配置 Schema · 执行计划

> 任务：`07-30-agent-config-schema`

---

## 步骤

### Step 1 — Schema 定义

- [ ] 为 12 个内置 Agent 在 registry.rs 中定义完整 JSON Schema
- [ ] 包含：model, permissions, mcpServers, env 等字段

### Step 2 — Schema 验证引擎

- [ ] 后端 `schema_validator.rs`（json-schema crate）
- [ ] 前端 `ajv` 验证
- [ ] 错误精确定位

### Step 3 — Schema → UI 表单

- [ ] `SchemaForm.tsx` 自动生成组件
- [ ] 支持 string/number/boolean/object/array/enum
- [ ] 字段描述 + 验证错误展示

### Step 4 — Settings 集成

- [ ] AgentsPanel 展示 Schema 生成的表单
- [ ] 配置保存验证
- [ ] 项目级覆盖

---

## 关键文件

| 文件 | 角色 |
|------|------|
| `src-tauri/src/agent/registry.rs` | 填充 schema |
| `src-tauri/src/agent/schema_validator.rs` | 验证引擎 |
| `src/features/settings/components/SchemaForm.tsx` | 表单生成 |
| `src/features/settings/components/AgentsPanel.tsx` | 集成 |
