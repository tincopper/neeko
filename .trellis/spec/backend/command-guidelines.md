# 命令指南

> 本项目中 Tauri 命令的定义和组织方式。

---

## 概述

所有 `#[tauri::command]` 函数按领域拆分到模块中。`app.rs` 通过 `crate::neeko_invoke_handler!()` 统一注册命令，完整清单维护在 `commands/mod.rs` 的 `neeko_invoke_handler!` 宏内。

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

1. **命令实现按领域放在 `commands/` 子模块**，由 `commands/mod.rs` 聚合导出，并在 `neeko_invoke_handler!` 宏中集中注册
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

1. 在对应域模块中定义命令函数

2. 在聚合导出处导出函数

3. 将命令路径加入 `neeko_invoke_handler!` 命令清单

```rust
// src-tauri/src/commands/mod.rs
#[macro_export]
macro_rules! neeko_invoke_handler {
    () => {
        tauri::generate_handler![
            // ... existing commands ...
            $crate::commands::your_new_command,
        ]
    };
}
```

`app.rs` 保持 `.invoke_handler(crate::neeko_invoke_handler!())` 固定调用。

---

## 配置驱动的功能门控

当后端行为（包括非命令路径如 PTY 创建、SSH 连接）需要受用户配置开关控制时，使用以下模式：

### 读取配置的辅助函数

配置读取函数放在 `opencode_theme.rs` 或其他合适模块中，从 `~/.neeko/config.json` 读取布尔字段，缺失/失败默认返回 `false`：

```rust
// src-tauri/src/opencode_theme.rs
/// 从 ~/.neeko/config.json 读取 enablePiThemeSync 字段
/// 默认返回 false（如果读取失败或字段不存在）
pub fn read_enable_pi_theme_sync() -> bool {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return false,
    };
    let config_path = home.join(".neeko").join("config.json");
    let content = match std::fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let config: serde_json::Value = match serde_json::from_str(&content) {
        Ok(c) => c,
        Err(_) => return false,
    };
    config
        .get("enablePiThemeSync")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}
```

### 调用点门控

在 PTY 创建、SSH 连接等非命令路径中使用：

```rust
if crate::opencode_theme::read_enable_pi_theme_sync() {
    if let Err(e) = crate::pi_theme::write_project_pi_settings(path, &theme) {
        log::warn!("[PTY] Failed to write Pi settings.json: {}", e);
    }
}
```

### 命令内部使用

命令中可以同样读取配置来门控：

```rust
#[tauri::command]
pub fn sync_agent_theme(theme: String, targets: ProjectThemeTargets) -> Result<(), AppError> {
    if crate::opencode_theme::read_enable_pi_theme_sync() {
        // Pi 主题同步逻辑
    }
    Ok(())
}
```

### 关键规则

1. **默认值必须是安全选择**：`unwrap_or(false)`——字段未设置时默认为关闭
2. **静默失败不影响主流程**：配置读取失败不报错，门控内操作失败仅 warn 日志
3. **不与 `State<AppStateWrapper>` 耦合**：配置读取函数不依赖 Tauri state，使得在非命令路径（terminal.rs、remote.rs）也可用
4. **前端对应 TypeScript 字段**：在 `src/types/app.ts` 的 `AppConfig` 中同时声明，由 `save_config`/`load_config` 持久化
---

## 常见错误

### 1. 忘记将命令加入 `neeko_invoke_handler!` 清单

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

## 对称 Rust + 渐进前端 caller 模式 2026-05-19

### 适用场景

实现 per-project 元数据（如 `selected_agent`、`selected_ide`、`avatar_color`）时，往往需要在 Local / WSL / SSH 三端 schema 上加同一个字段。Rust 侧的**对称 setter 命令**（`set_<field>` / `wsl_set_project_<field>` / `remote_set_project_<field>`）通常一次落齐三端，**但前端 caller 可以渐进落地**——例如本期 MVP 仅暴露 Local 入口，WSL/SSH UI 留待后续。

这种"Rust 三端对齐、前端单端 caller"是允许的，但必须在 PRD 与代码注释中显式标注以避免后续审计误判 dead code。

### 契约

1. **三个对称命令必须全部注册到 `neeko_invoke_handler!`**，即使前端暂未调用——保证后续接前端 caller 时是"加一行 invoke"而不是"改 Rust + 改宏 + 加 invoke"。
2. **PRD 显式标注 caller 状态**：在 PRD 的"实施范围"或"取舍点"小节列出"暂无前端 caller 的 Rust 命令"。
3. **任务汇报中标注**：`trellis-implement` / `trellis-check` 汇报里要把这些命令明确列为"保留作未来扩展"，避免被误判为 dead code 删除。
4. **不通过 `#[allow(dead_code)]` 标记**：这些命令是公开 Tauri 命令，已经被 `tauri::generate_handler!` 引用，不会触发 dead_code 警告。

### 反模式

❌ **只实现 Local setter，wsl/remote 等用到再补**：会导致后续接 wsl UI 时需要回头改 Rust schema + 命令 + 宏注册三处，增加事故面。

❌ **三个 setter 都不注册到 `neeko_invoke_handler!`**：等到接前端 caller 时一并注册——容易遗漏。

### 实例

`avatar_color` 任务（`05-19-project-avatar-color-customization`）：
- Rust：`set_project_color` / `wsl_set_project_color` / `remote_set_project_color` 三端对齐，全部注册到 `neeko_invoke_handler!`
- 前端：MVP 仅 `ProjectPanel.tsx`（Local 子面板）调用 `set_project_color`；`wsl_set_project_color` / `remote_set_project_color` 暂无 caller
- PRD 显式标注："UI override 入口 MVP 仅 Local"
- 后续接 WSL/SSH UI 时只需加 `invoke` 调用，无需回头改 Rust

### 何时 *不* 适用

- 命令明显只属于某一端（如 `wsl_get_distros`），不存在"三端对齐"诉求
- 字段只在一端持久化（如 SSH-only `saved_auth`）

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
