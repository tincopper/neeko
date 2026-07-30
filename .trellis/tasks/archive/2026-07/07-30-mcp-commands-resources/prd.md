# MCP 与 Commands 资源管理

## Goal

基于 AgentPlugin 路径契约，实现 MCP 服务器和 Commands 的统一资源管理。通过 AgentPlugin.paths 解析各 Agent 的资源存储位置，实现资源的创建、部署、搜索、导入/导出。

## Context

- AgentPlugin 系统已就绪：12 个内置 Agent 定义 + 路径解析引擎 + 注册表
- AgentPlugin.paths 定义了各 Agent 的 MCP/Commands 配置路径和格式
- 现有 `prompts` 表的 slash 机制可复用为 Commands slash 解析
- 现有 `import/export bundle` 机制可扩展

## Requirements

### MCP 服务器管理

- [ ] MCP 资源模型：name, command, args, env, transport, scope, agent_id
- [ ] MCP 存储：复用 `skills.db` 新增 `mcp_servers` 表
- [ ] MCP CRUD：创建/读取/更新/删除
- [ ] MCP 部署：通过 AgentPlugin.paths 解析目标路径，写入 Agent 配置
- [ ] MCP 连接测试：启动 MCP server 验证可用性
- [ ] MCP UI：Library MCP tab（创建/编辑/部署/测试）
- [ ] MCP 导入/导出

### Commands 管理

- [ ] Command 资源模型：name, slash, content, variables, scope, agent_id
- [ ] Command 存储：复用 `prompts` 表或新增 `commands` 表
- [ ] Command CRUD
- [ ] Command 部署：通过 AgentPlugin.paths 写入 Agent commands 目录
- [ ] Command slash 触发：扩展 `resolve_slash_prompt` → `resolve_slash_resource`
- [ ] Command UI：Library Commands tab
- [ ] Command 导入/导出

### 统一资源部署

- [ ] 部署引擎基于 AgentPlugin.paths 解析实际路径
- [ ] 支持全局 + 项目级部署
- [ ] 部署状态追踪
- [ ] 冲突检测（同名资源）

### Library 集成

- [ ] Library 增加 MCP / Commands Tab
- [ ] Agent 分组视图：按 Agent 展示其挂载的资源
- [ ] 统一搜索（跨 Skills/Prompts/Actions/MCP/Commands）

## Constraints

- 通过 AgentPlugin 解析路径，不硬编码
- 不破坏现有 Skills/Prompts/Actions 数据
- MCP 部署格式兼容（JSON/TOML）
- Command slash 与 Prompt slash 共享解析
- 遵循现有模式

## Acceptance Criteria

- [ ] 可创建 MCP 服务器并部署到指定 Agent
- [ ] MCP 连接测试通过
- [ ] 可创建 Command 并在 Agent 输入框 `/` 触发
- [ ] 资源通过 AgentPlugin 路径正确解析
- [ ] Library MCP/Commands Tab 正常工作
- [ ] MCP/Commands 导入/导出
- [ ] 现有功能不受影响
- [ ] 测试全绿
