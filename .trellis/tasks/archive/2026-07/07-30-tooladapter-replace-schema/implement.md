# ToolAdapter 完全替代 + Agent 配置 Schema · 执行计划

> 任务：`07-30-tooladapter-replace-schema`

---

## 步骤

### Step 1 — ToolAdapter 删除 + 迁移

- [ ] 1.1 迁移 `scanner.rs` 使用 AgentPlugin + PathResolver
- [ ] 1.2 迁移 `sync_engine.rs` 使用 ResourceDeployer
- [ ] 1.3 迁移 `commands.rs` 所有 ToolAdapter 引用
- [ ] 1.4 删除 `tool_adapters.rs`
- [ ] 1.5 移除 `customToolAdapters` 设置

### Step 2 — Agent 配置 Schema

- [ ] 2.1 为 12 个内置 Agent 定义完整 JSON Schema
- [ ] 2.2 Schema 验证引擎
- [ ] 2.3 Schema → UI 表单生成
- [ ] 2.4 凭据声明和验证

### Step 3 — 回归验证

- [ ] 3.1 Skills 部署/扫描功能正常
- [ ] 3.2 所有测试通过
- [ ] 3.3 无残留硬编码路径

---

## 关键文件

| 文件 | 操作 |
|------|------|
| `src-tauri/src/skill/tool_adapters.rs` | 删除 |
| `src-tauri/src/skill/scanner.rs` | 迁移 |
| `src-tauri/src/skill/sync_engine.rs` | 迁移 |
| `src-tauri/src/skill/commands.rs` | 迁移 |
| `src-tauri/src/agent/registry.rs` | 扩展 |
| `src-tauri/src/agent/path_resolver.rs` | 扩展 |
| `src/features/settings/components/AgentsPanel.tsx` | Schema UI |
