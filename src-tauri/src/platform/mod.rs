//! 平台差异集中化门面（Platform Adapter）。
//!
//! 将跨平台（macOS / Linux / Windows）的差异逻辑按「主题优先、平台次之」集中于此，
//! 每个主题一个目录，目录内每平台一个实现文件，`mod.rs` 用 `#[cfg]` 选择平台实现。
//! 目标：遗漏某平台实现时编译器立即报错（而非换平台构建才暴露）。
//!
//! 各主题对外只暴露统一接口，业务代码不得在函数体内平铺多平台 `#[cfg]` 块。
//!
//! # 主题索引
//!
//! | 主题 | 统一接口 | 主要来源 |
//! |------|---------|---------|
//! | `reveal` | `build_reveal_command` / `normalize_path` | `file/commands.rs` |
//! | `process_tree` | `snapshot_process_tree` | `terminal/process_reaper.rs` |
//! | `process_memory` | `sample_process_memory_mb` | `lsp/session/utils.rs` |
//! | `host_path` | `resolve_host_path` | `core/exec_env.rs` |
//! | `devtools` | `ensure_detached_devtools` / `needs_side_effect_compensation` / `configure_inspector` | `browser/devtools.rs` + `webview_ops.rs` |
//! | `git_credential` | `platform_default` | `common/git/credential.rs` |
//! | `shell_launch` | `build_task_command` / `apply_locale_env` | `terminal/mod.rs` |
//! | `process_spawn` | `apply_child_flags` / `apply_detached_flags` | `common/executor/local.rs` |
//! | `ide_launch` | `launch_ide_with_fallback` / `spawn_ide_process` | `project/commands_ide.rs` |
//! | `symlink` | `create_link` | `agent/plugin_commands.rs` |
//! | `file_url` | `file_url_to_path` | `lsp/session/root.rs` |
//! | `notify_base` | `notify_base` | `browser/scripts.rs` |

pub mod devtools;
pub mod file_url;
pub mod git_credential;
pub mod host_path;
pub mod ide_launch;
pub mod notify_base;
pub mod process_memory;
pub mod process_spawn;
pub mod process_tree;
pub mod reveal;
pub mod shell_launch;
pub mod symlink;
