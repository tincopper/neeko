# 会话管理 — Agent 适配器模式

> 后端用适配器模式统一管理多个 AI CLI Agent 的会话数据。

---

## 1. Scope / Trigger

- **Trigger**: `src-tauri/src/conversation/` 模块（新增）
- **Cross-layer**: Tauri 命令接口，前端通过 invoke 调用

## 2. 架构设计

### 2.1 设计决策：适配器模式

**为什么不用统一格式？** 10 个内置 Agent 各有自己的会话文件格式（JSONL 平铺 / JSONL 树形 / SQLite / 纯 JSON），无法统一解析。

**方案**：`AgentSessionAdapter` trait — 每个 Agent 一个适配器实现，统一对外接口。

模块布局（`mod.rs` 只做声明与 re-export，红线 9）：

```
conversation/text.rs              文本原语：strip_ansi / strip_image_references / truncate（LazyLock 正则）
conversation/normalize.rs         标题/预览净化 + recent_messages_from(_rev)（预览策略归属地）
conversation/adapters/mod.rs      仅 mod 声明 + pub use / pub(crate) use
conversation/adapters/registry.rs all_adapters()（「有哪些适配器」的单一事实源）
conversation/adapters/shared.rs   read_jsonl / parse_timestamp / linearize_tree_entries / message_role / CONVERSATION_ROLES
conversation/adapters/content_blocks.rs  内容块抽取（Anthropic 风格块数组方言）
```

依赖方向单向：`adapters::* → {normalize, text, types}`、`normalize → text`。
**禁止**再次出现 `normalize → adapters` 的反向边（历史缺陷：二者互相引用，文本原语与预览策略错位）。

```rust
pub trait AgentSessionAdapter: Send + Sync {
    fn agent_id(&self) -> &str;
    fn session_root(&self) -> PathBuf;
    fn file_pattern(&self) -> &str;
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta>;
    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>>;
    fn extract_session_id(&self, file_path: &Path) -> Option<String>;
    fn resume_command(&self, native_session_id: &str, project_path: &str) -> Option<Vec<String>>;

    // 删除能力（§4.7）：默认 fail-closed，新增 adapter 不表态 = 不提供入口
    fn delete_support(&self) -> SessionDeleteSupport;                       // 默认 Unsupported
    fn delete_command(&self, id: &str, project: Option<&str>, f: &Path) -> Option<Vec<String>>;  // Native 用
    fn delete_targets(&self, file_path: &Path, native_session_id: &str) -> Vec<PathBuf>;        // Storage 用
}
```

### 2.2 设计决策：无持久化，只在内存缓存

**为什么不用 SQLite？** Agent 原生文件本身就是 Source of Truth，Neeko 只做浏览/索引，不存储完整数据。元数据只在内存 HashMap 中，进项目时重新扫描。

```rust
// ConversationManager 的核心数据结构
cache: Mutex<HashMap<String, ConversationMeta>>,   // key = "{agent_id}:{native_id}"
```

### 2.3 设计决策：parse_meta / parse_messages 分离

- `parse_meta()` — 列表展示用（标题 / 预览 / 计数 / 时间 / 模型）
- `parse_messages()` — 用户点击查看时按需调用，读完整文件

**成本约束（真实实现，勿照抄「只读头部」）**：`parse_meta` 通过 `read_jsonl` 读**整个文件**
（受 `scan_cache` 按 mtime/增长命中缓存），因此它的成本上限必须靠「不做事」守住：

| 需要的量 | 允许的做法 | 禁止 |
|---|---|---|
| 计数 | `content_blocks::has_visible_text`（O(1)/条，不建块） | 逐条 `extract_message_content` 后丢块 |
| 标题（P3 首条用户消息） | 只对 `role == "user"` 的记录抽取 | 遍历全量抽取 |
| 预览（最近 5 条） | `normalize::recent_messages_from_rev` + 反向惰性迭代，凑满即停 | 先物化全量 `(role, text)` 再裁剪 |

**缓存指纹必须覆盖 SQLite 侧文件**（2026-10-30 事故）：`opencode.db` 是 WAL 模式，新提交先落
`opencode.db-wal`，主文件在 checkpoint 前 `(len, mtime)` 不变 ⇒ 只看主文件的 `source_signature`
会让批量元数据缓存返回旧快照，表现为「新会话不出现，重启才恢复」。opencode 适配器因此用
`scan_cache::source_signature_with_sidecars(path, &["-wal"])`（`len` 求和、`mtime` 取最大；
侧文件缺失时与原函数一致）。**新增任何 SQLite 源都要照此传 `-wal`**。

正文分页（§4.6.4）另有一条成本约束：`get_messages_page` 通过单槽缓存
（`CachedTranscript`，以文件长度 + 修改时间失效）保证**整段会话只解析一次**；
否则每一页都重读整份文件（实测 4293 条会话 7 页 = 3.7s，对比单次解析 0.5s）。

事故（2026-10）：Pi 适配器修复后一度在 `parse_meta` 里对每条消息做全量抽取并克隆整段正文，
266 个会话的列表扫描从 7.9s 退化到 26–30s（3.3×）；按上表改回惰性路径后为 5.8s。

## 3. 签名

### 3.1 Conversation ID 约定

```
{agent_id}:{native_session_id}
    ↑            ↑
  对应 AgentConfig.id  Agent 自身的 session ID
```

示例：`claude-code:550e8400-e29b-41d4-a716-446655440000`

该 ID 用于：
- HashMap 的 key
- `get_messages()` 路由到对应的 adapter（通过 agent_id 前缀）
- 前端传递的唯一标识

### 3.2 Tauri 命令签名

```rust
// 扫描会话
#[tauri::command]
fn scan_conversations(
    agent_id: Option<String>,              // None = 扫描所有 agent
    state: State<AppStateWrapper>,
) -> Result<Vec<ScanReport>, AppError>;

// 列出会话（从缓存读取；limit=0 表示返回剩余全部）
#[tauri::command]
fn list_conversations(
    scope: ConversationListScope,          // 范围：{kind:"project",path} | {kind:"unit",workspace}
    agent_id: Option<String>,              // 过滤 agent
    offset: Option<u32>,
    limit: Option<u32>,
    state: State<AppStateWrapper>,
) -> Result<ConversationListPage, AppError>;   // { items, total, offset, limit, has_more }

// 获取一页正文（红线 4：单次载荷 ≤2MB）
#[tauri::command]
fn get_conversation_messages(
    id: String,                            // "{agent_id}:{native_id}"
    offset: Option<u32>,                   // 省略 = 从头
    from_end: Option<bool>,                // true 时 offset 表示「跳过末尾多少条」（正文视图取尾页）
    state: State<AppStateWrapper>,
) -> Result<ConversationMessagePage, AppError>;   // { items, total, offset, limit, has_more }

// 正文统计（工具调用清单 / thinking 计数）；前端不再为计数持有全量正文
fn get_conversation_stats(id) -> Result<ConversationStats, AppError>;

// 正文内搜索：只回传 { seq, role, snippet }（≤200 条），视图按 seq 加载定位页
fn search_conversation_messages(id, query) -> Result<Vec<ConversationSearchHit>, AppError>;

// 搜索（空 query 返回空结果）
#[tauri::command]
fn search_conversations(
    query: String,
    project_path: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<Vec<ConversationMeta>, AppError>;

// 更新元数据（仅内存）
#[tauri::command]
fn update_conversation(
    id: String,
    user_title: Option<String>,
    tags: Option<Vec<String>>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError>;

// 获取恢复命令
#[tauri::command]
fn get_resume_command(
    id: String,
    state: State<AppStateWrapper>,
) -> Result<Option<Vec<String>>, AppError>;

// 整段会话以 Markdown 直接写入系统剪贴板（返回字符数；不经 IPC 回传正文）
fn copy_conversation_markdown(id) -> Result<u32, AppError>;

// 删除一条会话：**只收 id**，路径由后端从自己的缓存解析（§4.7）
fn delete_conversation(id) -> Result<(), AppError>;
```

### 3.3 数据结构

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMeta {
    pub id: String,                        // "{agent_id}:{native_id}"
    pub native_session_id: String,
    pub agent_id: String,
    pub title: String,
    pub started_at: i64,                   // Unix 毫秒
    pub updated_at: i64,
    pub message_count: u32,                // 正文视图可见的回合数（见 §4.6 口径）
    pub preview: String,                   // 最近 5 条消息拼接（每条 ≤220 字符）
    pub file_path: PathBuf,                // Agent 原生文件绝对路径
    pub project_path: Option<String>,
    pub user_title: Option<String>,
    pub tags: Vec<String>,
    pub model: Option<String>,
    pub supports_resume: bool,             // Resume 按钮显隐依据（§4.3）
    pub delete_support: SessionDeleteSupport,  // 删除入口显隐依据（§4.7，默认 Unsupported）
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub role: String,                      // "user" | "assistant"（正文视图角色白名单）
    pub content: String,                   // 拍平后的纯文本（标题/预览/导出同源）
    pub blocks: Vec<MessageBlock>,         // text / thinking / toolUse / toolResult，供块级渲染
    pub model: Option<String>,             // 消息级模型（会话中途可切换）
    pub timestamp: i64,
    pub seq: u32,                          // 树线性化序号；过滤后**可能不连续**，仅作渲染 key
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReport {
    pub agent_id: String,
    pub sessions_found: u32,
    pub errors: Vec<String>,
}
```

## 4. 合约

### 4.1 扫描流程

```
scan_all() → for each adapter:
  walkdir(session_root, file_pattern)
    → extract_session_id(file)
    → parse_meta(file)
    → cache.insert("{agent_id}:{native_id}", meta)
```

- `session_root` — 各 adapter 返回的路径（如 `~/.claude/projects/`）
- `file_pattern` — glob 模式（如 `**/*.jsonl`）
- `parse_meta` 失败 → 跳过该文件，错误记录到 `ScanReport.errors`

### 4.2 消息路由

```
get_messages(conversation_id) → split(':') 取 [0] 为 agent_id
  → find adapter by agent_id
  → adapter.parse_messages(file_path)
```

### 4.3 恢复命令路由

```
get_resume_command(conversation_id) → split(':') 取 [0] 为 agent_id
  → find adapter by agent_id
  → adapter.resume_command_for_file(native_id, project_path, file_path)
       （默认委托 resume_command；需要绝对 transcript 路径的 Agent 覆盖此方法）
  → None = 不支持原生恢复 → 前端隐藏 Resume（不注入上下文、不降级 bare launch）
```

`ConversationMeta.supports_resume` 在扫描时根据 `resume_command_for_file(...).is_some()` 写入，供 UI 判断。  
探测与 `get_resume_command` 必须使用同一入口，避免 `supports_resume=true` 但实际 resume 为 None。

### 4.3.1 file_pattern 与嵌套扫描

- `file_pattern` 相对 `session_root` 匹配。
- 不含 `/` 且不以 `**/` 开头的 basename 模式由 Manager 自动加 `**/` 前缀（如 `rollout-*.jsonl` → `**/rollout-*.jsonl`）。
- `**/` 在 regex 中匹配 **零段或多段**路径前缀，因此顶层与嵌套文件均可命中。
- 扫描 0 会话但根下存在文件时写入 `log::warn` 与 `ScanReport.errors` 提示。
- 适配器对噪声文件使用 `bail!("skip: …")`；Manager 静默跳过，不写入 `ScanReport.errors`。
- Launch 注册表（`AgentManager::default_agents`）与 History 注册表（`all_adapters`）分离；每个 adapter 的 `agent_id` 必须能在默认 AgentConfig 中找到（registry 测试守护）。

### 4.3.2 常见 Agent 存储与解析陷阱

| Agent | 主存储 | 详情/Resume 注意 |
|-------|--------|------------------|
| Codex | `~/.codex/sessions/**/rollout-*.jsonl`；`$CODEX_HOME` 优先 | 现代消息在 `response_item.payload.content[{type:input_text\|output_text,text}]`，不是 `delta`/`transcript`。标题：meta → `session_index.jsonl` → 首条真实 user。过滤 worker/subagent。 |
| Reasonix | 列表：`~/.reasonix/projects/**/sessions/*.jsonl` | **多轮正文在兄弟文件 `*.events.jsonl`（replace/append）**；主 jsonl 常为 stub。Resume：交互式 `reasonix --dir <cwd> --resume <path\|id>`（需 TTY）；`run --resume PATH` 是一次性任务模式，History 不要用。 |
| OMP | `~/.omp/agent/sessions/<sanitized>/*.jsonl` | 仅主会话深度（`<sanitized>/<file>.jsonl`），排除 session 子目录 trace。标题来自 `type:"title"` 行。`message.content` 为块数组；工具结果独立成 `role:"toolResult"` 记录，另有 `developer` / `bashExecution` 噪声行。 |
| Grok | `~/.grok/sessions/<urlenc-cwd>/<uuid>/summary.json` | 消息来自 sibling `updates.jsonl` 分块合并。 |
| OpenCode | `~/.local/share/opencode/opencode*.db`（SQLite，WAL） | **两套布局共存**：v1 = `session`/`message`/`part`，v2 = `session_v2`/`session_message`。判据见 §4.3.3。会话标识是合成路径 `<dbPath>#<sessionId>`，不是真实文件。 |
| Pi / Claude | 嵌套 jsonl | 依赖 L0 自动 `**/`；勿写仅顶层的 basename pattern 而不测 WalkDir。**Pi：`message.content` 恒为块数组**（text / thinking / toolCall / image），session 头部**从不写 name/title**（标题只能靠 P3 首条用户消息），工具结果独立成 `role:"toolResult"` 记录。 |

### 4.3.3 opencode v1/v2 双存储（判据 = 表状态，不是版本号）

opencode 2.x 起把会话写进 `session_v2` + `session_message`，旧表 `session`/`message`/`part`
变成**迁移快照**（升级那一刻复制一次，之后不再写入）。两者在同一个 `opencode*.db` 里共存，
所以「读哪套」必须由表状态判定 —— Neeko 不持有 opencode 版本事实，`OPENCODE_CONFIG_DIR`
也可能指向旧库，按版本号分支只会把「agent 内部实现」写进通用模块（红线 10 的同源风险）。

文件布局（每个文件都在 300 行内，实现 / SQL / 内容映射 / 夹具分开）：

```
adapters/opencode.rs          adapter trait 实现 + 布局分派（read_db）
adapters/opencode/common.rs   两套布局共享的常量与小工具（合成路径、预览条数、时间戳、model JSON）
adapters/opencode/store.rs    布局判定 + 只读打开 + WAL 侧文件指纹
adapters/opencode/v1.rs       v1 读取（列表 / 计数 / 预览 / 单会话 meta）
adapters/opencode/v1/messages.rs  v1 正文解析（message JOIN part）
adapters/opencode/v2.rs       v2 入口（列表 / 单会话 meta / 正文）
adapters/opencode/v2/query.rs v2 的 SQL 层（列表 / 计数 / 预览 / 首条用户消息）
adapters/opencode/v2/blocks.rs v2 的 content[] → 文本 + 块映射
```

判据（`adapters/opencode/store.rs`）：`session_v2` **与** `session_message` 都存在
**且 `session_v2` 有行** → v2，否则 v1。两侧最坏情况都只能是「显示旧数据」：

| 库状态 | 判定 | 理由 |
| --- | --- | --- |
| 只有 v1 表 | V1 | 未升级的库 |
| v2 表已建但空（迁移未跑完） | V1 | 判 v2 会把历史整体隐藏 |
| v2 表有行 | V2 | 唯一还在被写的布局；v1 表只是快照 |

同一 DB **只读一套**，不合并：混读会复活 v2 已删的孤儿会话，且计数与正文来自不同来源。

事故形态（2026-10-30）：升级 5 周后 Neeko 仍只显示 09-28 之前的历史（旧表冻结在 10-23，
新表已到 10-30）；实测 `/…/neeko` 目录 v1 157 条 vs v2 227 条。同一事故还有一个独立成因：
`opencode.db` 是 WAL 模式，指纹只盯主文件 ⇒ 批量元数据缓存命中旧快照（见 §2.3 末段）。

v2 行模型（`v2.rs`）：`session_message.type` 列 + `data` JSON ——

| `type` | `data` | 是否对话回合 |
| --- | --- | --- |
| `user` | `{text, time.created, files?, metadata?}`（`text` 平铺） | 是 |
| `assistant` | `{content:[{type:text\|reasoning\|tool}], model{id,…}, time.created}` | 是 |
| `system` / `synthetic` / `compaction` / `idle` / `model-switched` / `agent-switched` / `location-switched` | 各自的元数据 | 否 |

块映射与 v1 的 part 同形：`text`→`Text`、`reasoning`→`Thinking`、`tool`→`ToolUse`
+ completed（`state.content[].text` 拼接）或 error（`state.error`，`is_error=true`）的
`ToolResult`。预览只取文本项（工具输出、thinking 不进预览，红线 4）。
`session_v2.title` **可空**（实测 7/746）⇒ 靠首条用户消息兜底。兜底素材必须是**真正最早的
用户回合**（`ORDER BY seq ASC LIMIT 1`，绑定参数传角色，不要拼 `"user"` —— SQLite 的双引号
是标识符引号，只靠已弃用的 DQS 回退才当字符串），**不能**从预览窗口（最近 5 个回合）里找：
实测 `ses_e8a035681…` 有 3 条 user、最近 5 回合一条都没有，从窗口里找会退化成 `opencode <id8>`。
v1 读取器仍从预览窗口取（历史行为，`title` 列 NOT NULL 时几乎不触发），属已知差异。

**计数判据 = 类型白名单，不是「有没有可见文本」**：`json_extract(data,'$.content')` 对 27k 行
大 JSON 实测 **9.9s**（列表扫描会卡死），按类型走 `(session_id, type, seq)` 索引 **0.018s**。
代价是 `content` 为空的 assistant 行（中断回合，实测 288/24734、涉及 127 个会话）也算一个回合，
换来的是计数与正文**天然同源**（同一常量派生的同一 SQL 过滤，不存在两套口径漂移）。
这类空回合在前端渲染时被 `ConversationViewer` 的 `hasAnyContent` 跳过（看不到空卡片），
所以实际差异只是「徽标比 v1 多算这一小类」。

白名单本身**不新开常量**：直接复用 `shared::CONVERSATION_ROLES`（§4.6.2 的单一来源），
`turn_types_in(column)` 从它生成 `type IN ('user','assistant')`。

真机验收入口：`adapters/opencode/tests/real_db.rs::real_opencode_database_reads_through_the_detected_layout`
（`#[ignore]`，`cargo test --lib real_opencode -- --ignored --nocapture`）—— 在真实库上验判据选中的路径、
徽标与正文条数相等、合成路径可用；布局无关，v1 库与 v2 库都能跑。

预览另有一条不能省的细节：v1 把 `part.type='text'` 压进 SQL 再 `LIMIT 5`，所以稳定拿满 5 条；
v2 只能在 Rust 侧过滤，因此窗口必须放大（`PREVIEW_LIMIT * 3` + 凑够即停 + 反序），
否则最近 5 个回合全是工具/思考时预览会变短甚至为空（实测 686 个会话中 621 个不足 5 条、15 个为空）。

### 4.4 搜索行为

- `query` 为空字符串 → 返回空结果
- `query` 非空 → 在缓存的 `title` 和 `preview` 中进行模糊子串匹配
- 区分大小写

### 4.5 会话过滤（两种范围，互斥且不可混用）

会话的 `project_path` 是 agent 的 **cwd**，所以「按路径过滤」有两种语义，取决于调用方要的是
项目还是 Workspace 单元。**范围是单值判别联合**（`ConversationListScope`），不是两个可选参数：

- **项目级** `{kind:"project", path}`（History 面板）：前缀包含 —— 保留
  `ConversationMeta.project_path` 等于该项目根**或其后代**的会话；缺 `project_path` 的会话排除。
  （面板当前传的是 `worktreePath ?? project.path`，即「当前单元路径」；既有行为，与「整个项目」
  只在主 checkout 视图重合。）
- **单元级** `{kind:"unit", workspace}`（agent-chat 恢复列表）：**最深根胜出**
  （`common/git/unit_scope.rs`）。根清单 = 本单元根 + 同项目其它 linked worktree 根
  （`git worktree list`）；会话归属最深命中的那个根。

**为什么是判别联合而不是「两个可选过滤参数 + 谁优先」**：后者允许调用方同时传两个维度、后端
静默丢掉一个 —— 那正是「本来要单元、结果按项目过滤」的入口（同类形态已在本仓发生过两次）。
两个变体各自必填（`path` / `workspace`），「没有地址的单元级请求」在反序列化阶段就失败。
护栏：判据 **G**（命令签名出现 `Option<WorkspaceSession>` 必须进
`ledger/optional_workspace_commands.json` 说明理由；当前台账为空 = 全仓没有可选地址）。

**哪些布局会让两个根重叠**（决定「最深根胜出」是否真的必要）：

| 布局 | 位置 | 前缀包含够不够 |
| --- | --- | --- |
| **默认** | `~/.neeko/worktrees/<name>`（项目根**之外**，见 `common/git/path_guard.rs`） | 够 —— 两根互不包含；此时真实缺陷是「单元自己的会话匹配不到项目根 ⇒ 列表漏」 |
| 用户约定 | `<project>/.worktrees/<name>`（`git/commands/worktree.rs` 点名支持） | **不够** —— worktree 会话同时命中主仓根 ⇒ 两个单元互相串门 |
| 嵌套 | worktree 里再开 worktree | **不够** —— 同上，且更深者必须胜出 |

**为什么两套语义都必须保留**：History 面板要的是「整个项目的历史」，把项目级改成单元级会让它在
worktree 视图里丢掉主仓历史；恢复列表要的是「这个执行上下文的历史」，用项目级会把另一个 cwd 的
会话端上来 —— 而续写通道建立在当前单元，agent 的原生 resume 会因为 cwd 不一致直接拒绝
（pi / opencode 实测）。

**前端侧**：`useChatRestore` 只发 `{kind:"unit", workspace: WorkspaceSession.of(...)}`
（地址铸造点，不自拼路径 —— 红线 12），不再附带 `project.path`。

**已知前提（不是 bug）**：恢复列表只 `list` 不 `scan`，单元内会话能出现的前提是**该单元的编码
目录已被扫过** —— History 面板按当前单元路径扫描（pi / claude / omp / reasonix 的
`discovery_roots` 按 `project_path` 收窄），或某次全量扫描覆盖了它。所以「worktree 单元列表为空」
先查扫描覆盖，再查过滤。

## 4.6 内容块契约与视图口径（强制）

会话正文的解析与展示有三条硬约束，违反会导致「列表徽标 / 预览 / 正文」互相矛盾。

### 4.6.1 内容抽取只有一个实现

`message.content` 可能是**字符串**，也可能是**块数组**（text / thinking / toolCall / tool_result / image）。
所有适配器统一走 `adapters/content_blocks.rs`，禁止各自实现形态判断：

```rust
let rich  = extract_message_content(entry); // → MessageContent { text, blocks }
let light = has_visible_text(entry);        // 只回答「这条算不算一条对话消息」，不建块
```

- `text`：标题（P3）、预览、Markdown 导出；`blocks`：前端块级渲染（思考折叠 / 工具卡片）。
- 方言差异（块 `type` 别名、tool 入参 `input` vs `arguments`）**只允许**改
  `content_blocks::block_kind` / `tool_input`；新增同类 agent 只加别名。
- `has_visible_text` 与 `extract_message_content` 必须等价（`should_agree_with_full_extraction` 守护）；
  轻量版存在的唯一理由是 `parse_meta` 的成本约束（§2.3）。
- `tool_result` 只映射为结构化块，**不并入** `text`：工具输出体量不可控（红线 4），
  也不该在正文里冒充用户发言。

**例外（opencode v1/v2，2026-10-30 登记）**：opencode 的 `part` / `content` 项里，工具是
**一个元素同时携带调用与终态**（`{type:"tool", id, name, state:{status,input,content[]|error}}`），
要拆成 `ToolUse` + `ToolResult` **两个**块；而 [`content_blocks`] 的模型是「一个 part → 至多一个块」
（`block_kind` 方言表 + `block_from_part`）。硬塞进去要改 pi / claude / omp / codex 共用的表，
收益为零、回归面是全部适配器 ⇒ opencode 的两个读取器各自实现这段映射（v1 的 `"tool"` 分支与
`v2/blocks.rs::push_tool_blocks`），**只允许在这两处**扩方言。将来若有第三个 agent 也「1 元素 → 2 块」，
再把 `content_blocks` 的返回类型改成 `Vec<MessageBlock>` 一并收敛。

### 4.6.2 视图角色白名单

`shared::CONVERSATION_ROLES = ["user", "assistant"]`。工具结果与系统注入记录
（Pi `toolResult`、OMP `toolResult` / `developer` / `bashExecution`）**不进正文、不进预览、不计数**。

### 4.6.3 三个用户可见量必须同源

| 量 | 口径 |
|---|---|
| `ConversationMeta.message_count` | 正文可见回合数（角色白名单 + 有可见正文） |
| `ConversationMeta.preview` | 同一集合的最近 `PREVIEW_MESSAGE_LIMIT` 条 |
| `ConversationMessage[]` | 同一条过滤规则（`parse_messages`） |

实测校验方式：对全部会话断言 `meta.message_count == get_messages(id).len()`。

**合规现状（2026-10 真实会话核对，勿假设全仓已满足）**：

| Adapter | 不一致会话 / 总会话 | 计数来源 |
|---|---|---|
| pi | 0 / 266 | 角色白名单 + `has_visible_text` |
| omp | 0 / 122 | 同上 |
| claude-code | 0 / 175 | `recent_pairs.len()` |
| codex | 0 / 119 | `collect_codex_messages().len()`（与 `parse_messages` 同一次遍历） |
| opencode v1 | 0 / 399 | 一次分组聚合 `count_messages_per_session`（含「必须有 part」条件） |
| opencode v2 | 0 / 686（真机逐会话核对 count == parse_messages().len()） | 同一分组聚合，按 `TURN_TYPES` 类型白名单（§4.3.3） |
| reasonix | 0 / 21 | `collect_reasonix_messages().len()`（与 `parse_messages` 同一次遍历） |

新增适配器**必须**满足该规则：`message_count` 只能取自 `parse_messages` 的**同一遍历/同一 SQL 条件**，
并补一条 `message_count == parse_messages().len()` 的夹具断言。

### 4.6.4 正文载荷边界（红线 4）

`get_conversation_messages` 返回 `ConversationMessagePage`，每页由 manager 按
「≤800 条 / ≤1.5MB 序列化字节」切分，且**至少 1 条**（超大单条消息不会让 offset 卡死）。
- **正文视图（ConversationViewer）真正按需加载**：首屏只取尾页（`fromEnd: true`），向上点
  「Load older messages」再取更早的页；窗口外的跳转（搜索命中 / 工具调用）按 `seq` 取定位页。
  前端常驻内存 = 已加载窗口，而不是整段会话。
- **依赖全量的四件事已移出视图**：统计 → `get_conversation_stats`；会话内搜索 →
  `search_conversation_messages`；整段复制 / 导出 → `copy_conversation_markdown`（Rust 直写剪贴板）。
- `conversationApi.getConversationMessages(id)` 仍保留「整段会话」签名（逐页组装），
  供真正需要完整历史的调用方（如 agent-chat 会话恢复）使用。

事故背景：修复前单命令返回全量正文，最大会话 4293 条消息序列化 8.7MB。

### 4.6.5 标题素材的净化（2026-11-10 起归标题域）

图片引用（`[Image #1]`、`[[Image #1]](file:///…/blobs/<sha>.png)`）、隐藏块
（`<system-reminder>` 等）、HTML 注释、harness 套话前缀都不是语义文本，由
**`common::agent::transcript_noise`** 统一剥离（词表 + 实现各一份）。两个消费者共用它：
`title::clean`（标题，`admit` 的第一步）与 `normalize`（预览）。标题特有的那一步（前导
markdown 标记）留在 `clean`。适配器只提供原文，不做展示决策。

**不要**在这里再写一份隐藏块/图片词表：两份手抄曾各自漂移，其中一份手写扫描器把
`to_lowercase()` 的字节偏移用在原文上，遇到 `İ` / `ẞ`（小写展开改变字节数）会 panic
或静默吃掉正文（2026-11-10 实测，已由正则实现取代）。

`conversation::normalize` 现在只剩 **Preview** 目标（列表预览用）：Title 目标已删除，
避免「同一份文本两套净化管线」（旧 Title 目标会把 markdown 标记剥掉、Preview 不剥）。

**fixture 必须与真实磁盘格式一致**：用字符串写 `content` 夹具会让「只兼容字符串」的实现全绿，
从而掩盖真实格式缺陷（Pi 曾因此把标题退化成 `pi <id8>`、正文解析成 0 条消息）。

### 4.6.6 工具调用摘要的双实现

侧边栏要展示「哪个命令 / 哪个文件」，但这些摘要来自**后端统计**（不回传入参载荷，
因为 `Write` 的入参可能是一整个文件）。因此同一规则有两份实现：

- Rust `manager::tool_call_summary` —— 侧边栏用（`ConversationStats.toolCallList[].summary`）；
- TS `utils/toolPresentation.getToolSummary` —— 消息块内渲染用（手上有真实 `input`）。

两者都按「路径 / 命令 / pattern 优先，其余截断序列化」取值，各自的测试必须同步更新；
新增工具名时**两边都要加**，否则侧边栏会退化成序列化预览。

### 4.6.7 会话标题是 live-sessions 的权威源之一（纯内存回落）

`ConversationMeta.title` / `user_title` 不只是 History 面板的展示数据，也是 live-sessions
注册表的**权威标题源**：CLI hook 没带 `topic` 且 registry 尚无真标题时，
`live_sessions::wiring::hooks` 会按 `agent_id:native_session_id` 读它，投影成
`TitleSource::Native`。缓存只用来补空名，不覆盖已有的事件时刻标题。

为此 `ConversationManager::cached_title_for_native(agent_id, native_session_id)` 提供一条
**纯内存**读路径：按缓存键 `format!("{agent_id}:{native_session_id}")` 查 `self.cache`，
`user_title` 优先于 `title`，trim 后空白 ⇒ `None`；锁错误与 `list_page` 同口径
（`anyhow!("Cache lock poisoned: {e}")`）。

三条硬约束：

1. **不触发扫描、不读磁盘**（红线 3）：hook 跑在阻塞池线程上，`scan_*` / `hydrate_*`
   一律不在这里调用。缓存新鲜度由既有 conversation scan 链路负责；没扫过就返回 `None`
   （会话保持占位，不猜）。未命中记一条 `log::debug!`（`no cached title for
   <agent>:<native>`）—— 回落是**机会性**的，排障时需分清「没命」与「没调」。
   注意 ID 契约：这里的 `native_session_id` 必须与 hook 的
   `HookEvent.agent_session_id` **同源同名**（同一 provider 的会话 uuid）。二者不等价时
   回落会静默失效（表现为会话永远拿不到 provider 标题）——新增 adapter 必须确认这一点。
2. **终端 I/O 不是通用标题源**（第 35 / 37 轮）：OSC `onTitleChange` 已整条断开；
   `term.onData` 的行只对**纯 shell** 生效（`Registry::report_terminal_input` 按
   `agent_id` 裁决）。agent 会话的标题只能来自用户改名、hook `topic`、这里的 provider
   title、chat 真实 prompt。改名的 `User` 级别最高；`Native` 回落只在条目无真标题时生效，
   避免扫描快照把已有的 `hook topic` / `User` 标题改回旧值。
3. **不进 wire 契约**：该方法只被 hook 投影调用（Rust 内部），不暴露成 Tauri 命令，也
   不新增事件 / 定时器 / 磁盘轮询。

### 4.7 删除能力三态与删除单元（强制）

会话数据的**拥有者是各个 agent CLI**，Neeko 只有内存索引（§2.2）。所以删除必须由拥有者执行：
绕过 CLI 直接删文件会留下陈旧索引 / 孤儿行，而且**不报错**。由此推出三态能力，不是 bool：

```rust
pub enum SessionDeleteSupport { Native, Storage, Unsupported }  // serde: "native"|"storage"|"unsupported"
```

| 态 | 含义 | 判据 |
| --- | --- | --- |
| `Native` | 委派 agent 自己的 CLI | **CLI 删的就是 Neeko 列出的那一条**（同一处存储） |
| `Storage` | adapter 删这条会话独占的存储单元 | 无二级索引、不与其它会话共享 |
| `Unsupported` | 无安全路径 → UI 不显示入口 | 表里没有可靠答案时的**默认值** |

**委派必须带上 CLI 的「非交互」旗标**（2026-10-30 实测）：`codex delete <uuid>` 在无 TTY 时
直接失败 —— `cannot confirm session deletion without an interactive terminal; rerun with --force
and a session UUID`。Neeko 是 headless 调用（确认由自己的对话框负责），所以 argv 必须带 `--force`；
而 `--force` 要求 `SESSION` 是 **UUID** —— codex 的 `native_session_id` 由
`rollout-<ts>-<uuid>.jsonl` 的文件名提取，天然满足。**新接一个 Native agent 时先在无 TTY 环境跑一次，
把它的旗标要求写进 adapter 的 argv 与测试**，否则「每条会话都删不掉」只在用户点击时暴露。

**「有命令」≠「该委派」**：qoder 有 `--delete-session <index>`，但 CLI 用 `~/.qoder/`、Neeko 读
`~/.qodercli/projects/` —— 委派就是删别人的数据；它按**索引**寻址也会随删除漂移 ⇒ `Storage`。

删除单元（`delete_targets`）由存储形态决定，**不许写 `agent_id == …` 分支**（红线 10）：

| Agent | 态 | 删除单元 |
| --- | --- | --- |
| codex | Native | `codex delete --force <uuid>`（它维护 `session_index.jsonl`） |
| opencode | Native | `opencode session delete <id>`（SQLite 行 + 子会话级联；v2 删的是 `session_v2`，所以 §4.3.3 判成 v2 才谈得上「删的就是列出的那条」） |
| claude-code / gemini / qoder / codebuddy | Storage | 会话 `*.jsonl` / `*.json` 单文件 |
| pi | Storage | 会话 `*.jsonl`（**`~/.pi/agent/blobs/**` 永不删**：内容寻址、跨会话共享） |
| omp | Storage | 主会话 `*.jsonl`（附属 trace 子目录不在本期单元内） |
| grok | Storage | 会话**目录**（`summary.json` + `updates.jsonl`） |
| reasonix | Storage | `<id>.jsonl` + `<id>.events.jsonl` + `<id>.jsonl.meta` |

契约（缺一即「声明了没人实现」，红线 14 形态）：
`Native ⇒ delete_command() 非空`；`Storage ⇒ delete_targets() 非空且每个目标都在 `session_root()` 之内`。
`adapters/registry.rs` 的台账用例要求**注册表里的每个 adapter 都在表里表态**（新增 agent 忘表态 → 红）。

执行序（`ConversationManager::delete`，命令层只做 `id` 校验 + 调度）：

1. id → 缓存 meta；不存在 → `AppError::NotFound`，**不触盘**（前端永远不能指定路径）；
2. 防线：`meta.file_path` 与每个 target 必须落在该 adapter 的 `session_root()` 之下
   （词法 `starts_with` + 拒绝 `..`；`path == root` 也算越界）→ 否则 `AppError::InvalidInput`；
3. `Native` → `core::exec::run`（红线 1/2），非零退出 → `AppError::Agent(stderr 尾部 ≤400B)`，
   起不来 → `AppError::Io`；成功后弃 `scan_cache` 的该路径 + 全部 bulk 快照（CLI 改了自己的库）；
4. `Storage` → `common::file::services::delete_path`（Local `spawn_blocking` = 红线 3，
   且自带 canonicalize 逃逸校验）；**缺失目标跳过**（兄弟文件缺失是常态），真实 IO 错误中止并在
   错误里列出「已删哪些」；
5. **成功之后**才 `cache.remove` + 丢弃单槽正文缓存（失败不乐观移除）；
6. 冷启动索引由命令层 `persist_disk_index()` 刷新（与 `update_conversation` 同一模式），失败只 warn。

UI 侧（R5）：`delete_support !== 'unsupported'` 才出现删除按钮；点击先判「是否**活的 chat 会话**占用」
（agent-chat tab 的 `resumeConversationId` / `resumeNativeSessionId` / `sessionId`），命中则提示
「先关闭该会话」；否则确认框展示 agent · 标题 · 将发生什么（`native` = 委派 CLI；`storage` = 具体路径）
→ 成功才本地移除行，并关掉指向它的只读查看器 tab。

> **只读查看器 tab 不算「使用中」**（2026-10-30 实测事故）：面板里点一行即打开查看器，把它判成占用
> 会让「点开 → 删除」100% 被挡 —— 删除功能实际不可用。占用判定只对「可能有进程正在写该会话文件」
> 的活 chat 会话成立。

## 5. 错误边界

| 场景 | 行为 |
|------|------|
| adapter `parse_meta` 失败 | 跳过该文件，记录到 `ScanReport.errors`，不阻断扫描 |
| adapter `parse_messages` 失败 | `get_conversation_messages` 返回 `AppError` |
| adapter ID 不存在 | `get_messages` / `get_resume_command` 返回 `AppError::NotFound` |
| 文件被删除/不存在 | `parse_messages` 返回 IO 错误，转换为 `AppError` |
| 删除不存在的 id | `delete_conversation` 返回 `AppError::NotFound`，不触盘 |
| 删除路径越界（缓存被污染） | `AppError::InvalidInput`，不执行任何删除 |
| 删除能力 `Unsupported` | `AppError::Unsupported`（UI 正常不显入口，命令层仍拦） |
| 委派 CLI 非零退出 | `AppError::Agent`，带 stderr 尾部；缓存与列表**不**移除 |
| 委派 CLI 起不来 | `AppError::Io`（环境问题，与「CLI 说删不掉」区分） |
| 空适配器列表（scan_all） | 返回空 Vec，不报错 |
| 缓存空（先 list 再 scan） | `list_conversations` 返回空 Vec |

## 6. 测试要求

### 6.1 TestAdapter（单元测试用）

```rust
// manager.rs 中的测试适配器
struct TestAdapter { agent_id: String }

impl AgentSessionAdapter for TestAdapter { ... }
```

使用 JSONL fixture 文件（每行 `{"role":"...","content":"...","timestamp":...,"seq":...}`）

### 6.2 断言点

- `scan_all` 返回的 `ScanReport.session_found` 正确计数
- `list` 按 `started_at` 倒序排列
- `list(project_path="test")` 只返回匹配的会话
- `get_messages` 返回的消息顺序与 seq 一致
- `search("")` 返回空
- `get_resume_command` 返回 `Some` 或 `None`
- `export_markdown` 输出的消息顺序正确

删除能力（§4.7）的必测点：

- 契约：`Native ⇒ delete_command` 非空；`Storage ⇒ targets 非空且都在 `session_root` 内`；
  registry 台账覆盖每个 adapter（新增 agent 忘表态 → 红）；
- 纯函数：`delete_targets` 的形态（grok 目录 / reasonix 文件对 / 默认单文件）、`delete_command` 的 argv；
- manager（tempdir 夹具，红线 13）：不存在的 id 不触盘、缓存路径越界被拒、单文件 / 多目标 /
  兄弟文件缺失时跳过、删后 cache 与正文缓存都查不到；
- 委派路径**不真跑 codex/opencode**（不可逆）：用假二进制断言 argv 送达与错误分支
  （不存在二进制 → `Io`；非零退出 → `Agent` 且含 stderr）。

## 7. 错误 vs 正确

### 错误：试图统一所有 Agent 格式

```rust
// ❌ 错误：所有 Agent 共用一个 JSONL 格式
pub struct Session {
    id: String,
    agent_id: String,
    messages: Vec<Message>,
    // ...
}
```

### 正确：适配器模式

```rust
// ✅ 正确：每个 Agent 有自己的适配器
// Claude Code: ~/.claude/projects/*/*.jsonl（树形 JSONL）
// Codex CLI: ~/.codex/sessions/**/rollout-*.jsonl（扁平 JSONL）
// Pi CLI: ~/.pi/agent/sessions/**/*.jsonl（树形 JSONL，带 session header）
// Gemini CLI: ~/.gemini/tmp/*/chats/*.json（纯 JSON）
// OpenCode: ~/.local/share/opencode/opencode.db（SQLite）
```
