# MCP Marketplace — Implementation Plan

## Scope

后端 registry API 客户端 + DB 迁移 v8（`source_registry`/`source_ref`）+ 前端市场视图与预填安装流 + `LibraryDetail`/`LibraryToolbar` mcp 分支调整。严格 TDD：每个阶段先写测试（红）再实现（绿）再重构。

无代码改动，直到 `task.py start` 之后。遵循 `prd.md` / `design.md`。

## Ordered Checklist

### Phase A — 后端 registry API（纯函数 + 网络）

1. 新增 `src-tauri/src/skill/mcp_registry_api.rs`：类型（Summary/Detail/GeneratedConfig/EnvVar）+ `build_http_client`（复用 skillssh 模式）。
2. 编写纯函数单测（**红**）：`generate_config` / `derive_transports` 解析 4 个真实 server.json 样本（npm/pypi/nuget/remote）——字段映射、command/args 生成、transport 推导、secret env 不填值、畸形 JSON 降级 `Ok(None)`。
3. 实现 `generate_config` / `derive_transports`（**绿**）。
4. 实现 `search_registry` / `fetch_server` 网络函数 + `SearchApiResponse` 结构（server.json 列表 + `nextCursor`）。
5. 运行 `cargo test`（mcp_registry_api 单测绿）+ `cargo fmt`。

### Phase B — DB 迁移 v8 + 类型 + repository

1. `migrations.rs`：`LATEST_VERSION` → 8，新增 `migrate_v7_to_v8`（ADD COLUMN `source_registry`、`source_ref`）。
2. 迁移测试（**红**）：迁移后 `mcp_servers` 表含新列；`LATEST_VERSION == 8`。
3. `types.rs` `McpServerRecord`：加 `source_registry`/`source_ref`（`Option<String>`）；transport 注释更新。
4. `repository.rs`：`insert`/`get_all`/`get_by_id`/`update` SQL 列 + 参数 + `map_mcp_row`；`sample_mcp` 测试工厂补字段。
5. CRUD 往返测试（**红→绿**）：含 source 字段插入/读取/更新。
6. 运行 `cargo test` 全量绿。

### Phase C — 命令层

1. `commands.rs`：`McpServerDtoOut` + `mcp_record_to_dto` 加 source 字段；`CreateMcpServerInput` + `save_mcp_server`/`update_mcp_server_cmd` 透传。
2. 新增命令 `search_mcp_registry` / `fetch_mcp_registry_server` + DTO（`camelCase`）。registry 调用用 `run_blocking_result` 包裹（**不得**在 async driver 直接调用 blocking）。
3. 5min 缓存：`get_cache`/`set_cache`，key `mcp_registry_search:{q}:{limit}:{cursor}` / `mcp_registry_server:{name}`；proxy 从 settings 读（对齐 skillssh 命令）。
4. 命令单测（**红→绿**）：search/fetch 参数校验、缓存命中、DTO 序列化。
5. 将两命令加入 `neeko_invoke_handler!`（`src-tauri/src/lib.rs`）。
6. 运行 `cargo test` + `cargo fmt` + `cargo clippy`。

### Phase D — 前端类型 + API + store

1. `src/shared/types/mcpServer.ts`：`transport` 加 `'http'`；加 `sourceRegistry`/`sourceRef`。
2. `libraryApi.ts`：MCP registry DTO + `searchMcpRegistry` / `fetchMcpRegistryServer`；`saveMcpServer` 透传 source 字段。
3. `libraryStore.ts`：`mcpView`/`setMcpView`/`mcpRegistryQuery`/`setMcpRegistryQuery`/`mcpDraft`/`setMcpDraft`；`createMcpServer` 透传 source。
4. Hook 测试（**红→绿**）：`useMcpMarketplace` 初始加载、搜索 debounce、分页 cursor、`sourceRef` 匹配已安装。
5. `pnpm type-check` + `pnpm test:run`。

### Phase E — 前端市场 UI

1. `LibraryNavTree`：mcp 分支改为 tree-grp（`📦 Installed [count]` / `⬇ Marketplace`），与 skills 同构；点击 → `setMcpView`，激活态跟随 `mcpView`。
2. `useMcpMarketplace` hook（服务端分页 + cursor 栈 + debounce + 已安装匹配）。
3. `McpMarketCard` + `McpMarketplaceContent`（卡片网格/空态/加载态/分页 `Pagination`/安全警示条）。
4. `McpTabContent` 视图路由：读 `mcpView` 分支渲染 installed ↔ marketplace（无内容区 header）。
5. 组件测试（**红→绿**）：市场渲染/空态/已安装标记/Install 打开预填 dialog + `LibraryNavTree` 切换测试。
6. `pnpm type-check` + `pnpm test:run`。

### Phase F — 编辑器预填 + 布局调整

1. `McpEditorDialog`：支持 `mcpDraft` 预填（name/command/args/env/transport；remote 隐藏命令行显示 URL；secret env 占位）；draft 来源时展示安全警示。
2. 编辑器预填测试（**红→绿**）：draft 预填、secret 占位不填充、remote 隐藏命令行。
3. `LibraryDetail`：mcp 保留外层搜索行（placeholder 按 `mcpView` 切换，见 design §4.4）。
4. `LibraryToolbar`：`deriveSubLabel` mcp 分支按 `mcpView`；`renderActionButtons` mcp 渲染「＋ 新建」（仅 installed 视图）；marketplace count 徽标对齐 skill。
5. Toolbar 测试更新（**红→绿**）。
6. **部署侧回归**：检查 `resource_deployer.rs` 对 `transport == "http"` 的行为（design §6 待确认项）——若仅支持 stdio/sse，加 `http` 分支或显式跳过并提示。

### Phase G — 全量验证

1. `pnpm lint`（Rust fmt + clippy）+ `pnpm lint:fe` + `pnpm type-check`。
2. `pnpm test:run` + `cargo test --manifest-path src-tauri/Cargo.toml`。
3. 手动回归：installed 列表操作（新建/编辑/删除/测试）无回归；市场搜索/分页/安装流；secret env 提示；LibraryToolbar 面包屑；`mcpView` 切换不丢状态。

## Validation Commands

```bash
pnpm lint
pnpm lint:fe
pnpm type-check
pnpm test:run
cargo test --manifest-path src-tauri/Cargo.toml
```

## Review Gates

- [x] 原型评审通过（`prototypes/prototype.html` + 线框，已确认）
- [ ] Phase A registry 单测通过（4 样本 + 降级）
- [ ] Phase B 迁移 v8 + CRUD 测试通过
- [ ] Phase C 命令注册 + 单测通过
- [ ] Phase D/E/F 前端类型/store/hook/组件测试通过
- [ ] Phase G 全量 lint + type-check + 测试通过
- [ ] `resource_deployer.rs` http transport 回归结论明确（支持或显式跳过）

## Rollback Points

1. 后端 registry API 失败：前端命令未接线，不影响既有 MCP 功能。
2. 迁移 v8 前：DB 备份 `~/.neeko/neeko.db`（迁移不可逆，仅 ADD COLUMN，风险低）。
3. 命令层接入后 UI 异常：前端 `mcpView` 默认 `installed`，市场不渲染即可回退。
4. 预填/编辑器改动异常：`mcpDraft` 默认 null，dialog 走原新建路径。

## Files

- 新增：`src-tauri/src/skill/mcp_registry_api.rs`、`src/features/library/components/McpMarketplaceContent.tsx`、`McpMarketCard.tsx`、`src/features/library/hooks/useMcpMarketplace.ts`
- 修改：`src-tauri/src/skill/migrations.rs`、`types.rs`、`repository.rs`、`commands.rs`、`src-tauri/src/lib.rs`、`src/shared/types/mcpServer.ts`、`src/features/library/api/libraryApi.ts`、`store/libraryStore.ts`、`components/McpTabContent.tsx`、`McpEditorDialog.tsx`、`LibraryNavTree.tsx`、`LibraryDetail.tsx`、`LibraryToolbar.tsx`、（可能）`src-tauri/src/agent/resource_deployer.rs`
