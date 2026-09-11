//! Host / project execution environment (PATH) policy.
//!
//! Local GUI apps inherit a minimal PATH from launchd. This module resolves the
//! user's interactive/login shell PATH once at startup and injects it into the
//! process environment so [`crate::common::executor::local::LocalExecutor`] and
//! other local spawns can find tools (fnm, homebrew, cargo, …).
//!
//! WSL/SSH user PATH is handled inside those executors via login-shell wrapping
//! (see `common/executor/{wsl,ssh}.rs`), not here — those environments do not
//! share the host process PATH.

use std::sync::OnceLock;

static INIT: OnceLock<()> = OnceLock::new();

/// Resolve the host user shell PATH once and write it into the process env.
///
/// Safe to call multiple times; only the first call performs resolution.
/// 平台解析逻辑已集中到 `crate::platform::host_path::resolve_host_path`。
pub fn init_host_user_path() {
    INIT.get_or_init(|| {
        let resolved = crate::platform::host_path::resolve_host_path();
        if resolved.trim().is_empty() {
            log::warn!(
                "[exec_env] Failed to resolve host user PATH; falling back to the process PATH"
            );
        }
        // 回归背景：解析失败时曾直接把 PATH 写成 `~/.neeko/bin` —— 系统 PATH 被清空，
        // `command_exists` / LocalExecutor 全线解析不到命令。解析结果为空一律回退进程
        // 当前 PATH，再置顶 Neeko 自管目录。
        let base = base_path(&resolved, &std::env::var("PATH").unwrap_or_default());
        // Neeko 自管工具（如 jdtls 官方发行版下载生成的 `~/.neeko/bin/jdtls`）置顶，
        // 确保下载式安装产物可被 `command_exists` / LocalExecutor 解析。
        let full_path = crate::platform::host_path::prepend_neeko_bin(&base);
        log::info!(
            "[exec_env] Injected host PATH (len={}), resolved={}",
            full_path.len(),
            !resolved.trim().is_empty()
        );
        // SAFETY: called once at process start before concurrent readers matter.
        std::env::set_var("PATH", &full_path);
    });
}

/// 选基准 PATH：host 解析结果非空则用之；为空（解析失败）回退进程当前 PATH。
///
/// 绝不返回空串后交给 `prepend_neeko_bin` —— 那会把 PATH 收窄成只剩
/// `~/.neeko/bin`（见上方回归说明）。
#[must_use]
fn base_path(resolved: &str, process_path: &str) -> String {
    if resolved.trim().is_empty() {
        process_path.to_string()
    } else {
        resolved.to_string()
    }
}

/// Current host PATH used for local binary resolution (after init).
#[must_use]
pub fn host_user_path() -> String {
    crate::common::utils::command::local::resolve_full_path()
}

/// Whether `command` exists on the host PATH (same source as LocalExecutor).
///
/// Crate-private: business code must use [`crate::core::exec::command_exists`]
/// with an [`crate::common::executor::factory::ExecTarget`].
pub(crate) fn local_command_exists(command: &str) -> bool {
    crate::common::utils::command::local::command_exists_on_path(command, &host_user_path())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_path_prefers_resolved_host_path_when_present() {
        assert_eq!(
            base_path("/opt/homebrew/bin:/usr/bin", "/fallback"),
            "/opt/homebrew/bin:/usr/bin"
        );
    }

    /// L9 回归：host PATH 解析失败（空/空白）必须回退进程当前 PATH ——
    /// 此前会退化成只剩 `~/.neeko/bin`，系统命令全部解析不到。
    #[test]
    fn base_path_falls_back_to_process_path_when_resolution_empty() {
        assert_eq!(base_path("", "/usr/bin:/bin"), "/usr/bin:/bin");
        assert_eq!(base_path("   ", "/usr/bin:/bin"), "/usr/bin:/bin");
        // 两者皆空 → 空串（后续仅剩 neeko bin，无可丢内容，非回归）
        assert_eq!(base_path("", ""), "");
    }

    #[test]
    fn should_report_false_for_nonexistent_local_command() {
        assert!(!local_command_exists("nonexistent_command_xyz_12345"));
    }

    #[test]
    fn should_report_true_for_common_shell() {
        #[cfg(windows)]
        assert!(local_command_exists("cmd"));
        #[cfg(not(windows))]
        assert!(local_command_exists("sh") || local_command_exists("bash"));
    }

    // ── hermetic: 显式 PATH 隔离（不依赖本机是否装 opencode/sh）──────

    #[test]
    fn hermetic_command_exists_on_path_with_temp_binary() {
        use crate::common::utils::command::local::command_exists_on_path;
        let dir = tempfile::tempdir().expect("tempdir");
        let bin_name = if cfg!(target_os = "windows") {
            "hermetic_bin.exe"
        } else {
            "hermetic_bin"
        };
        let bin_path = dir.path().join(bin_name);
        std::fs::write(&bin_path, b"#!/bin/sh\necho hi").expect("write");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perm = std::fs::metadata(&bin_path)
                .expect("metadata")
                .permissions();
            perm.set_mode(0o755);
            std::fs::set_permissions(&bin_path, perm).expect("chmod");
        }
        let path = dir.path().to_string_lossy().to_string();
        assert!(command_exists_on_path(bin_name, &path));
        assert!(!command_exists_on_path(bin_name, ""));
        assert!(!command_exists_on_path("not-exist-xyz-987654", &path));
    }
}
