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
