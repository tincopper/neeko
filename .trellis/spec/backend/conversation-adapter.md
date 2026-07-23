# 会话管理 — Agent 适配器模式

> 后端用适配器模式统一管理多个 AI CLI Agent 的会话数据。

---

## 1. Scope / Trigger

- **Trigger**: `src-tauri/src/conversation/` 模块（新增）
- **Cross-layer**: Tauri 命令接口，前端通过 invoke 调用

## 2. 架构设计

### 2.1 设计决策：适配器模式

**为什么不用统一格式？** 7 个内置 Agent 各有自己的会话文件格式（JSONL 平铺 / JSONL 树形 / SQLite / 纯 JSON），无法统一解析。

**方案**：`AgentSessionAdapter` trait — 每个 Agent 一个适配器实现，统一对外接口。

```rust
pub trait AgentSessionAdapter: Send + Sync {
    fn agent_id(&self) -> &str;
    fn session_root(&self) -> PathBuf;
    fn file_pattern(&self) -> &str;
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta>;
    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>>;
    fn extract_session_id(&self, file_path: &Path) -> Option<String>;
    fn resume_command(&self, native_session_id: &str, project_path: &str) -> Option<Vec<String>>;
}
```

### 2.2 设计决策：无持久化，只在内存缓存

**为什么不用 SQLite？** Agent 原生文件本身就是 Source of Truth，Neeko 只做浏览/索引，不存储完整数据。元数据只在内存 HashMap 中，进项目时重新扫描。

```rust
// ConversationManager 的核心数据结构
cache: Mutex<HashMap<String, ConversationMeta>>,   // key = "{agent_id}:{native_id}"
```

### 2.3 设计决策：parse_meta / parse_messages 分离

- `parse_meta()` — 只读文件头部（前几十行），毫秒级完成，用于列表展示
- `parse_messages()` — 读完整文件，用户点击查看时按需调用

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

// 列出会话（从缓存读取）
#[tauri::command]
fn list_conversations(
    project_path: Option<String>,          // 过滤项目路径
    agent_id: Option<String>,              // 过滤 agent
    state: State<AppStateWrapper>,
) -> Result<Vec<ConversationMeta>, AppError>;

// 获取消息列表
#[tauri::command]
fn get_conversation_messages(
    id: String,                            // "{agent_id}:{native_id}"
    state: State<AppStateWrapper>,
) -> Result<Vec<ConversationMessage>, AppError>;

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

// 导出 Markdown
#[tauri::command]
fn export_conversation(
    id: String,
    state: State<AppStateWrapper>,
) -> Result<String, AppError>;
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
    pub message_count: u32,
    pub preview: String,                   // 前 200 字符
    pub file_path: PathBuf,                // Agent 原生文件绝对路径
    pub project_path: Option<String>,
    pub user_title: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub role: String,                      // "user" | "assistant" | "system"
    pub content: String,
    pub timestamp: i64,
    pub seq: u32,
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
| OMP | `~/.omp/agent/sessions/<sanitized>/*.jsonl` | 仅主会话深度（`<sanitized>/<file>.jsonl`），排除 session 子目录 trace。 |
| Grok | `~/.grok/sessions/<urlenc-cwd>/<uuid>/summary.json` | 消息来自 sibling `updates.jsonl` 分块合并。 |
| Pi / Claude | 嵌套 jsonl | 依赖 L0 自动 `**/`；勿写仅顶层的 basename pattern 而不测 WalkDir。 |

### 4.4 搜索行为

- `query` 为空字符串 → 返回空结果
- `query` 非空 → 在缓存的 `title` 和 `preview` 中进行模糊子串匹配
- 区分大小写

### 4.5 项目路径过滤

- `project_path` 为 `None` → 不过滤，返回所有
- `project_path` 非 `None` → 在 `ConversationMeta.project_path` 中做子串匹配
- 支持 worktree 路径匹配（子路径包含关系）

## 5. 错误边界

| 场景 | 行为 |
|------|------|
| adapter `parse_meta` 失败 | 跳过该文件，记录到 `ScanReport.errors`，不阻断扫描 |
| adapter `parse_messages` 失败 | `get_conversation_messages` 返回 `AppError` |
| adapter ID 不存在 | `get_messages` / `get_resume_command` 返回 `AppError::NotFound` |
| 文件被删除/不存在 | `parse_messages` 返回 IO 错误，转换为 `AppError` |
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
