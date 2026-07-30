# ToolAdapter 完全替代 + Agent 配置 Schema 技术设计

> 任务：`07-30-tooladapter-replace-schema`
> 前置：AgentPlugin 系统 + MCP/Commands 资源管理

---

## 1. ToolAdapter 迁移映射

### 1.1 功能映射

| ToolAdapter 功能 | 迁移目标 |
|------------------|----------|
| `default_tool_adapters()` | `AgentPluginRegistry::builtins()` |
| `ToolAdapter.skills_dir()` | `PathResolver::resolve(&plugin.paths.skills)` |
| `ToolAdapter.is_installed()` | `PathResolver::is_installed(&plugin)` |
| `ToolAdapter.all_scan_dirs()` | `PathResolver::resolve_all(&plugin, "skills")` |
| `expand_skill_path()` | `PathResolver::resolve_str()` |
| `skill_targets_from_agents()` | 基于 AgentPlugin.paths 构建 |
| `CustomToolDef` | AgentPlugin 自定义插件（is_builtin=false） |

### 1.2 代码迁移

| 文件 | 当前依赖 | 迁移后 |
|------|----------|--------|
| `scanner.rs` | `ToolAdapter[]` | `AgentPlugin[]` + `PathResolver` |
| `sync_engine.rs` | `SkillTargetDir` | `ResourceDeployer` |
| `commands.rs:952-994` | `default_tool_adapters()` | `AgentPluginRegistry` + `PathResolver` |
| `commands.rs:491-500` | `customToolAdapters` | AgentPlugin 自定义 |
| `commands.rs:1489+` | `expand_skill_path()` | `PathResolver::resolve_str()` |

---

## 2. Agent 配置 Schema

### 2.1 Schema 定义示例（Claude Code）

```json
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
        "allow": { "type": "array", "items": { "type": "string" } },
        "deny": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

### 2.2 Schema 用途

| 用途 | 实现 |
|------|------|
| 配置验证 | 运行时校验 Agent 配置文件 |
| UI 生成 | Settings → Agents 自动生成表单 |
| 默认值 | 新 Agent 自动填充默认配置 |
| 文档 | Schema 即文档 |

### 2.3 Schema 存储

- 存储在 `agent_plugins.configuration_json` 列
- 前端解析 JSON Schema 生成表单
- 后端校验配置是否符合 Schema

---

## 3. 关键文件

| 文件 | 操作 |
|------|------|
| `src-tauri/src/skill/tool_adapters.rs` | **删除** |
| `src-tauri/src/skill/scanner.rs` | 迁移到 AgentPlugin |
| `src-tauri/src/skill/sync_engine.rs` | 迁移到 ResourceDeployer |
| `src-tauri/src/skill/commands.rs` | 移除所有 ToolAdapter 引用 |
| `src-tauri/src/agent/registry.rs` | 扩展（完整内置定义） |
| `src-tauri/src/agent/path_resolver.rs` | 扩展（resolve_all 等） |
| `src/features/settings/components/AgentsPanel.tsx` | Schema → UI 表单 |
