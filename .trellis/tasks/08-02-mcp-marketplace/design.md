# MCP Marketplace — 设计方案

> 阶段：设计规划（Phase 1）· 关联：`prd.md`（需求与验收）、`prototypes/`（原型 v3：侧栏 tree-grp 决策，经用户评审后定稿）
>
> 范围：后端 registry API 客户端 + DB 迁移 v8（来源字段）+ 前端市场视图/预填安装流 + `LibraryNavTree` mcp 侧栏 + `LibraryDetail`/`LibraryToolbar` mcp 分支调整。本文档是 `implement.md` 的设计依据。

---

## 1. 设计原则

1. **对齐 skills 市场，但不照搬**：入口与视图切换完全参照 skills —— MCP 的 Installed / Marketplace 置于**左侧导航树 `tree-grp`**（`LibraryNavTree` 中与 skills 同构的 `tree-item`），视图由侧栏 tree-item 点击驱动，非内容区 header 的 segmented tabs。内容区布局参照 `SkillContent` 市场模式（搜索/分页/卡片）。MCP 安装是「生成配置 → 预填编辑器」而非「clone 代码」，交互层与 skills 分离。
2. **复用现有 MCP 落库链路**：预填模板确认后走现有 `save_mcp_server`，不新建第二条写路径。
3. **registry 容错优先**：registry 是 preview 状态、schema 可能变化 —— 解析失败按记录降级（返回 title/description/原始字段，可配置部分留空），不整体失败。
4. **最小 schema 变更**：DB 只加两列（`source_registry`/`source_ref`），`McpServerRecord` 同步加两个 `Option<String>` 字段，所有读写点机械更新。
5. **不扩展自定义 registry**：仅官方 `registry.modelcontextprotocol.io`（YAGNI，prd §不在范围）。

---

## 2. 数据流总览

```
前端 McpMarketplaceContent
  │  searchMcpRegistry(q, limit, cursor)          [invoke]
  ▼
Rust mcp_registry_api::search_registry()
  │  GET https://registry.modelcontextprotocol.io/v0.1/servers
  │     ?version=latest&search=<q>&limit=<n>&cursor=<c>
  ▼
server.json 列表 → McpRegistryServerSummary[] + nextCursor
  │
  │  卡片 Install → fetchMcpRegistryServer(name)   [invoke]
  ▼
Rust mcp_registry_api::fetch_server(name) → McpRegistryServerDetail
  │  解析 packages[]/remotes[] → 生成启动配置模板
  ▼
McpRegistryGeneratedConfig { command, args, env, transport, ... }
  │  前端 → openMcpEditor(mcpDraft) → McpEditorDialog 预填
  ▼
用户确认/补 secret env → save_mcp_server(input + source_registry + source_ref)  [现有链路]
```

---

## 3. 后端设计

### 3.1 新增 `src-tauri/src/skill/mcp_registry_api.rs`

参照 `skillssh_api.rs`（`build_http_client` + blocking reqwest + serde 解析）。模块职责：**registry 数据获取 + server.json 解析 + 启动配置生成**。纯函数与网络函数分离，便于单测。

类型定义：

```rust
/// 市场列表中的一条摘要（列表卡片展示所需）。
pub struct McpRegistryServerSummary {
    pub name: String,        // registry 唯一名，如 io.github.modelcontextprotocol/filesystem
    pub title: String,       // 展示名
    pub description: Option<String>,
    pub version: Option<String>,
    pub transports: Vec<String>, // 从 packages/remotes 推导: stdio / http / sse
    pub repository: Option<String>,
    pub stars: Option<u64>,       // GitHub stars（命令层补充，失败/限流降级 None）
    pub downloads: Option<u64>,   // 包下载量（命令层补充，npm/pypi）
    pub inputs: Vec<McpRegistryInput>, // server 声明的配置参数（Argument schema）→ 动态表单
    pub status: Option<String>,   // _meta 生命周期: active | deprecated | deleted
    pub updated_at: Option<String>, // _meta 最后更新时间（RFC3339）
    #[serde(skip_serializing)] pub package_keys: Vec<(String, String)>, // 内部：下载量查询键
}

/// server 声明的配置参数（与 registry Argument schema 对齐）。
pub struct McpRegistryInput {
    pub name: String,
    pub input_type: Option<String>,   // positional | named
    pub format: Option<String>,       // string | number | boolean | filepath
    pub is_required: bool,
    pub is_secret: bool,              // secret 不自动填充
    pub is_repeated: bool,
    pub default: Option<serde_json::Value>,
    pub placeholder: Option<String>,
    pub choices: Vec<String>,         // 有值时前端渲染下拉
    pub value_hint: Option<String>,   // remote URL 变量替换提示
}

/// 单个 server.json 完整详情（Install 时拉取）。
pub struct McpRegistryServerDetail {
    pub summary: McpRegistryServerSummary,
    pub generated: Option<McpRegistryGeneratedConfig>,
    pub raw: serde_json::Value, // 保留原始 JSON，前端可兜底展示
}

/// 从 server.json 生成的启动配置模板（预填 McpEditorDialog）。
pub struct McpRegistryGeneratedConfig {
    pub name: String,
    pub description: Option<String>,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<McpRegistryEnvVar>, // 含 isSecret / isRequired / default
    pub transport: McpRegistryTransport, // Stdio | Http | Sse
    pub url: Option<String>,             // remote transport 时
    pub inputs: Vec<McpRegistryInput>,   // 随 draft 传入编辑器驱动动态表单
}

/// 环境变量条目（secret 不填充值，仅占位提示）。
pub struct McpRegistryEnvVar {
    pub name: String,
    pub is_secret: bool,
    pub is_required: bool,
    pub default: Option<String>,
}
```

函数清单：

| 函数 | 签名 | 职责 |
| --- | --- | --- |
| `search_registry` | `(query: &str, limit: usize, cursor: Option<&str>, proxy_url: Option<&str>) -> Result<(Vec<McpRegistryServerSummary>, Option<String>)>` | 列表/搜索 + `nextCursor` 分页；`query` 空即全量列表 |
| `fetch_server` | `(name: &str, proxy_url: Option<&str>) -> Result<McpRegistryServerDetail>` | 拉取单 server.json，走生成逻辑，含原始 JSON |
| `generate_config` | `(json: &serde_json::Value) -> Result<Option<McpRegistryGeneratedConfig>>` | 纯函数：解析 packages/remotes 生成模板；解析失败返回 `Ok(None)`（降级） |
| `derive_transports` | `(json: &serde_json::Value) -> Vec<String>` | 纯函数：从 packages/remotes 推导 transport 列表 |
| `build_http_client` | 复用 `skillssh_api::build_http_client`（同文件模式，单测可用） | 网络客户端 |

**`generate_config` 映射规则**（与 VSCode `mcp.json` 模型一致）：

- **包选择优先级**：`packages[]` 中 `registryType == "npm"` 优先（生态主流）；无 npm 时依次尝试 `pypi`、`nuget`、其他；选择第一个解析成功的包。
- **stdio 启动**（包型，`transport.type == "stdio"`）：
  - npm → `command = "npx"`, `args = ["-y", "<identifier>", ...runtimeArguments, ...packageArguments]`
  - pypi → `command = "uvx"`, `args = ["<identifier>", ...]`（runtimeHint 存在则覆盖 command）
  - nuget → `command = "dotnet"`, `args = ["run", ...]`（依 runtimeHint 调整）
  - `runtimeHint` 存在时作为 command，`runtimeArguments` 追加到 args
- **remote 传输**（`remotes[]` 存在且非空，`packages` 解析失败或为空）：
  - 首个 `streamable-http` 条目 → `transport = "http"`, `url = <url>`
  - 否则首个 `sse` 条目 → `transport = "sse"`, `url = <url>`
  - remote 时 `command`/`args` 置空（前端编辑器 transport=http/sse 时隐藏命令行区）
- **env**：`packages[]` 首个选中包的 `environmentVariables[]` → `McpRegistryEnvVar`；`isSecret` 的变量 `value` 永远不填（占位提示「启动时由用户提供」）。
- **容错**：JSON 结构缺失/类型不符 → 对应字段取默认，不 panic；`name`/`title` 缺失时降级为空字符串。

### 3.2 DB 迁移 v8

`src-tauri/src/skill/migrations.rs`：

- `LATEST_VERSION` 7 → **8**
- 新增 `migrate_v7_to_v8`：
  ```sql
  ALTER TABLE mcp_servers ADD COLUMN source_registry TEXT;
  ALTER TABLE mcp_servers ADD COLUMN source_ref TEXT;
  ```
- 迁移测试：`migrate_version` 到 8 后 `mcp_servers` 表包含 `source_registry`/`source_ref` 列。

### 3.3 `McpServerRecord` 扩展

`src-tauri/src/skill/types.rs` `McpServerRecord`（L165）：

- 新增字段：
  ```rust
  /// MCP Registry 来源（固定 "registry.modelcontextprotocol.io"）。
  pub source_registry: Option<String>,
  /// Registry 内的唯一名（如 io.github.modelcontextprotocol/filesystem）。
  pub source_ref: Option<String>,
  ```
- `transport` 文档注释更新：`"stdio" | "sse" | "http"`。

### 3.4 repository 读写更新

`src-tauri/src/skill/repository.rs`：

- `insert_mcp_server` / `get_all_mcp_servers` / `get_mcp_server_by_id` / `update_mcp_server`：SQL 列 + 参数各加 `source_registry`、`source_ref`。
- `map_mcp_row`（L1318）：读取两列。
- `sample_mcp`（测试工厂 L1432）：补 `source_registry: None, source_ref: None`。
- skill_store 的 `insert_mcp_server` 等薄封装无需改动签名（透传 record）。

### 3.5 命令层（`src-tauri/src/skill/commands.rs`）

| 命令 | 签名 | 说明 |
| --- | --- | --- |
| `search_mcp_registry` | `(query: Option<String>, limit: Option<usize>, cursor: Option<String>) -> Result<McpRegistrySearchResult, AppError>` | 调 `mcp_registry_api::search_registry`；proxy 从 settings 读（对齐 skills.sh 命令的 proxy 处理）；包装为 DTO |
| `fetch_mcp_registry_server` | `(name: String) -> Result<McpRegistryServerDetailDto, AppError>` | 拉详情 + 生成配置 |

- DTO 序列化：`McpRegistryServerDetailDto` / `McpRegistryGeneratedConfigDto` / `McpRegistryEnvVarDto`，字段 `rename_all = "camelCase"`，输出对齐前端类型。
- 同步命令：registry 调用是 blocking reqwest（对齐 `skillssh_api`），用 `run_blocking_result` 包裹（`common::runtime`），**不得**在 async driver 线程直接调用（AGENTS.md 红线 1）。
- **5min 缓存 TTL**：search 与 fetch 结果经 `SkillStore::get_cache`/`set_cache`（已有 TTL 参数，`repository.rs` L408）落 DB 缓存，key 如 `mcp_registry_search:{q}:{limit}:{cursor}`、`mcp_registry_server:{name}`。

### 3.6 `McpServerDtoOut` / `CreateMcpServerInput`

`commands.rs`：

- `McpServerDtoOut`（L3591 附近）：加 `source_registry`、`source_ref`；`mcp_record_to_dto` 同步。
- `CreateMcpServerInput`：加 `source_registry: Option<String>`、`source_ref: Option<String>`；`save_mcp_server` / `update_mcp_server_cmd` 透传到 record。
- `McpServerRecord` 构造处（L3682 save、update 合并）补两字段。

### 3.7 单测

| 文件 | 用例 |
| --- | --- |
| `mcp_registry_api.rs` 内 `#[cfg(test)]` | 解析 4 个真实 server.json 样本（npm/pypi/nuget/remote）：字段映射、command/args 生成、transport 推导、secret env 不填值、畸形 JSON 降级 `Ok(None)` |
| `migrations.rs` | v8 后表含新列；`LATEST_VERSION == 8` |
| `repository.rs` | mcp CRUD 往返含 source 字段 |
| `commands.rs` 已有 MCP 测试 | 回归通过 |

---

## 4. 前端设计

### 4.1 类型扩展

`src/shared/types/mcpServer.ts`：

- `McpServer.transport`: `'stdio' | 'sse'` → `'stdio' | 'sse' | 'http'`
- 新增字段：
  ```ts
  /** MCP Registry 来源（存在即为市场安装）。 */
  sourceRegistry?: string | null;
  /** Registry 内的唯一名（匹配「已安装」标记）。 */
  sourceRef?: string | null;
  ```
- `McpServerInput` 自动继承新字段（`Omit` 基础不变）。

### 4.2 `libraryApi.ts`

- 新增 `McpRegistrySummary` / `McpRegistrySearchResult` / `McpRegistryGeneratedConfig` / `McpRegistryEnvVar` DTO（`rename_all = camelCase` 对齐）。
- `searchMcpRegistry(query, limit, cursor)` → invoke `search_mcp_registry`。
- `fetchMcpRegistryServer(name)` → invoke `fetch_mcp_registry_server`。
- `saveMcpServer` input 透传 `sourceRegistry`/`sourceRef`。

### 4.3 store（`libraryStore.ts`）

新增状态与 actions：

```ts
mcpView: 'installed' | 'marketplace';
mcpDraft: McpRegistryGeneratedConfig | null;   // Install 预填模板
// 搜索复用外层 `searchQuery`（不新增 mcpRegistryQuery —— 修复「搜索没有反应」：
// LibraryDetail 搜索行绑定 searchQuery，useMcpMarketplace 必须监听同一字段，否则输入不触发搜索）
setMcpView(view);
setSearchQuery(q);
setMcpDraft(draft);                             // 安装流触发
```

- `mcpDraft` 生命周期：Install 点击 → setMcpDraft(generated) → `editorOpen=true; editorKind='mcp'` → McpEditorDialog 预填；确认/取消后 `setMcpDraft(null)`。
- `mcpView` 默认 `'installed'`，切换不动 `activeKind`。
- `createMcpServer`（store 内 L356）调 `saveMcpServerApi` 时透传 `sourceRegistry`/`sourceRef`。

### 4.4 视图路由（树驱动，对齐 skills）

**视图状态**：`store.mcpView: 'installed' | 'marketplace'`（默认 `'installed'`），由 `LibraryNavTree` 的 mcp `tree-item` 点击驱动 `setMcpView`，切换不动 `activeKind`。

**`LibraryNavTree.tsx`（mcp 分支，从「无额外筛选」空态改为 tree-grp）**：

```tsx
{activeKind === 'mcp' && (
  <div className="tree-grp">
    <button className="tree-item" data-sub="local" onClick={() => setMcpView('installed')}>
      <Package className="ic" /><span className="lb">Installed</span><span className="cnt">{count}</span>
    </button>
    <button className="tree-item" data-sub="marketplace" onClick={() => setMcpView('marketplace')}>
      <Download className="ic" /><span className="lb">Marketplace</span>
    </button>
  </div>
)}
```
> 图标使用 lucide（Package / Download），**不用 emoji**（评审反馈）。

- 与 skills 的 `tree-grp`（Installed/Marketplace）完全同构（对齐原型 `data-sub="local"/"marketplace"`）。
- 激活态：当前 `mcpView` 的 item 加 active class。
- 点选后 `LibraryDetail` 据此渲染不同内容。

**`McpTabContent.tsx`（容器，不再含 header）**：

```
McpTabContent
└── <div flex-col h-full min-h-0>
    ├── mcpView === 'installed'    → <McpListSection onEdit> + <McpEditorDialog>
    └── mcpView === 'marketplace'  → <McpMarketplaceContent> + <McpEditorDialog>
```

- **不做内容区 segmented tabs**：视图切换由侧栏 tree-item 完成，`McpTabContent` 只读 `mcpView` 分支渲染。
- **外层搜索行保留**（`LibraryDetail` 中 mcp 不再排除外层搜索行）：placeholder 按 `mcpView` 切换 —— installed →「搜索已安装的 MCP…」，marketplace →「搜索 MCP Registry…」。
- **`＋ 新建`（New Server）**：位于 toolbar-actions（`LibraryToolbar.renderActionButtons` mcp 分支渲染），仅 `mcpView === 'installed'` 时显示；marketplace 视图隐藏（对齐原型 `newBtn`）。

### 4.5 新组件

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| `McpMarketplaceContent` | `src/features/library/components/McpMarketplaceContent.tsx` | 市场主内容：搜索态/加载态/空态 + 卡片网格 + 分页（游标页码组，交互对齐 `Pagination`）+ 安全警示条。**加载态分级**：初始加载（无数据）居中 spinner；**翻页/搜索加载（已有数据）叠加半透明遮罩 + spinner**（内容区包 `relative`，`loading && displayList.length > 0` 时 `absolute inset-0` 覆盖层），保留旧内容不跳动 |
| `McpMarketCard` | `src/features/library/components/McpMarketCard.tsx` | 市场卡片：title/description/transport 徽章/repository 链接/Install 按钮（已安装则禁用并标「已安装」） |
| `useMcpMarketplace` | `src/features/library/hooks/useMcpMarketplace.ts` | 市场状态 hook（仿 `useMarketplace`）：search/分页/加载/已安装匹配 |

**`useMcpMarketplace` 要点**：
- 服务端分页：`perPage` 变化 → `searchMcpRegistry(query, limit, cursor)`，`nextCursor` 管理（**不是**前端 slice —— 与 skills 市场不同，因为 registry 分页在服务端）。
- 分页模型：`totalItems`/`totalPages` registry 不返回 → 基于已知 `nextCursor` 允许「下一页」，无跳页；实现采用「每页 20，缓存已拉页，prev/next 游标」模式（简化：`cursor` 栈）。若无下一页则 next 禁用。
- **分页条交互对齐 Skills `Pagination`**（评审反馈「不能翻页、无滚动条」修复）：左侧范围文本（`Page X · N servers`）、中间**已访问页码按钮组**（游标栈缓存，可 `goToPage` 跳回）+ 下一页按钮 + prev/next、右侧每页条数 select（20/40/80，切换重置游标栈并以新 limit 重取第一页）。
- **高度链修复**（滚动条不出现的根因）：`McpTabContent` 根节点由 `flex-1` 改为 `h-full`（其父级 LibraryDetail 内容区非 flex 容器，`flex-1` 失效 → 高度 auto → 内容区无限高、`overflow-y-auto` 不触发、分页条被挤出可视区）；改为 `h-full` 后内容区可滚动、分页条固定底部可见。
- **视图控件（评审反馈「下载量/排序/热度」）**：registry **本身不提供** installs/downloads/热度字段（官方 `ServerResponse` metadata 仅 status/publishedAt/updatedAt/isLatest；`ServerJson` 无指标字段）→ 经评审决策落地**外部指标补充**：**GitHub stars + 包下载量**（方案 A+B）。见下方「指标获取」。
- **指标获取（后端）**：`search_mcp_registry_cmd` 对当前页每个 server 补充 `stars`（GitHub API，免鉴权，从 `repository.url` 解析 owner/repo）与 `downloads`（npm `api.npmjs.org/downloads/point/last-month/{id}` / pypi `pypistats.org/api/packages/{id}/recent`，从 `packages[].registryType`+`identifier` 取）。**每 server 级缓存**（key `mcp_registry_metrics_{name}`，TTL 1h——GitHub 未鉴权限流 ~60/hr，故缓存长于页面缓存）；网络失败/限流/非 GitHub 仓库 → 降级 `None` 静默跳过。**并行拉取**（性能优化，修复「页面加载慢」）：`thread::scope` 每批 8 个 server 并发请求、批间串行（`enriched.chunks_mut(8)` + 批内 `scope.spawn`），缓存命中跳过，避免整页串行网络往返。`McpRegistryServerSummary` 增加 `stars`/`downloads`（`#[serde(default)]`），内部 `package_keys`（`skip_serializing` 不暴露前端）。
- **排序/过滤（前端，作用于当前页）**：**transport 过滤**（http/stdio/sse chips）+ **排序**（Recent = registry 顺序 / A–Z / ⭐ Popular = stars 降序 / Downloads = downloads 降序，`visibleList` 派生自 `displayList`）。`availableTransports` 从当前页推导过滤 chips。
- 已安装匹配：`installedServers.some(s => s.sourceRef === item.name)`（`sourceRef` 即 registry name）。
- debounce 300ms 搜索（对齐 `useMarketplace`）。

**`McpMarketCard` 视觉**（对齐 `SkillCard`——SkillListSection 网格，评审反馈「参照 Skills 面板」）：
- 卡片：`group flex flex-col h-full min-h-[160px] rounded-lg bg-bg-primary transition-colors duration-150 border`（已安装 `border-accent-blue/50`，否则 `border-border hover:bg-bg-hover`）
- 内部：`flex flex-col flex-1 gap-2 px-3.5 pt-3.5 pb-2 min-h-0` —— 标题行（`text-[13px] font-semibold` + hover 外链）+ 描述（`text-[12px] leading-relaxed line-clamp-2 min-h-[2.5em] text-text-secondary` 固定两行）+ transports 徽章行（`text-[11px] px-2 py-1 rounded-md` accent-blue 系）
- 底部条：`flex items-center gap-2 px-3.5 py-2.5 mt-auto border-t border-border text-[11px]` —— 左来源位（version + repository 短名，对齐 SkillCard 的 SourceLabel 位）+ **指标位（更新时间 / ⭐ stars / ⬇ downloads，数据缺失隐藏）** + 右按钮（未安装 → `Install` primary；已安装 → `Installed` 状态徽章）
- 标题行额外渲染 **`Deprecated` 徽章**（`status === 'deprecated'` 时，`bg-accent-red/12 text-accent-red`）；底部指标位显示 `updatedAt`（`formatDate` → `YYYY-MM-DD`）
- 网格：`p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 content-start` + `role="list"`/`role="listitem"`（与 SkillListSection 完全一致）
- repository 链接（`<button>` 外链，`stopPropagation` 防卡片误触）

**安全警示**（prd 需求 6）：
- `McpMarketplaceContent` 顶部一条警示条（`bg-accent-yellow/10 text-accent-yellow` 或既定 warning token，对照项目既有警示样式）：「MCP servers can execute arbitrary code. Review the generated config before installing.」
- `McpEditorDialog` 在 `mcpDraft` 来源时展示同警示 + secret env 占位（只读提示「startup value required」）。

### 4.6 `McpEditorDialog` 预填

- `openMcpEditor(server)` 扩展为也接受 `mcpDraft`（store 已存 draft，dialog 从 store 读）。
- `McpEditorDialog` 挂载时：若 `mcpDraft` 存在 → `FormState` 由 draft 初始化（name/description/command/args/env/transport；remote 时隐藏命令行区、显示 URL 输入）。
- secret env：draft 中 `isSecret` 的 env 在表单中渲染为「名称 + 占位提示」，值留空；用户必须手动填（非必填的 secret 可跳过）。
- **动态 Config Inputs（P1，评审反馈「按 schema 针对性配置」）**：draft 携带 `inputs: McpRegistryInput[]` 时，在 Env 区块上方渲染「Configuration」动态表单——按 `format`/`choices`/`isSecret`/`isRequired`/`isRepeated`/`default` 生成控件（choices → 下拉；format=boolean → true/false；format=number → number；isSecret → password 占位；default 预填）；值存 `form.inputValues`，保存时非空项合并进 env。inputs 为空时回退现有 env 表单。
- 保存走现有 `createMcpServer`（携带 `sourceRegistry`/`sourceRef`）；成功后清 `mcpDraft`、`setMcpView('installed')` 刷新列表。

### 4.7 `LibraryNavTree` / `LibraryDetail` / `LibraryToolbar` 调整

`LibraryNavTree.tsx`：
- mcp 分支：从「无额外筛选」空态改为 `tree-grp`（`📦 Installed [count]` / `⬇ Marketplace`），与 skills 完全同构；点击 → `setMcpView`；激活态跟随 `mcpView`。
- Installed count：本地 MCP 服务器数（store 或 props 传入）。

`LibraryDetail.tsx`（对照 skill 分支）：
- 搜索行条件：mcp **保留外层搜索行**（placeholder 由 store `mcpView` 决定，见 §4.4）。
- mcp 渲染为 `<McpTabContent />`（内部按 `mcpView` 分支渲染 installed / marketplace）。

`LibraryToolbar.tsx`：
- `deriveSubLabel` mcp 分支：读 `mcpView` → `'Installed' | 'Marketplace'`（面包屑 `MCP / Installed | Marketplace`）。
- mcp marketplace 时 count 徽标：对齐 skill（`activeKind === 'mcp' && mcpView === 'marketplace' && 总数 > 0` 时显示市场项数徽标），数据来自 `useMcpMarketplace` 状态或 store 缓存。
- `renderActionButtons`：`case 'mcp'` 从默认分支拆出 → 渲染 `＋ 新建`（New Server）按钮，**仅 `mcpView === 'installed'` 时显示**（`mcpView === 'marketplace'` 返回 null）。注意 keep prompt/action/command 现有逻辑不变。

### 4.8 组件/交互测试

| 层 | 用例 |
| --- | --- |
| `useMcpMarketplace` hook | 初始加载拉列表；搜索 debounce 调 `searchMcpRegistry`；分页 cursor 推进；`sourceRef` 匹配已安装 |
| `LibraryNavTree` | mcp 分支渲染 tree-grp（Installed/Marketplace）；点击切换 `mcpView`；激活态正确 |
| `McpEditorDialog` | 无 draft 时正常新建；有 draft 时预填 name/command/args/env/transport；secret env 占位不填充；remote 时隐藏命令行；**有 `inputs` 时渲染动态 Configuration 表单（下拉/boolean/number/secret），保存合并进 env；无 inputs 回退 env 表单** |
| `McpMarketplaceContent` | 渲染卡片网格；空态；加载态（初始 spinner / 翻页遮罩）；已安装标记；Install → 打开预填 dialog；**deprecated 卡片显示徽章、指标位显示 stars/downloads/updatedAt** |
| `LibraryToolbar` | mcp 分支 `renderActionButtons` 按 `mcpView` 返回 新建/ null、面包屑按 `mcpView` 变化 |

---

## 5. 不做的改动（范围约束）

- ❌ 自定义 registry URL 配置。
- ❌ MCP 更新检测 / 一键升级。
- ❌ leaderboard / 评分 / installs。
- ❌ 内容区 segmented tabs header（视图切换由侧栏树驱动，不引入 `McpContentHeader`）。
- ✅ 侧栏导航：`LibraryNavTree` mcp 分支改为 tree-grp（Installed / Marketplace），对齐 skills。
- ❌ skills 市场组件改动（`useMarketplace`/`MarketSkillCard` 仅作视觉参照）。
- ✅ transport 扩展 `'http'`（streamable-http 需要）。

---

## 6. 兼容性 / 风险

| 项 | 说明 |
| --- | --- |
| DB 迁移 | v7→v8 仅 ADD COLUMN，向后兼容；旧 `McpServerRecord` 反序列化时 `Option` 字段缺省为 `None` |
| transport 类型扩展 | 前端 union 加 `'http'`；后端 `transport: String` 无破坏；agent 部署侧（`resource_deployer.rs`）对 http 传输的写出逻辑需回归（若仅支持 stdio/sse 需加 `http` 分支或保持跳过并记录） |
| registry preview 不稳定 | 解析容错（`generate_config` 失败降级）+ 5min 缓存 + 前端对缺字段的兜底展示 |
| 跨端契约 | DTO 字段 `camelCase` 双端对齐（`sourceRegistry`/`sourceRef`/`transports`/`generated`）；测试覆盖 |
| 网络不可达 | 命令层返回 AppError，前端显示错误态 + 重试按钮 |

> **待实现阶段确认**：`resource_deployer.rs` 对 `transport == "http"` 的写出行为（现有 deploy 逻辑可能只认识 stdio/sse）。若该文件对未知 transport 会失败，需在 deploy 侧加 `http` 分支或显式跳过并提示；否则保持只读不改。

---

## 7. 参考实现对照

| 参考 | 文件 | 复用什么 |
| --- | --- | --- |
| registry HTTP 客户端 | `src-tauri/src/skill/skillssh_api.rs` | `build_http_client` 模式、blocking reqwest + serde 解析 |
| 缓存 | `src-tauri/src/skill/repository.rs` L408 `get_cache`/`set_cache` | search/fetch 5min TTL 缓存 |
| 命令包装 | `src-tauri/src/skill/commands.rs` skillssh 命令 | proxy 读取、`run_blocking_result` 包裹、DTO 序列化 |
| 市场 hook | `src/features/skill/hooks/useMarketplace.ts` | debounce 搜索、加载/错误态、分页状态 |
| 市场 UI | `src/features/skill/components/MarketplaceContent.tsx` / `MarketSkillCard.tsx` / `Pagination.tsx` / `LeaderboardToggle.tsx` | 布局/卡片/分页/tab 选中态视觉 |
