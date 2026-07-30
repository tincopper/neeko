# MCP 与 Commands 资源管理 · 执行计划

> 任务：`07-30-mcp-commands-resources`
> 前置：`prd.md` + `design.md`

---

## 阶段划分

### Step 1 — MCP 服务器管理

- [ ] 1.1 `src/shared/types/mcpServer.ts` — McpServer 类型
- [ ] 1.2 `mcp_servers` 表 migration
- [ ] 1.3 MCP CRUD 命令
- [ ] 1.4 MCP 部署（通过 AgentPlugin.paths.mcp）
- [ ] 1.5 MCP 连接测试
- [ ] 1.6 Library MCP Tab + 编辑器

### Step 2 — Commands 管理

- [ ] 2.1 Prompts 表增加 `kind` 字段（'prompt' | 'command'）
- [ ] 2.2 Command CRUD（复用 prompts 命令，按 kind 过滤）
- [ ] 2.3 Command 部署（通过 AgentPlugin.paths.commands）
- [ ] 2.4 `resolve_slash_resource` 扩展
- [ ] 2.5 Library Commands Tab + 编辑器

### Step 3 — 统一部署器

- [ ] 3.1 `resource_deployer.rs` — ResourceDeployer
- [ ] 3.2 支持 MCP + Command + Skill 统一部署
- [ ] 3.3 部署状态追踪

### Step 4 — Library 集成

- [ ] 4.1 Library 增加 MCP/Commands Tab
- [ ] 4.2 Agent 分组视图
- [ ] 4.3 统一搜索

---

## Review Gates

- 每步结束：`pnpm type-check` + `cargo check` 通过
- 全量结束：`pnpm lint:fe` + `cargo test` 全绿

## 关键文件

| 文件 | 角色 |
|------|------|
| `src/shared/types/mcpServer.ts` | MCP 类型 |
| `src-tauri/src/skill/migrations.rs` | mcp_servers 表 |
| `src-tauri/src/skill/commands.rs` | MCP CRUD + deploy |
| `src-tauri/src/skill/repository.rs` | mcp_servers CRUD |
| `src-tauri/src/agent/resource_deployer.rs` | 统一部署器 |
| `src/features/library/components/McpListSection.tsx` | MCP 列表 |
| `src/features/library/components/McpEditorDialog.tsx` | MCP 编辑器 |
| `src/features/library/components/CommandListSection.tsx` | Command 列表 |
| `src/features/library/components/CommandEditorDialog.tsx` | Command 编辑器 |
