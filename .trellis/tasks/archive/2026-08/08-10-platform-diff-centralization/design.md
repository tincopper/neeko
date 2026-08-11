# 平台差异集中化 · 技术设计

## 1. 核心判断

用户推荐模式（`platform/` + 每平台一个文件 + `mod.rs` 用 `#[cfg]` 选择 + `pub use`）是业界标准做法（对齐 `std::sys` 与 Tauri/winit 的 `platform_impl` 模式）。

但本项目平台差异跨越多个**互不相关**的主题（DevTools 与进程收割、文件管理器与字体路径毫无关联）。若强行塞进 `windows.rs`/`linux.rs`/`macos.rs` 三个文件，会违背**高内聚**原则（一个文件承担多个不相关职责）。

因此采用**主题优先、平台次之**的分层：每个主题一个目录，目录内每平台一个实现文件，`mod.rs` 定义统一接口 + cfg 选择。

## 1.5 两层防线（组织层 + 行为层）

本任务只做**组织层**：把「每个平台必须有实现」变成编译期强制（`mod.rs` 的 `#[cfg] + pub use`，缺平台 impl 本机即报错）。

**行为层**（「能编译但行为不对」）由既有 CI 兜底：`.github/workflows/ci.yml` 的 `backend-check` / `backend-test` 在 ubuntu/macos/windows 三平台矩阵跑 `cargo check` + `cargo clippy -- -D warnings` + `cargo test`（`fail-fast: false`）。

本任务不新增、不改动 CI；重构完成后，CI 矩阵的定位从「抓编译错误」升级为「抓行为错误」，分工更清晰。交叉编译检查（`cargo check --target`）作为本地补充验证手段。

## 2. 最终目录结构

> 实现阶段在原规划 6 个主题基础上，进一步把散落的平台差异（进程启动标志、Shell 任务命令、IDE 启动、技能链接、file:// 解析、通知基地址）也归入适配层，最终扩至 **12 个主题**。全部遵循「主题优先、平台次之」分层。

```
src-tauri/src/platform/
├── mod.rs                      # 统一门面：聚合各主题模块 + pub use（12 个主题）
├── reveal/                     # 第一批：文件管理器 reveal
│   ├── mod.rs                  # 统一接口 build_reveal_command / normalize_path + cfg 选择
│   ├── macos.rs  linux.rs  windows.rs
├── process_tree/               # 第一批：进程树快照
│   ├── mod.rs                  # 统一接口 snapshot_process_tree + cfg 选择
│   ├── macos.rs  linux.rs
├── process_memory/             # 第一批：进程内存采样
│   ├── mod.rs                  # 统一接口 sample_process_memory_mb + cfg 选择
│   ├── macos.rs  linux.rs  windows.rs
├── host_path/                  # 第一批：主机用户 PATH 解析
│   ├── mod.rs                  # 统一接口 resolve_host_path + cfg 选择
│   ├── unix.rs  windows.rs
├── devtools/                   # 第二批：DevTools 打开
│   ├── mod.rs                  # 统一接口 ensure_detached_devtools / needs_side_effect_compensation / configure_inspector
│   ├── macos.rs  linux.rs  windows.rs
├── git_credential/             # 第二批：Git 凭据助手默认值
│   ├── mod.rs                  # 统一接口 platform_default() -> &'static str
│   ├── macos.rs  linux.rs  windows.rs
├── shell_launch/               # 实现阶段扩展：Shell 任务命令构建（cmd /c vs sh -c + locale）
│   ├── mod.rs                  # 统一接口 build_task_command / apply_locale_env
│   ├── unix.rs  windows.rs
├── process_spawn/              # 实现阶段扩展：子进程启动标志（CREATE_NO_WINDOW / process_group）
│   ├── mod.rs                  # 统一接口 apply_child_flags / apply_detached_flags
│   ├── unix.rs  windows.rs
├── ide_launch/                 # 实现阶段扩展：IDE 启动（cmd /C、spawn、macOS LaunchServices 降级）
│   ├── mod.rs                  # 统一接口 launch_ide_with_fallback / spawn_ide_process
│   ├── macos.rs  linux.rs  windows.rs
├── symlink/                    # 实现阶段扩展：技能目录链接（symlink vs 递归复制）
│   ├── mod.rs                  # 统一接口 create_link
│   ├── unix.rs  windows.rs
├── file_url/                   # 实现阶段扩展：file:// URI → 原生路径
│   ├── mod.rs                  # 统一接口 file_url_to_path
│   ├── unix.rs  windows.rs
└── notify_base/                # 实现阶段扩展：注入脚本通知基地址
    ├── mod.rs                  # 统一接口 notify_base
    ├── unix.rs  windows.rs
```

> 主题命名一致性：三分平台差异（`macos`/`linux`/`windows`）用 `#[cfg(target_os = "...")]`；两态差异（Windows vs 非 Windows）用 `#[cfg(windows)]` / `#[cfg(not(windows))]`（或 `#[cfg(unix)]`）。所有 `mod` 与 `pub use` 同时 cfg 门控，避免非活动平台触发 `dead_code`。

## 3. 各主题接口设计

### 3.1 reveal（文件管理器，第一批）

**来源**：`file/commands.rs::build_reveal_command`

```rust
// platform/reveal/mod.rs
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

/// 构建"在系统文件管理器中 reveal 路径"的命令（不执行）
pub fn build_reveal_command(path: &Path) -> Option<Command>;
```

> `mod` 与 `pub use` 同时 cfg 门控，避免非活动平台模块触发 `dead_code` 警告（clippy `-D warnings` 拦截）。各平台实现由 CI 三平台矩阵分别编译验证。

- `macos.rs`：`open` / `open -R`
- `linux.rs`：`xdg-open` / 父目录
- `windows.rs`：`explorer` / `explorer /select,`

**迁移**：`file/commands.rs` 改为 `use crate::platform::reveal::build_reveal_command;`，删除函数内 cfg。`normalize_path` 的 windows/unix 差异也一并抽入（或保留为纯函数，视实现）。

### 3.2 process_tree（进程树快照，第一批）

**来源**：`terminal/process_reaper.rs::snapshot_process_tree`

```rust
// platform/process_tree/mod.rs
pub fn snapshot_process_tree() -> (HashMap<i32, i32>, HashMap<i32, i32>);
```

- `macos.rs`：libproc 实现
- `linux.rs`：procfs 实现

**迁移**：`process_reaper.rs` 删除两个 cfg 实现，改为 `use crate::platform::process_tree::snapshot_process_tree;`。共享逻辑（`collect_session_processes`、`collect_from_maps`、`kill_processes`、`reap_session_tree`）保留在原处（unix 平台通用，不属于平台差异）。测试（`#[cfg(unix)]`）保持原样。

### 3.3 process_memory（进程内存采样，第一批）

**来源**：`lsp/session/utils.rs::sample_process_memory_mb`

```rust
// platform/process_memory/mod.rs
pub fn sample_process_memory_mb(pid: u32) -> Option<f64>;
```

- `macos.rs`：`ps -o rss=`
- `linux.rs`：`/proc/{pid}/status` VmRSS
- `windows.rs`：`None`（v1 跳过）

**迁移**：`lsp/session/utils.rs` 删除四个 cfg 块，改为调用统一接口。`iso_timestamp_now` 保留原处。

### 3.4 host_path（PATH 解析，第一批）

**来源**：`core/exec_env.rs::init_host_user_path` 内的 unix/windows 分支 + `#[cfg(unix)]` 的 `resolve_host_user_path` / `seed_path_for_probe`

```rust
// platform/host_path/mod.rs
pub fn resolve_host_path() -> String;
```

- `unix.rs`：登录 shell 探测（`-lic`/`-lc`）+ dedupe + seed path
- `windows.rs`：`resolve_full_path`

**迁移**：`exec_env.rs` 的 `init_host_user_path` 只保留调用逻辑（OnceLock + env 注入），平台解析逻辑抽入 `platform/host_path/`。`dedupe_path` 为纯函数，可保留在 `exec_env.rs` 或一并抽入 unix.rs（按实现决定）。

### 3.5 devtools（DevTools 打开，第二批）

**来源**：`browser/devtools.rs::ensure_detached_devtools` + `browser/webview_ops.rs` 的 Linux Inspector 配置

平台差异是**编译期**而非运行期，故采用编译期 cfg 选择函数（`mod.rs` 同时门控 `mod` 与 `pub use`），
而非 `#[async_trait]` trait 动态分发 —— 固定策略集用 `Enum + match` / cfg 选择优于 `Box<dyn Trait>`。

```rust
// platform/devtools/mod.rs
#[cfg(target_os = "macos")] mod macos;
#[cfg(target_os = "macos")] pub use macos::*;
#[cfg(target_os = "linux")]  mod linux;
#[cfg(target_os = "linux")]  pub use linux::*;
#[cfg(target_os = "windows")] mod windows;
#[cfg(target_os = "windows")] pub use windows::*;
```

统一接口（每平台各一份实现）：
- `async fn ensure_detached_devtools(webview: &tauri::Webview)` —— 打开并确保独立窗口（含 detach 轮询）
- `fn needs_side_effect_compensation() -> bool` —— 是否需要 bounds/zoom 副作用补偿
- `fn configure_inspector(webview: &tauri::Webview)` —— 创建 webview 时的 Inspector 配置（非 Linux 为 no-op）

- `macos.rs`：objc2 轮询 `isVisible` + `detach`；`needs_side_effect_compensation() == true`；`configure_inspector` no-op
- `linux.rs`：webkit2gtk 轮询 `is_attached` + `detach`；`needs_side_effect_compensation() == true`；`configure_inspector` 连接 `connect_attach(|_| false)`（来自 `webview_ops.rs`）
- `windows.rs`：`webview.open_devtools()`；`needs_side_effect_compensation() == false`；`configure_inspector` no-op

**迁移**：`browser/devtools.rs` 仅保留与平台无关的 `compensate_side_effects` 与 `open_devtools_detached`
（调用 `ensure_detached_devtools` + 条件 `compensate_side_effects`）；`webview_ops.rs` 的 `create_webview`
改为无条件调用 `crate::platform::devtools::configure_inspector(&webview)`，移除 `#[cfg(target_os = "linux")]` 块。

## 4. 编译期强制完整性

每个主题 `mod.rs` 用 `#[cfg(target_os = "...")] mod xxx;` + `pub use xxx::*;` 选择平台实现。**当某平台缺少实现文件时，该平台编译直接报错**（`mod` 未声明 / 符号未找到），而非换平台才暴露。这正是本任务的核心收益。

## 5. 边界（不迁移）

> 原规划将 `terminal/mod.rs` 的 shell 选择列为不迁移；实现阶段经评估后**已迁入 `shell_launch/` 主题**（理由：shell 选择与 locale 环境变量同属「跨平台命令构建」主题，归入适配层后 `terminal/mod.rs` 的 task-command 分支只剩薄薄一层调用，且与其他主题共享同一 cfg 门控模式，整体一致性更高）。下表为最终边界。

| 主题 | 理由 |
|------|------|
| `app_menu.rs` | macOS 菜单与 Tauri Menu API 深度绑定，抽离收益低 |
| `terminal/mod.rs` 其余部分 | 已抽离 shell 选择与 locale 至 `shell_launch`，剩余为终端会话管理逻辑，无平台差异 |
| `process_reaper.rs` 的 unix 共享逻辑（`collect_session_processes` / `collect_from_maps` / `kill_processes` / `reap_session_tree`） | unix 平台通用，不属于平台差异，保留在原处 |
| `job_object` / `wsl` 模块 | 已是 Windows 专属独立模块，符合集中化 |

## 6. 兼容性与回滚

- **纯移动**：全部为纯函数/接口迁移，签名不变（`shell_launch`/`process_spawn`/`ide_launch` 等实现阶段扩展主题为对既有 cfg 块的等价抽取），调用方只改 `use` 路径，行为零变化。
- **回滚**：每个主题独立提交；若某主题回归，可单独 revert 该主题的迁移，不影响其他主题。
- **跨平台验证**：当前开发机为 macOS，Linux/Windows 分支无法本地运行验证 → 依赖编译期强制完整性兜底「缺平台实现本机即报错」，并由既有 CI 三平台矩阵（`backend-check` / `backend-test`，`fail-fast: false`）在 ubuntu/macos/windows 三平台跑 `cargo check` + `cargo clippy -D warnings` + `cargo test`，将定位从「抓编译错误」升级为「抓行为错误」。交叉编译检查（`cargo check --target`）作为本地补充验证手段。

## 7. 风险与决策

| 风险 | 决策 |
|------|------|
| Linux/Windows 分支无法本地验证 | `cargo check --target` 交叉编译 + 编译期强制完整性 |
| devtools detach 时序敏感 | 迁移保持轮询常量与逻辑原样，仅移动位置，不改变行为 |
| 文件量大 | 分批实施（第一批纯函数先行），每批独立验证 |
| 命名争议 | 用 `platform/`（简洁）；如需对齐生态可改 `platform_impl/` |
| cfg 拼写错误 | 可选引入 `cfg_aliases`（需确认新增依赖） |
