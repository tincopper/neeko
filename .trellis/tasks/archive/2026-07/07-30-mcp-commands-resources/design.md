# MCP 与 Commands 资源管理技术设计

> 任务：`07-30-mcp-commands-resources`
> 前置：AgentPlugin 系统（`07-30-agent-plugin-system`）

---

## 1. 核心思路

**资源通过 AgentPlugin 路径部署**：

```
MCP Server 创建 → 选择目标 Agent → AgentPlugin.paths.mcp 解析路径 → 写入配置文件
Command 创建  → 选择目标 Agent → AgentPlugin.paths.commands 解析路径 → 写入文件
```

---

## 2. MCP 服务器管理

### 2.1 数据模型

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  command TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '[]',
  env_json TEXT NOT NULL DEFAULT '{}',
  transport TEXT NOT NULL DEFAULT 'stdio',  -- 'stdio' | 'sse'
  scope TEXT NOT NULL DEFAULT 'global',     -- 'global' | 'project'
  project_id TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 2.2 部署机制

不同 Agent 的 MCP 配置格式：

| Agent | 配置路径 | 格式 | 写入方式 |
|-------|----------|------|----------|
| Claude Code | `~/.claude/settings.json` | JSON | 合并到 `mcpServers` |
| Cursor | `~/.cursor/settings.json` | JSON | 合并到 `mcpServers` |
| Codex | `~/.codex/config.toml` | TOML | 合并到 `[mcp]` |
| 其他 | 环境变量 | JSON | 序列化为 `MCP_SERVERS` |

部署流程：
```
1. 读取 AgentPlugin.paths.mcp → 解析实际路径
2. 读取现有配置（JSON/TOML）
3. 合并新的 MCP server 定义
4. 写回配置文件
```

### 2.3 后端命令

```rust
#[tauri::command]
pub fn list_mcp_servers(scope: Option<String>) -> Result<Vec<McpServer>, AppError>

#[tauri::command]
pub fn save_mcp_server(server: McpServer) -> Result<McpServer, AppError>

#[tauri::command]
pub fn delete_mcp_server(id: String) -> Result<(), AppError>

#[tauri::command]
pub fn deploy_mcp_to_agent(mcp_id: String, agent_id: String) -> Result<(), AppError>

#[tauri::command]
pub fn test_mcp_connection(id: String) -> Result<bool, AppError>
```

---

## 3. Commands 管理

### 3.1 数据模型

复用现有 `prompts` 表，新增 `mcp_servers` 表独立管理。

Commands 与 Prompts 的关系：

| 维度 | Prompt | Command |
|------|--------|---------|
| 存储 | `prompts` 表 | `prompts` 表（kind='command'）或独立 |
| 内容 | 完整提示词 | 纯文本模板 |
| 触发 | `/xxx` → resolve_slash | 同上 |
| 部署 | 文件写入 | 写入 Agent commands 目录 |

**决策**：Commands 作为 `prompts` 表的 `kind='command'` 变体，复用存储和 slash 解析。

### 3.2 部署机制

```
Command 创建 → AgentPlugin.paths.commands 解析路径 → 写入 .md 文件
```

文件内容：
```markdown
---
description: Review code changes
---

Review the current branch against {{base}}. Focus on correctness.
```

### 3.3 Slash 解析扩展

扩展 `resolve_slash_prompt` → `resolve_slash_resource`：

```rust
pub fn resolve_slash_resource(
    slash: String,
    project_id: Option<String>,
) -> Option<SlasResource> {
    // 1. 查找 prompts（kind='prompt'）
    // 2. 查找 prompts（kind='command'）
    // 3. 项目级优先于全局
}
```

---

## 4. 统一资源部署器

```rust
// 基于 AgentPlugin 路径的资源部署
pub struct ResourceDeployer {
    path_resolver: PathResolver,
}

impl ResourceDeployer {
    /// 部署 MCP 到 Agent 配置
    pub fn deploy_mcp(
        &self,
        server: &McpServer,
        plugin: &AgentPlugin,
        project_path: Option<&Path>,
    ) -> Result<(), AppError>;

    /// 部署 Command 到 Agent commands 目录
    pub fn deploy_command(
        &self,
        command: &PromptRecord,  // kind='command'
        plugin: &AgentPlugin,
        project_path: Option<&Path>,
    ) -> Result<(), AppError>;

    /// 读取 Agent 当前配置的 MCP 列表
    pub fn list_deployed_mcp(
        &self,
        plugin: &AgentPlugin,
        project_path: Option<&Path>,
    ) -> Result<Vec<McpServer>, AppError>;
}
```

---

## 5. Library 集成

### 5.1 Tab 结构

```
Library
├── Skills       ← 现有
├── Prompts      ← 现有
├── Actions      ← 现有
├── MCP          ← 新增
└── Commands     ← 新增
```

### 5.2 Agent 分组视图

增加"按 Agent 分组"的视图模式：

```
Library (Agent 分组视图)
├── Claude Code
│   ├── Skills (3)
│   ├── Commands (2)
│   └── MCP (1)
├── Cursor
│   ├── Skills (1)
│   └── MCP (2)
└── ...
```

---

## 6. 关键文件

| 文件 | 角色 |
|------|------|
| `src/shared/types/mcpServer.ts` | MCP 类型 |
| `src-tauri/src/skill/migrations.rs` | mcp_servers 表 |
| `src-tauri/src/skill/commands.rs` | MCP/Command CRUD + deploy 命令 |
| `src-tauri/src/skill/repository.rs` | mcp_servers CRUD |
| `src-tauri/src/agent/resource_deployer.rs` | 统一资源部署器 |
| `src/features/library/components/McpListSection.tsx` | MCP 列表 |
| `src/features/library/components/McpEditorDialog.tsx` | MCP 编辑器 |
| `src/features/library/components/CommandListSection.tsx` | Command 列表 |
| `src/features/library/components/CommandEditorDialog.tsx` | Command 编辑器 |
| `src/features/library/store/libraryStore.ts` | 扩展 MCP/Commands 状态 |

---

## 7. 与 AgentPlugin 关系

```
AgentPlugin.paths.mcp      → MCP 部署路径
AgentPlugin.paths.commands → Command 部署路径
AgentPlugin.id             → 资源关联的 agent_id
```

**核心原则**：不硬编码任何路径，全部通过 AgentPlugin 解析。

---

## 8. 开放问题

1. MCP 配置写入是合并还是覆盖？ → 合并（保留用户手动添加的）
2. Command 是否独立建表？ → 复用 prompts 表，kind='command'
3. 部署状态是否持久化？ → 是，记录在资源表的 `deployed_to` 字段
