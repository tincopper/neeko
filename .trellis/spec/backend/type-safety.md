# 类型安全

> Rust 后端中的类型安全模式。

---

## 概述

所有数据模型类型定义在 `src-tauri/src/state.rs` 中。类型使用 `serde` 进行序列化，并与前端 TypeScript 类型（`src/types.ts`）手动同步。

---

## 类型组织

### 所有共享类型集中在 `state.rs` 中

| 分类 | 类型 |
|------|------|
| 应用配置 | `AppConfig`（不在 state.rs 中——以 `serde_json::Value` 加载） |
| 项目 | `Project`、`ViewMode` |
| 终端 | `TerminalSession`、`TerminalStatus` |
| Git | `GitInfo`、`FileChange`、`FileStatus`、`Worktree` |
| Diff | `DiffResult`、`DiffHunk`、`DiffLine` |
| Agent | `AgentConfig` |
| WSL | `WSLEntrySession`、`WSLProjectSession` |
| SSH | `RemoteEntrySession`、`RemoteProjectSession`、`AuthMethod` |
| 持久化 | `SessionStore`、`ProjectSession` |

### Manager 本地类型

仅在某个 Manager 内部使用的类型定义在该 Manager 的文件中：

```rust
// terminal.rs —— 不在 state.rs 中
struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    input_listener_id: EventId,
    app_handle: tauri::AppHandle,
}
```

---

## Derive 约定

### 标准 derive 顺序

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitInfo {
    pub current_branch: String,
    pub branches: Vec<String>,
    pub worktrees: Vec<Worktree>,
    pub changed_files: Vec<FileChange>,
    pub is_clean: bool,
}
```

所有共享类型派生：`Debug, Clone, Serialize, Deserialize`（按此顺序）。

### 结构体字段可见性

- **`state.rs` 中的模型类型**：所有字段为 `pub`
- **Manager 结构体**：字段为私有，需要跨模块访问的方法为 `pub`

---

## Serde 模式

### 可选/新字段的默认值

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStore {
    pub projects: Vec<ProjectSession>,
    pub active_project_id: Option<String>,
    pub last_updated: String,
    #[serde(default)]          // Vec 默认为空
    pub wsl_entries: Vec<WSLEntrySession>,
    #[serde(default)]
    pub remote_entries: Vec<RemoteEntrySession>,
    #[serde(default)]
    pub sidebar_width: Option<f64>,
}
```

### 自定义默认函数

```rust
#[serde(default = "default_collapsed")]
pub collapsed: bool,

fn default_collapsed() -> bool { false }
```

### 跳过序列化可选字段

```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
pub saved_auth: Option<String>,
```

### 枚举序列化（外部标签 —— serde 默认）

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuthMethod {
    Password(String),
    KeyFile(String),
    KeyFileWithPassphrase { key_path: String, passphrase: String },
}
// 序列化为：{"Password": "..."} 或 {"KeyFileWithPassphrase": {"key_path": "...", "passphrase": "..."}}
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ViewMode {
    Terminal,
    Diff { file_path: PathBuf },
}
// 序列化为："Terminal" 或 {"Diff": {"file_path": "..."}}
```

---

## Rust 到 TypeScript 的类型映射

类型在 `src-tauri/src/state.rs` 和 `src/types.ts` 之间**手动同步**。没有自动生成工具。

### 映射规则

| Rust | TypeScript |
|------|-----------|
| `String` | `string` |
| `PathBuf` | `string` |
| `bool` | `boolean` |
| `u16`、`u32`、`f64`、`i32` | `number` |
| `Vec<T>` | `T[]` |
| `Option<T>` | `T \| null` |
| `HashMap<String, String>` | `Record<string, string>` |
| 单元变体 `Terminal` | `"Terminal"` |
| 结构体变体 `Diff { file_path }` | `{ Diff: { file_path: string } }` |
| 元组变体 `Password(String)` | `{ Password: string }` |

### 字段命名

TypeScript 镜像 Rust 的 **snake_case** 字段名（serde 默认），不使用 camelCase：

```rust
// Rust
pub struct GitInfo {
    pub current_branch: String,
    pub is_clean: bool,
}
```

```tsx
// TypeScript —— 同样是 snake_case
interface GitInfo {
  current_branch: string;
  is_clean: boolean;
}
```

### 修改类型时的步骤

1. 更新 `state.rs` 中的 Rust 结构体
2. 更新 `src/types.ts` 中对应的 TypeScript 接口
3. 在新字段上添加 `#[serde(default)]` 以确保与已有持久化数据的向后兼容
4. 用 `cargo check` 和 `pnpm tsc --noEmit` 验证

---

## ID 生成

所有实体 ID 使用 UUID v4：

```rust
use uuid::Uuid;

let id = Uuid::new_v4().to_string();
```

---

## 常见错误

### 1. 新字段忘记添加 `#[serde(default)]`

没有它，反序列化缺少该字段的旧 `sessions.json` 文件会失败：

```rust
// 错误 —— 破坏现有会话
pub new_field: Vec<String>,

// 正确 —— 优雅处理缺失字段
#[serde(default)]
pub new_field: Vec<String>,
```

### 2. Rust 修改后没有更新 TypeScript 类型

由于类型是手动同步的，忘记更新 `src/types.ts` 会导致运行时不匹配。始终同时更新两端，并运行两个类型检查。

### 3. 对有类型的数据使用 `serde_json::Value`

```rust
// 错误 —— 失去类型安全
let data: serde_json::Value = ...;

// 正确 —— 定义合适的结构体
let data: MyStruct = serde_json::from_str(&json)?;
```

例外：`config.json` 以 `serde_json::Value` 加载，因为它使用手动字段校验以确保向后兼容。

---

## 信任标识字段与防御层

### 适用场景

某些结构体字段属于"由后端单方面填写、用于权限/分类判断"的元数据，前端可见但绝不能被用户直接写入。例如：

- `AgentConfig.is_builtin: bool` —— 区分内置 agent 与用户自定义 agent
- `AgentConfig.default_skill_path: Option<String>` —— 内置 agent 的默认 skill 路径，仅由 `add_default_agents()` 填写

**反面案例**：如果不加防御，前端可以构造 `is_builtin: true` 的 JSON 调用 `add_agent`，让用户自定义 agent 伪装成内置 agent 出现在内置区块。同样，旧持久化文件如果手工编辑也能注入伪造字段。

### 防御契约

对每个信任标识字段，**所有进入 AgentManager（或其他注册表）的入口都必须清零**：

| 入口 | 清零位置 | 为什么 |
|------|---------|--------|
| Tauri 命令 (`add_agent`) | 反序列化 → **强制覆盖为 false/None** → push | 防止前端构造 JSON 伪造身份 |
| 启动时反序列化 customAgents | 反序列化 → **强制覆盖为 false/None** → push | 防止用户手工编辑持久化文件 |

### 正确实现

```rust
// commands/agent.rs
#[tauri::command]
pub fn add_agent(mut agent: AgentConfig, state: State<AppStateWrapper>) -> Result<(), AppError> {
    // 用户自定义 agent 不允许携带 builtin 元数据
    agent.is_builtin = false;
    agent.default_skill_path = None;

    // 之后再 push 进 AgentManager 与持久化
    ...
}
```

```rust
// app.rs（启动时加载 customAgents JSON）
for agent_json in custom_agents {
    if let Ok(mut agent) = serde_json::from_value::<AgentConfig>(agent_json.clone()) {
        agent.is_builtin = false;
        agent.default_skill_path = None;
        agent_manager.push(agent);
    }
}
```

### 错误实现

```rust
// 错误 —— 信任前端 JSON 中的 is_builtin
pub fn add_agent(agent: AgentConfig, ...) -> Result<(), AppError> {
    state.agent_manager.push(agent); // 直接信任，前端可伪造
}
```

```rust
// 错误 —— 只在命令边界防御，忘了持久化加载路径
pub fn add_agent(mut agent: AgentConfig, ...) -> Result<(), AppError> {
    agent.is_builtin = false;        // 这里清零了
    state.agent_manager.push(agent);
}
// 但 app.rs 启动加载 customAgents 时没清零，旧用户的伪造数据仍可绕过
```

### 测试要求

- 单测：构造一个 `is_builtin: true` 的伪造 AgentConfig 调 `add_agent`，断言入库后 `is_builtin == false`
- 单测：构造一份带伪造字段的 customAgents JSON 字符串，触发启动加载，断言反序列化后 `is_builtin == false`
- 集成：`get_agents()` 返回列表中，只有 `add_default_agents()` 注册的 agent 满足 `is_builtin == true`
