# 命令指南

> 本项目中 Tauri 命令的定义和组织方式。

---

## 概述

所有 `#[tauri::command]` 函数按领域拆分到 `commands/` 目录下的独立模块中。约 50 多个命令注册在 `app.rs` 的一个 `generate_handler!` 宏调用中。命令通过域注释进行分组。

---

## 命令结构

### 同步命令（标准模式）

```rust
#[tauri::command]
pub fn add_project(
    path: String,
    agent_id: Option<String>,
    ide: Option<String>,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<Project, AppError> {
    let mut pm = state.project_manager.lock().unwrap();
    // ... 业务逻辑 ...
    Ok(project)
}
```

### 异步命令（仅用于 SSH/Skill 操作）

```rust
#[tauri::command]
pub async fn create_remote_terminal_session(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppStateWrapper>,  // 异步命令需要显式生命周期
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, AppError> {
    // ... 异步 SSH 逻辑 ...
}
```

### 关键规则

1. **所有命令放在 `commands/` 下的独立模块**中，在 `commands/mod.rs` 中聚合导出
2. **返回类型始终为 `Result<T, AppError>`** —— 不使用裸类型，不使用 `String`
3. **状态访问** 通过 `state: State<AppStateWrapper>` 参数
4. **Mutex 锁** 使用 `.lock().unwrap()` —— 锁中毒视为致命错误
5. **异步** 仅在命令需要异步 I/O 时使用（SSH 操作、Skill spawn_blocking）
6. **显式生命周期** 异步命令中需要 `State<'_, AppStateWrapper>`

---

## 状态访问模式

### AppStateWrapper

```rust
pub struct AppStateWrapper {
    project_manager: Mutex<ProjectManager>,
    terminal_manager: TerminalManager,
    remote_terminal_manager: RemoteTerminalManager,
    agent_manager: Mutex<AgentManager>,
    storage_manager: StorageManager,
    active_project_id: Mutex<Option<String>>,
    watcher_manager: WatcherManager,
    skill_store: Arc<skill::skill_store::SkillStore>,
}
```

### 何时使用 Mutex

- **用 `Mutex` 包裹**：需要外部修改的 Manager（project_manager、agent_manager、active_project_id）
- **直接存储**：自带内部同步机制的 Manager，使用 `Arc<Mutex<HashMap>>`（terminal_manager、remote_terminal_manager、watcher_manager、storage_manager）

### 命令中的访问模式

```rust
#[tauri::command]
fn some_command(state: State<AppStateWrapper>) -> Result<(), AppError> {
    // Mutex 包裹的：先获取锁再使用
    let mut pm = state.project_manager.lock().unwrap();
    pm.do_something();

    // 直接访问的：Manager 自行处理同步
    state.terminal_manager.create_session(...);

    Ok(())
}
```

---

## 命令组织

`commands/` 下的模块按领域拆分：

| 模块 | 领域 |
|------|------|
| `project.rs` | 本地项目 CRUD |
| `git.rs` | 本地 Git 操作 |
| `terminal.rs` | 本地终端会话 |
| `wsl.rs` / `wsl_git.rs` | WSL 终端和 Git |
| `remote.rs` / `remote_git.rs` | SSH 远程终端和 Git |
| `agent.rs` | Agent 管理 |
| `ide.rs` | IDE 启动 |
| `config.rs` | 配置和会话持久化 |
| `file.rs` | 文件树和文件内容 |

---

## 命令边界的错误处理

所有内部错误在命令边界转换为 `AppError`：

```rust
#[tauri::command]
fn some_command(state: State<AppStateWrapper>) -> Result<Project, AppError> {
    let result = state.project_manager
        .lock().unwrap()
        .do_something()
        .map_err(AppError::from)?;  // anyhow::Error -> AppError
    Ok(result)
}
```

对于业务逻辑错误，使用显式 `AppError` 变体：

```rust
.ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?
```

详见[错误处理](./error-handling.md)。

---

## 前端调用方式

前端通过 Tauri IPC 调用命令：

```tsx
// 前端（TypeScript）
import { invoke } from "@tauri-apps/api/core";

const project = await invoke<Project>("add_project", {
  path: "/some/path",
  agentId: null,
  ide: null,
});
```

注意：Tauri 会自动将 camelCase 的 JS 参数转换为 snake_case 的 Rust 参数。错误返回类型为 `AppError`（序列化为 JSON 对象），前端可以按 `error` 字段处理。

---

## 注册新命令

1. 在 `commands/<domain>.rs` 中定义命令函数
2. 在 `commands/mod.rs` 中导出
3. 在 `app.rs` 的 `generate_handler!` 宏中添加函数名：

```rust
// src-tauri/src/app.rs
.invoke_handler(tauri::generate_handler![
    commands::add_project,
    commands::remove_project,
    // ... 所有命令列在此处
    commands::your_new_command,  // <-- 在此添加
])
```

---

## 常见错误

### 1. 忘记将命令添加到 `generate_handler!`

命令会编译通过，但前端无法调用。

### 2. 使用裸返回类型而非 `Result<T, AppError>`

```rust
// 错误 —— 前端无法处理错误
#[tauri::command]
fn get_info(state: State<AppStateWrapper>) -> Project { ... }

// 正确
#[tauri::command]
fn get_info(state: State<AppStateWrapper>) -> Result<Project, AppError> { ... }
```

### 3. 跨 await 点持有 Mutex 锁

```rust
// 错误 —— 死锁风险
let pm = state.project_manager.lock().unwrap();
some_async_call().await;  // 锁在 await 期间被持有！

// 正确 —— await 前释放锁
let data = {
    let pm = state.project_manager.lock().unwrap();
    pm.get_data().clone()
};
some_async_call().await;
```

### 4. 缺少 Windows 专用命令的平台存根

每个 WSL 命令都需要一个非 Windows 的存根：

```rust
#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn some_wsl_command() -> Result<(), AppError> {
    Err(AppError::Wsl("WSL is only supported on Windows".to_string()))
}
```

### 5. 在 `commands/mod.rs` 中忘记导出子模块

```rust
// commands/mod.rs
pub use project::*;  // 必须显式导出，否则 app.rs 无法引用
```

---

## 终端分屏会话契约 2026-04-17

### 变更文件

- `src-tauri/src/commands/config.rs`
- `src-tauri/src/storage.rs`
- `src-tauri/src/models/session.rs`

### 命令签名

`save_session` 当前签名：

```rust
#[tauri::command]
pub fn save_session(
    wsl_entries: Vec<WSLEntrySession>,
    remote_entries: Vec<RemoteEntrySession>,
    sidebar_width: Option<u32>,
    worktree_state: Option<std::collections::HashMap<String, String>>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError>
```

### 字段契约

- 已移除字段：`side_terminal_width`
- 持久化字段保留：`sidebar_width`、`worktree_state`
- `SessionStore` 必须与前端 `src/types.ts` 的 `SessionStore` 同步

### 校验与错误矩阵

| 场景 | 输入 | 期望行为 | 错误输出 |
|------|------|----------|----------|
| Good | `wsl_entries`、`remote_entries` 正常数组，`worktree_state` 为 `Some` | 正常保存 sessions.json | 无 |
| Base | `worktree_state=None` | 使用已有 `SessionStore.worktree_state` | 无 |
| Bad | `state.project_manager` 锁失败 | 立即返回错误 | `Err(AppError::LockPoisoned(...))` |
| Bad | 序列化或写文件失败 | 返回 `AppError::Storage(...)` | `Err(AppError::Storage(...))` |

### Good/Base/Bad 用例

- Good：`src-tauri/tests/unit/storage_test.rs::save_and_load_session_with_projects`
- Base：`src-tauri/tests/unit/state_test.rs::session_store_defaults_for_missing_fields`
- Bad：命令层通过 `map_err(AppError::from)` 覆盖，测试关注返回 `Result::Err`

### 必测断言点

- `SessionStore` 默认反序列化不再包含 `side_terminal_width`
- `create_session_from_projects` 签名与调用点已同步为 4 个业务参数
- `save_session` 命令参数与前端调用参数名保持一致
