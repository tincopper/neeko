# 命令指南

> 本项目中 Tauri 命令的定义和组织方式。

---

## 概述

所有 `#[tauri::command]` 函数都定义为 `lib.rs` 中的**自由函数**。约 50 多个命令注册在一个 `generate_handler!` 宏调用中。命令通过域注释进行分组。

---

## 命令结构

### 同步命令（标准模式）

```rust
#[tauri::command]
fn add_project(
    path: String,
    agent_id: Option<String>,
    ide: Option<String>,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<Project, String> {
    let mut pm = state.project_manager.lock().unwrap();
    // ... 业务逻辑 ...
    Ok(project)
}
```

### 异步命令（仅用于 SSH 操作）

```rust
#[tauri::command]
async fn create_remote_terminal_session(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppStateWrapper>,  // 异步命令需要显式生命周期
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, String> {
    // ... 异步 SSH 逻辑 ...
}
```

### 关键规则

1. **所有命令放在 `lib.rs`** 中作为自由函数（不在 manager 模块中）
2. **返回类型始终为 `Result<T, String>`** —— 不使用裸类型，不使用自定义错误类型
3. **状态访问** 通过 `state: State<AppStateWrapper>` 参数
4. **Mutex 锁** 使用 `.lock().unwrap()` —— 锁中毒视为致命错误
5. **异步** 仅在命令需要异步 I/O 时使用（通过 russh 的 SSH 操作）
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
}
```

### 何时使用 Mutex

- **用 `Mutex` 包裹**：需要外部修改的 Manager（project_manager、agent_manager、active_project_id）
- **直接存储**：自带内部同步机制的 Manager，使用 `Arc<Mutex<HashMap>>`（terminal_manager、remote_terminal_manager、watcher_manager、storage_manager）

### 命令中的访问模式

```rust
#[tauri::command]
fn some_command(state: State<AppStateWrapper>) -> Result<(), String> {
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

`lib.rs` 中的命令按领域分组，使用分段注释：

```rust
// ─── 项目管理命令 ───────────────────────────────────────
#[tauri::command]
fn add_project(...) { ... }
fn remove_project(...) { ... }
fn rename_project(...) { ... }

// ─── 终端命令 ───────────────────────────────────────────
#[tauri::command]
fn create_terminal_session(...) { ... }
fn close_terminal_session(...) { ... }
fn resize_terminal(...) { ... }

// ─── Git 命令 ───────────────────────────────────────────
#[tauri::command]
fn get_git_info_command(...) { ... }
fn checkout_branch_command(...) { ... }

// ─── 持久化命令 ─────────────────────────────────────────
#[tauri::command]
fn save_session(...) { ... }
fn load_session(...) { ... }
```

---

## 命令边界的错误处理

所有内部错误在命令边界转换为 `String`：

```rust
#[tauri::command]
fn some_command(state: State<AppStateWrapper>) -> Result<Project, String> {
    let result = state.project_manager
        .lock().unwrap()
        .do_something()
        .map_err(|e| e.to_string())?;  // anyhow::Error -> String
    Ok(result)
}
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

注意：Tauri 会自动将 camelCase 的 JS 参数转换为 snake_case 的 Rust 参数。

---

## 注册新命令

在 `lib.rs` 的 `generate_handler!` 宏中添加函数名：

```rust
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        add_project,
        remove_project,
        // ... 所有命令列在此处
        your_new_command,  // <-- 在此添加
    ])
```

---

## 常见错误

### 1. 忘记将命令添加到 `generate_handler!`

命令会编译通过，但前端无法调用。

### 2. 使用裸返回类型而非 `Result<T, String>`

```rust
// 错误 —— 前端无法处理错误
#[tauri::command]
fn get_info(state: State<AppStateWrapper>) -> Project { ... }

// 正确
#[tauri::command]
fn get_info(state: State<AppStateWrapper>) -> Result<Project, String> { ... }
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
fn some_wsl_command() -> Result<(), String> {
    Err("WSL is only supported on Windows".into())
}
```
