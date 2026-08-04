# MCP 管理原型设计

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Neeko MCP 管理中心                       │
│                                                             │
│  ┌──────────────┐  ┌──────────────────────────────────────┐ │
│  │  左侧导航栏   │  │           内容区                     │ │
│  │              │  │                                      │ │
│  │  ● Installed │  │  ┌─── Installed 视图 ──────────────┐ │ │
│  │  ○ Marketpl. │  │  │ 搜索栏 + 排序 + 视图切换        │ │ │
│  │              │  │  │ ┌─┐ ┌─┐ ┌─┐ ┌─┐               │ │ │
│  │  ▼ Tags      │  │  │ │M│ │M│ │M│ │M│ 卡片网格      │ │ │
│  │    ├ Backend │  │  │ └─┘ └─┘ └─┘ └─┘               │ │ │
│  │    ├ Frontend│  │  │  每张卡片:                      │ │ │
│  │    └ ...     │  │  │  - 名称 + 下拉菜单(Test/Edit/  │ │ │
│  │              │  │  │    Deploy/Delete)               │ │ │
│  │  ▼ Agents    │  │  │  - 描述                         │ │ │
│  │    ├ codex   │  │  │  - transport 标签 + URL/command │ │ │
│  │    ├ gemini  │  │  │  - tags + 部署状态              │ │ │
│  │    └ ...     │  │  └────────────────────────────────┘ │ │
│  │              │  │                                      │ │
│  │  ▼ Projects  │  │  ┌─── Agent 视图 ──────────────────┐ │ │
│  │    ├ proj-1  │  │  │  Agent 名称 + 返回按钮          │ │ │
│  │    ├ proj-2  │  │  │  ┌─ 已部署的 MCP 列表 ────────┐ │ │ │
│  │    └ ...     │  │  │  │ · filesystem (stdio)        │ │ │ │
│  │              │  │  │  │ · remote-api (http)         │ │ │ │
│  │              │  │  │  │   [Remove] [Undeploy]       │ │ │ │
│  │              │  │  │  └────────────────────────────┘ │ │ │
│  │              │  │  │  ┌─ 可部署的 MCP 列表 ─────────┐ │ │ │
│  │              │  │  │  │ 从库中选择部署到该 Agent    │ │ │ │
│  │              │  │  │  └────────────────────────────┘ │ │ │
│  │              │  │  └────────────────────────────────┘ │ │ │
│  │              │  │                                      │ │
│  │              │  │  ┌─── Project 视图 ────────────────┐ │ │
│  │              │  │  │  Project 名称 + 返回按钮        │ │ │
│  │              │  │  │  [绑定 Tag Group] [应用全部]    │ │ │
│  │              │  │  │  ┌─ 已绑定的 Tag Groups ──────┐ │ │ │
│  │              │  │  │  │ · Backend (5 servers)      │ │ │ │
│  │              │  │  │  │ · Frontend (3 servers)     │ │ │ │
│  │              │  │  │  │   [Unbind]                 │ │ │ │
│  │              │  │  │  └────────────────────────────┘ │ │ │
│  │              │  │  │  ┌─ 项目级 Agent 部署状态 ────┐ │ │ │
│  │              │  │  │  │ codex: 3 servers deployed  │ │ │ │
│  │              │  │  │  │ cursor: 2 servers deployed │ │ │ │
│  │              │  │  │  └────────────────────────────┘ │ │ │
│  │              │  │  └────────────────────────────────┘ │ │ │
│  └──────────────┘  └──────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 关键交互流程

### 1. 部署 MCP 到 Agent（全局）

```
用户操作:
  1. 在 Installed 卡片点击 "Deploy"（下拉菜单）
  2. 弹出对话框，选择目标 Agent（多选）
  3. 选择部署范围（Global / Project）
  4. 点击 "Deploy"
  
后端流程:
  deploy_mcp_to_agent(mcp_id, agent_id, project_path)
    → ResourceDeployer::deploy_mcp(server, agent_id, project_path)
    → skill_store.insert_mcp_server_target(target_record)
```

### 2. 绑定项目 Tag Group

```
用户操作:
  1. 点击左侧 Projects 下的项目
  2. 点击 "Bind Tag Group" 按钮
  3. 弹出对话框，选择 Tag Groups（多选）
  4. 点击 "Apply"
  
后端流程:
  set_project_mcp_tag_groups(project_id, tag_group_ids)
    → repository 原子替换 project_mcp_tag_groups
  apply_project_mcp_servers(project_id, project_path)
    → 遍历 Tag Groups → 遍历 servers → 部署到项目 Agent
```

### 3. 查看 Agent 已部署的 MCP

```
用户操作:
  1. 点击左侧 Agents 下的某个 Agent
  2. 内容区显示: 已部署列表 + 可部署列表
  
数据获取:
  list_deployed_mcp(agent_id, project_path) → 从磁盘读取已部署的
  get_mcp_server_targets(server_id) → 从 DB 读取部署记录
  mcpServers (全部) → 过滤出未部署的
```

## 新增组件清单

| 组件 | 用途 | 对标 Skills |
|------|------|------------|
| `McpDeployDialog` | 选择 Agent + 范围，部署 MCP 服务器 | `ImportToAgentDialog` |
| `McpAgentContent` | Agent 视图：已部署/可部署列表 | `AgentSkillContent` |
| `McpProjectContent` | Project 视图：绑定 Tag Groups + 部署状态 | `ProjectSkillContent` |
| `McpBindTagGroupsDialog` | 绑定 Tag Groups 到 Project | `BindTagGroupsDialog` |

## 数据流

```
Marketplace
  → fetchMcpRegistryServer → McpRegistryGeneratedConfig
  → McpInstallDialog → createMcpServer → McpServerRecord (DB)
  
McpServerRecord (DB)
  → deploy_mcp_to_agent → ResourceDeployer → Agent 配置文件
  → insert_mcp_server_target → McpServerTargetRecord (DB)
  → add_server_to_mcp_tag_group → mcp_tag_group_servers (DB)
  
McpTagGroup
  → add_server_to_mcp_tag_group → 关联 server 到 tag group
  → set_project_mcp_tag_groups → 绑定 tag group 到 project
  → apply_project_mcp_servers → 批量部署到 project agents
```

## 当前状态

| 模块 | 后端 | 前端 | 说明 |
|------|------|------|------|
| 市场下载 | ✅ | ✅ | 已完成 |
| CRUD 管理 | ✅ | ✅ | 已完成 |
| Tag Group | ✅ | ✅ | 左侧导航 Tags 区域已完成 |
| Agent 视图 | ✅ | ⬜ | 占位文本，需填充 |
| Project 视图 | ✅ | ⬜ | 占位文本，需填充 |
| 部署到 Agent | ✅ | ⬜ | 需创建 DeployDialog + 按钮 |
| 项目绑定 | ✅ | ⬜ | 需创建 BindDialog + 按钮 |
| Agent MCP 支持 | ✅ | — | 已修复 9 个 shell Agent |