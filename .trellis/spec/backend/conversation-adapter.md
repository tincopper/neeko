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
    project_path: Option<String>,          // 过滤项目路径
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
| Pi / Claude | 嵌套 jsonl | 依赖 L0 自动 `**/`；勿写仅顶层的 basename pattern 而不测 WalkDir。**Pi：`message.content` 恒为块数组**（text / thinking / toolCall / image），session 头部**从不写 name/title**（标题只能靠 P3 首条用户消息），工具结果独立成 `role:"toolResult"` 记录。 |

### 4.4 搜索行为

- `query` 为空字符串 → 返回空结果
- `query` 非空 → 在缓存的 `title` 和 `preview` 中进行模糊子串匹配
- 区分大小写

### 4.5 项目路径过滤

- `project_path` 为 `None` → 不过滤，返回所有
- `project_path` 非 `None` → 在 `ConversationMeta.project_path` 中做子串匹配
- 支持 worktree 路径匹配（子路径包含关系）

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
| opencode | 0 / 399 | 一次分组聚合 `count_messages_per_session`（含「必须有 part」条件） |
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

### 4.6.5 标题素材的净化

图片引用（`[Image #1]`、`[[Image #1]](file:///…/blobs/<sha>.png)`）不是标题素材，
由 `normalize`（Title / Preview 目标）统一剥离；适配器只提供原文，不做展示决策。

**fixture 必须与真实磁盘格式一致**：用字符串写 `content` 夹具会让「只兼容字符串」的实现全绿，
从而掩盖真实格式缺陷（Pi 曾因此把标题退化成 `pi <id8>`、正文解析成 0 条消息）。

### 4.6.6 工具调用摘要的双实现

侧边栏要展示「哪个命令 / 哪个文件」，但这些摘要来自**后端统计**（不回传入参载荷，
因为 `Write` 的入参可能是一整个文件）。因此同一规则有两份实现：

- Rust `manager::tool_call_summary` —— 侧边栏用（`ConversationStats.toolCallList[].summary`）；
- TS `utils/toolPresentation.getToolSummary` —— 消息块内渲染用（手上有真实 `input`）。

两者都按「路径 / 命令 / pattern 优先，其余截断序列化」取值，各自的测试必须同步更新；
新增工具名时**两边都要加**，否则侧边栏会退化成序列化预览。

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
| opencode | Native | `opencode session delete <id>`（SQLite 行 + 子会话级联） |
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
