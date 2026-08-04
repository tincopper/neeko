# MCP Marketplace

## Goal

为 Neeko Resource Library 的 MCP 资源增加「市场」能力：从官方 MCP Registry 发现服务器，解析 `server.json` 生成启动配置（预填编辑对话框），用户确认后落库。入口与操作参照 **library 内容区的 skills 布局**（`SkillContent` 子视图路由 + 自带 header/搜索/操作），保持设计语言统一。

**本任务当前阶段：先输出原型图，不直接改业务代码。**

## 背景 / 已确认事实

- 官方 MCP Registry API 可用：`GET https://registry.modelcontextprotocol.io/v0.1/servers?version=latest&search=<q>&limit=<n>&cursor=<c>`，无鉴权只读，返回 `server.json` 列表，含 `nextCursor` 分页。
- `server.json` 关键字段：`name`（registry 唯一名，如 `io.github.modelcontextprotocol/filesystem`）、`title`、`description`、`version`、`packages[]`（`registryType`/`identifier`/`runtimeHint`/`runtimeArguments`/`packageArguments`/`environmentVariables`[isSecret/isRequired/default]）、`remotes[]`（`streamable-http`/`sse` + `url`）、`repository`。
- 安装语义 ≠ skills（不 clone 代码）：从 `server.json` 生成启动配置（如 `npx -y @xxx/server` 或 remote url），与 VSCode `mcp.json` 模型一致。
- Registry 为 **preview 状态**（可能变更/重置），无 installs 数据 → 市场无 leaderboard，仅搜索 + 列表。
- 现状：`McpServer.transport` 仅 `'stdio' | 'sse'`（需扩展 `'http'`）；无来源字段；DB 版本 v7。
- 布局参考：`activeKind === 'skill'` 时 library 内容区 `SkillContent` —— 面包屑 `Skills / Marketplace`、内容区自带 header（`SkillHeader`：标题+count+搜索+操作）、子视图路由、`LibraryDetail` 不渲染外层搜索行且 `renderActionButtons` 返回 null。
- MCP 侧栏维持现状（`LibraryNavTree` 中 mcp 显示 "No additional filters"），**不做侧栏导航组件**（用户明确：参考 library 内容区 skills 布局，非侧栏 skills 布局）。

## 需求

1. **市场视图**：MCP 内容区新增 `Marketplace` 子视图（`mcpView: 'installed' | 'marketplace'`），切换入口在内容区 header 内（segmented tabs，对齐 `LeaderboardToggle` 选中态）。
2. **数据源**：官方 MCP Registry 搜索 + 全量列表 + 分页；无 leaderboard / source filter。
3. **安装流程**：卡片 Install → 拉取该 server 最新版 `server.json` 解析为预填模板 → 打开 `McpEditorDialog` 预填（command/args/env/transport/name/description；secret env 占位提示）→ 用户确认后走现有 `createMcpServer` 落库（携带 `source_registry`/`source_ref`）。
4. **来源跟踪**：`McpServer` 增加 `source_registry`/`source_ref`；市场卡片按 `source_ref` 匹配本地服务器显示「已安装」并禁用 Install。
5. **布局对齐 skills 内容区**：header（标题+count+搜索+`New Server` 按钮，installed 视图）；市场视图自带搜索框（对齐 `MarketplaceSearchBar`）+ 卡片网格（对齐 `MarketSkillCard`）+ 分页（复用 `Pagination`）。
6. **安全**：市场卡片 + 编辑对话框警示文案（MCP server 运行任意代码，安装前审查配置）；secret env 不自动填充。
7. **`LibraryDetail` 调整**：mcp 从 prompt/action/command 分组拆出 —— 不渲染外层搜索行、`renderActionButtons` 对 mcp 返回 null、`deriveSubLabel` mcp 分支按 `mcpView` 返回 `Installed`/`Marketplace`；市场 count 徽标对齐 skill 的 marketplace 徽标逻辑。

## 验收标准

- [ ] 原型图产出：低保真线框（当前 vs 目标）+ 可交互高保真 HTML 原型，覆盖 MCP installed/marketplace 两个视图、header/搜索/分页/卡片/安装流程/已安装标记。
- [ ] 用户评审原型图并确认交互与布局后，再进入编码实现。
- [ ] （实现阶段）后端 `mcp_registry_api.rs` 解析真实 server.json 样本（npm/pypi/nuget/remote）单测通过。
- [ ] （实现阶段）DB 迁移 v8（`source_registry`/`source_ref`）+ repository CRUD 测试通过。
- [ ] （实现阶段）`search_mcp_registry` / `install_mcp_from_registry` 命令注册并通过。
- [ ] （实现阶段）`McpTabContent` 视图路由、`McpMarketplaceContent`、`McpEditorDialog` 预填、`LibraryDetail` 面包屑改动，相关 hook/组件测试通过。
- [ ] （实现阶段）市场分页可用：分页条含页码/范围/每页条数选择，prev/next 与已访问页码可翻页（游标栈缓存跳回）；内容区有滚动条（高度链 `h-full` 约束）。
- [ ] （实现阶段）市场卡片**参照 Skills 面板**（`SkillCard`/SkillListSection 网格）：`min-h-[160px]`、标题 `text-[13px]`、描述固定两行（`min-h-[2.5em]`）、底部来源位 + 状态按钮；网格 `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3`。
- [ ] （实现阶段）市场提供 transport 过滤（http/stdio/sse chips）与排序（Recent / A–Z / ⭐ Popular / Downloads）。
- [ ] （实现阶段）市场指标：`search_mcp_registry_cmd` 对每个 server 补充 **GitHub stars**（免鉴权，repository→owner/repo）与**包下载量**（npm/pypi，packages→identifier），每 server 级缓存（TTL 1h）、失败/限流降级 `None`；卡片底部展示 ⭐ stars 与 ⬇ downloads（数据缺失时隐藏），可分别按热度/下载量排序。
- [ ] （实现阶段）**动态配置渲染（P1）**：`ServerJson` 解析 `inputs[]`/`websiteUrl`，`RegistryEnvelope` 解析 `_meta`（status/updatedAt）；`McpRegistrySummary`/`McpRegistryGeneratedConfig` 透传 `inputs`/`status`/`updatedAt`；`McpEditorDialog` 有 inputs 时按 `format`/`choices`/`isSecret`/`isRequired`/`default` 动态渲染 Configuration 表单（下拉/boolean/number/secret 占位），保存合并进 env，无 inputs 回退现有 env 表单；`McpMarketCard` 对 `status === 'deprecated'` 显示徽章、指标位显示 `updatedAt`。
- [ ] （实现阶段）`pnpm type-check`、`pnpm lint:fe`、`pnpm test:run`、`cargo test` 全部通过。

## 不在范围

- 自定义 registry URL 配置（未来扩展，YAGNI）。
- MCP server 更新检测 / 一键升级。
- leaderboard / 评分 / installs 统计（registry 无此数据）。
- 修改 skills 现有布局或侧栏。

## 备注

- 本任务为 **complex**：需要 `prd.md` + `design.md` + `implement.md`。
- 依赖：`08-02-resource-library-redesign`（已归档完成，提供 `McpEditorDialog`/`editorKind` 等基础，本任务在此之上扩展）。
- 风险：registry preview 状态 schema 可能变化 → 解析容错 + 5min 缓存 TTL。
