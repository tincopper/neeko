# Agent 插件系统 · 执行计划

> 任务：`07-30-agent-plugin-system`
> 前置：`prd.md` + `design.md`

---

## 阶段划分

### Step 1 — AgentPlugin 类型 + 内置定义 + 注册表

- [ ] 1.1 `src/shared/types/agentPlugin.ts` — 完整类型定义
- [ ] 1.2 `src/shared/data/agentPluginPresets.ts` — 10+ 内置 Agent 定义
- [ ] 1.3 `src-tauri/src/agent/plugin.rs` — Rust AgentPlugin 类型
- [ ] 1.4 `src-tauri/src/agent/registry.rs` — 插件注册表（替代 `default_tool_adapters()`）
- [ ] 1.5 `plugins` 表 migration（v5→v6）

### Step 2 — 路径解析引擎

- [ ] 2.1 `src-tauri/src/agent/path_resolver.rs` — PathResolver
- [ ] 2.2 模板变量替换（`{{home}}`、`{{projectPath}}`）
- [ ] 2.3 Agent 安装检测
- [ ] 2.4 迁移 `expand_skill_path()` 从 `tool_adapters.rs`

### Step 3 — 统一部署引擎

- [ ] 3.1 `src-tauri/src/agent/deployer.rs` — ResourceDeployer trait
- [ ] 3.2 统一 `deploy()` / `remove()` / `list_deployed()` 接口
- [ ] 3.3 支持 Skills/Prompts/Actions/MCP/Commands 资源

### Step 4 — ToolAdapter 迁移 + 后端命令

- [ ] 4.1 `plugin_commands.rs` — list/get/save/delete/resolve/deploy/detect 命令
- [ ] 4.2 迁移 `scanner.rs` 使用 AgentPlugin
- [ ] 4.3 迁移 `commands.rs` deploy targets 使用 AgentPlugin paths
- [ ] 4.4 迁移 `sync_engine.rs` 使用统一部署引擎
- [ ] 4.5 删除 `tool_adapters.rs`
- [ ] 4.6 命令注册到 `neeko_invoke_handler!`

### Step 5 — 前端 UI

- [ ] 5.1 `useAgentPlugins.ts` — Zustand hook
- [ ] 5.2 `agentPluginApi.ts` — IPC 封装
- [ ] 5.3 `AgentPluginCard.tsx` — 插件卡片
- [ ] 5.4 `AgentPluginDetails.tsx` — 插件详情（执行/配置/能力/路径）
- [ ] 5.5 `AgentPluginForm.tsx` — 自定义插件表单
- [ ] 5.6 `ResourcePathEditor.tsx` — 路径编辑器

### Step 6 — 集成

- [ ] 6.1 Settings → Agents 面板展示插件详情
- [ ] 6.2 Library 面板增加 Agent 分组视图
- [ ] 6.3 Agent 安装检测

---

## Review Gates

- 每步结束：`pnpm type-check` + `cargo check` 通过
- 全量结束：`pnpm lint:fe` + `cargo test` 全绿
- 验收标准 9 项全部达成
- 现有 Skills 部署功能回归测试通过

## 关键文件

| 文件 | 角色 |
|------|------|
| `src/shared/types/agentPlugin.ts` | 统一类型 |
| `src/shared/data/agentPluginPresets.ts` | 内置定义 |
| `src-tauri/src/agent/plugin.rs` | Rust 类型 |
| `src-tauri/src/agent/registry.rs` | 注册表 |
| `src-tauri/src/agent/plugin_commands.rs` | Tauri 命令 |
| `src-tauri/src/agent/path_resolver.rs` | 路径解析 |
| `src-tauri/src/agent/deployer.rs` | 统一部署 |
| `src-tauri/src/skill/migrations.rs` | v5→v6 |
| `src-tauri/src/skill/tool_adapters.rs` | **删除** |
| `src/features/agent/hooks/useAgentPlugins.ts` | 状态管理 |
| `src/features/agent/components/AgentPluginCard.tsx` | 卡片 |
| `src/features/agent/components/AgentPluginDetails.tsx` | 详情 |
| `src/features/agent/api/agentPluginApi.ts` | IPC 封装 |
