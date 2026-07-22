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
pub fn init_host_user_path() {
    INIT.get_or_init(|| {
        #[cfg(unix)]
        {
            match resolve_host_user_path() {
                Some(full_path) => {
                    log::info!(
                        "[exec_env] Resolved host user PATH (len={}), injecting into process env",
                        full_path.len()
                    );
                    // SAFETY: called once at process start before concurrent readers matter.
                    std::env::set_var("PATH", &full_path);
                }
                None => {
                    log::warn!(
                        "[exec_env] Failed to resolve host user PATH, using process default"
                    );
                }
            }
            log::info!(
                "[exec_env] Effective PATH after resolve: {}",
                std::env::var("PATH").unwrap_or_default()
            );
        }

        #[cfg(windows)]
        {
            let full_path = crate::common::utils::command::local::resolve_full_path();
            log::info!(
                "[exec_env] Merged Windows PATH (len={}), injecting into process env",
                full_path.len()
            );
            std::env::set_var("PATH", &full_path);
        }
    });
}

/// Current host PATH used for local binary resolution (after init).
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

#[cfg(unix)]
fn resolve_host_user_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let seed = seed_path_for_probe();

    // Prefer login+interactive so .zprofile + .zshrc both apply (matches terminal).
    for flags in ["-lic", "-lc"] {
        let output = std::process::Command::new(&shell)
            .args([flags, "printf %s \"$PATH\""])
            .env("PATH", &seed)
            .output();

        let Ok(output) = output else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let path = text.trim().lines().last().unwrap_or("").trim().to_string();
        if !path.is_empty() {
            return Some(dedupe_path(&path, ':'));
        }
    }

    Some(crate::common::utils::command::local::resolve_full_path())
}

/// Minimal PATH so shell startup scripts can find brew/fnm before profiles run.
#[cfg(unix)]
fn seed_path_for_probe() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut parts: Vec<String> = vec![
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        "/usr/bin".into(),
        "/bin".into(),
        "/usr/sbin".into(),
        "/sbin".into(),
        format!("{home}/.local/bin"),
        format!("{home}/.cargo/bin"),
    ];
    if let Ok(current) = std::env::var("PATH") {
        for p in current.split(':') {
            if !p.is_empty() && !parts.iter().any(|x| x == p) {
                parts.push(p.to_string());
            }
        }
    }
    parts.join(":")
}

fn dedupe_path(path: &str, sep: char) -> String {
    let mut seen = std::collections::HashSet::new();
    path.split(sep)
        .filter(|p| !p.is_empty() && seen.insert(*p))
        .collect::<Vec<_>>()
        .join(&sep.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_dedupe_path_entries_preserving_order() {
        assert_eq!(dedupe_path("/a:/b:/a:/c", ':'), "/a:/b:/c");
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
}
