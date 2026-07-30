# Agent 配置 Schema 系统设计

> 任务：`07-30-agent-config-schema`
> 前置：AgentPlugin 系统

---

## 1. Schema 定义

### 1.1 Claude Code Schema 示例

```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "model": {
      "type": "string",
      "enum": ["sonnet", "opus", "haiku"],
      "default": "sonnet",
      "description": "Default model"
    },
    "permissions": {
      "type": "object",
      "properties": {
        "allow": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Allowed tools"
        },
        "deny": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Denied tools"
        }
      }
    },
    "mcpServers": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "command": { "type": "string" },
          "args": { "type": "array", "items": { "type": "string" } },
          "env": { "type": "object" }
        },
        "required": ["command"]
      }
    }
  }
}
```

### 1.2 Schema 存储

- 存储在 `agent_plugins.configuration_json` 列（JSON Schema 字符串）
- 前端解析后生成表单
- 后端校验配置时加载

---

## 2. Schema 验证引擎

### 2.1 后端验证

```rust
pub fn validate_agent_config(
    schema: &serde_json::Value,
    config: &serde_json::Value,
) -> Result<(), Vec<ValidationError>> {
    // 使用 json-schema crate 验证
}
```

### 2.2 前端验证

- 使用 `ajv`（JSON Schema 验证器）
- 实时验证 + 提交前验证
- 错误消息中文化

---

## 3. Schema → UI 表单生成

### 3.1 组件结构

```
SchemaForm (根据 JSON Schema 自动生成)
├── SchemaFieldString     (string / enum)
├── SchemaFieldNumber     (number / integer)
├── SchemaFieldBoolean    (boolean)
├── SchemaFieldObject     (nested object)
├── SchemaFieldArray      (array of items)
└── SchemaFieldSecret     (password / token)
```

### 3.2 映射规则

| JSON Schema | UI 组件 |
|-------------|---------|
| `string` + `enum` | Select 下拉 |
| `string` | TextInput |
| `number` / `integer` | NumberInput |
| `boolean` | Checkbox / Switch |
| `object` | 嵌套 FieldSet |
| `array` | 动态列表 |
| `format: "password"` | PasswordInput |

---

## 4. 关键文件

| 文件 | 角色 |
|------|------|
| `src-tauri/src/agent/registry.rs` | 填充 12 个 Agent 的 schema |
| `src-tauri/src/agent/schema_validator.rs` | Schema 验证引擎（新） |
| `src/features/settings/components/SchemaForm.tsx` | Schema → UI 表单（新） |
| `src/features/settings/components/AgentsPanel.tsx` | 集成 Schema 表单 |
| `package.json` | 添加 `ajv` 依赖 |
