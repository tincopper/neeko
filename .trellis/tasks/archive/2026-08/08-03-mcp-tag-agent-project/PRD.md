# MCP Tags / Agents / Projects 管理 — 全量对标 Skills

## 目标

MCP Server 的 Tags / Agents / Projects 管理能力达到与 Skills 同等的粒度。

## 背景

Skills 有完整的 Tag Group 系统（`tag_groups` + `tag_group_skills` + `tag_group_skill_tools`）、Agent 部署追踪（`skill_targets`）、Project 绑定（`project_tag_groups` + `apply_project_skills`）。MCP 目前仅有 `tags_json`（轻量标签）、`scope`/`project_id`（项目作用域），没有 Tag Group、Agent 部署追踪、Project-TagGroup 绑定。

## 设计方案

### 数据模型

新增 5 张表，迁移 v10：

```sql
-- MCP Tag Groups（对标 tag_groups）
CREATE TABLE mcp_tag_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- MCP Tag Group ↔ Server 关联（对标 tag_group_skills）
CREATE TABLE mcp_tag_group_servers (
    tag_group_id TEXT NOT NULL REFERENCES mcp_tag_groups(id) ON DELETE CASCADE,
    server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    added_at INTEGER,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY(tag_group_id, server_id)
);

-- MCP Tag Group 内按 Agent 开关（对标 tag_group_skill_tools）
CREATE TABLE mcp_tag_group_server_agents (
    tag_group_id TEXT NOT NULL REFERENCES mcp_tag_groups(id) ON DELETE CASCADE,
    server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(tag_group_id, server_id, agent_id)
);

-- Project ↔ MCP Tag Group 绑定（对标 project_tag_groups）
CREATE TABLE project_mcp_tag_groups (
    project_id TEXT NOT NULL,
    tag_group_id TEXT NOT NULL REFERENCES mcp_tag_groups(id) ON DELETE CASCADE,
    added_at INTEGER NOT NULL,
    PRIMARY KEY(project_id, tag_group_id)
);

-- MCP Server 部署目标记录（对标 skill_targets）
CREATE TABLE mcp_server_targets (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    target_path TEXT NOT NULL,
    status TEXT DEFAULT 'ok',
    deployed_at INTEGER,
    last_error TEXT,
    UNIQUE(server_id, agent_id)
);
```

### Rust 后端

#### 新类型（`types.rs`）
- `McpTagGroupRecord` — 对标 `TagGroupRecord`
- `McpTagGroupDto` — 前端 DTO，含 `server_count`
- `McpServerTargetRecord` — 对标 `SkillTargetRecord`

#### 新 Repository 方法（`repository.rs`）
- `insert_mcp_tag_group` / `get_all_mcp_tag_groups` / `delete_mcp_tag_group` / `update_mcp_tag_group` / `reorder_mcp_tag_groups`
- `add_server_to_mcp_tag_group` / `remove_server_from_mcp_tag_group` / `get_servers_for_mcp_tag_group`
- `set_mcp_server_agent_toggle` / `get_mcp_tag_group_agent_toggles`
- `insert_project_mcp_tag_group` / `delete_project_mcp_tag_group` / `get_project_mcp_tag_groups` / `set_project_mcp_tag_groups`
- `insert_mcp_server_target` / `delete_mcp_server_target` / `get_mcp_server_targets`
- `get_all_project_mcp_tag_group_counts`

#### 新命令（`commands.rs`）
- `get_mcp_tag_groups` / `create_mcp_tag_group` / `delete_mcp_tag_group_cmd` / `update_mcp_tag_group_cmd` / `reorder_mcp_tag_groups_cmd`
- `add_server_to_mcp_tag_group_cmd` / `remove_server_from_mcp_tag_group_cmd` / `get_servers_for_mcp_tag_group_cmd`
- `set_mcp_server_agent_toggle_cmd`
- `get_project_mcp_tag_groups_cmd` / `set_project_mcp_tag_groups_cmd` / `add_project_mcp_tag_group_cmd` / `remove_project_mcp_tag_group_cmd`
- `apply_project_mcp_servers_cmd` — 将 project 绑定的 tag groups 的 MCP servers 部署到 project 本地 agent
- `deploy_mcp_server_to_agent_cmd` / `remove_mcp_server_from_agent_cmd` / `get_agent_mcp_servers_cmd`
- `get_all_project_mcp_tag_group_counts_cmd`

#### Docker 部署
- `agent/resource_deployer.rs` 已有 `deploy_mcp` / `remove_mcp` / `list_deployed_mcp`，可直接复用

### 前端

#### 新组件（`src/features/library/components/`）
- `McpTagGroupSection` — 左侧导航的 Tags 列表（对标 SkillsPanel 的 tag group 列表）
- `McpAssignTagGroupsDialog` — 安装后选择 Tag Group 的对话框
- `McpBindTagGroupsDialog` — 绑定 Tag Group 到 Project 的对话框
- `McpAgentView` — Agent 详情视图
- `McpProjectView` — Project 详情视图
- `McpImportToAgentDialog` — 导入到 Agent 的对话框
- `McpImportToProjectDialog` — 导入到 Project 的对话框

#### Store 扩展（`libraryStore.ts`）
- `mcpTagGroups` / `mcpTagGroupServers` / `mcpServerTargets` 状态
- `mcpActiveTagGroup` / `mcpAgentView` / `mcpProjectView` 视图状态
- CRUD actions

## 实施计划

### Phase 1: 数据模型 + Repository（约 2 小时）
- 迁移 v10：5 张新表
- repository.rs：CRUD 方法
- types.rs：新类型

### Phase 2: 后端 API（约 3 小时）
- commands.rs：20+ 新命令
- neeko_invoke_handler! 注册
- 测试

### Phase 3: 前端 UI（约 4 小时）
- 左侧导航 Tags 列表
- Tag Group 管理对话框
- Agent 视图 / Project 视图
- 导入/部署对话框

### Phase 4: 集成验证（约 1 小时）
- cargo test
- pnpm lint + lint:fe
- 手动验证

## 关联文件

- `src-tauri/src/skill/migrations.rs` — v10 迁移
- `src-tauri/src/skill/types.rs` — 新 DTO
- `src-tauri/src/skill/repository.rs` — 新 CRUD
- `src-tauri/src/skill/commands.rs` — 新命令
- `src-tauri/src/lib.rs` — 命令注册
- `src-tauri/src/agent/resource_deployer.rs` — 复用部署
- `src/features/library/store/libraryStore.ts` — 状态扩展
- `src/features/library/api/libraryApi.ts` — API 调用
- `src/features/library/components/` — 新 UI 组件
- `src/shared/types/` — 新 TS 类型