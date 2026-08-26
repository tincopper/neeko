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
        let full_path = crate::platform::host_path::resolve_host_path();
        if full_path.is_empty() {
            log::warn!("[exec_env] Failed to resolve host user PATH, using process default");
        } else {
            log::info!(
                "[exec_env] Resolved host user PATH (len={}), injecting into process env",
                full_path.len()
            );
            // SAFETY: called once at process start before concurrent readers matter.
            std::env::set_var("PATH", &full_path);
        }
        log::info!(
            "[exec_env] Effective PATH after resolve: {}",
            std::env::var("PATH").unwrap_or_default()
        );
    });
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
