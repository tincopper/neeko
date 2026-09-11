/// Unix：通过登录 shell 探测解析用户 PATH（`.zprofile` + `.zshrc` 均生效）。
///
/// **执行接口豁免**（AGENTS.md 规则 #1）：本函数运行在
/// `exec_env::init_host_user_path` **之前**（它就是那个 PATH 的来源），此刻 exec facade
/// 尚不可用，存在先有鸡还是先有蛋的依赖，故直接用 `std::process::Command` 探测登录 shell。
#[must_use]
pub fn resolve_host_path() -> String {
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
            return dedupe_path(&path, ':');
        }
    }

    crate::common::utils::command::local::resolve_full_path()
}

/// Minimal PATH so shell startup scripts can find brew/fnm before profiles run.
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
    fn should_prepend_neeko_bin_preserving_base_path() {
        assert_eq!(
            prepend_bin(Some("/Users/u"), "/usr/bin:/bin"),
            "/Users/u/.neeko/bin:/usr/bin:/bin"
        );
    }

    #[test]
    fn should_return_neeko_bin_only_for_empty_base_path() {
        assert_eq!(prepend_bin(Some("/Users/u"), ""), "/Users/u/.neeko/bin");
    }

    /// HOME 缺失/空白 → 原样返回，不得注入 `/.neeko/bin` 伪路径。
    #[test]
    fn should_not_inject_bogus_neeko_bin_without_home() {
        assert_eq!(prepend_bin(None, "/usr/bin:/bin"), "/usr/bin:/bin");
        assert_eq!(prepend_bin(Some(""), "/usr/bin"), "/usr/bin");
        assert_eq!(prepend_bin(Some("   "), "/usr/bin"), "/usr/bin");
    }
}

/// Unix：把 Neeko 自管工具目录（`~/.neeko/bin`）置顶到 PATH —— 下载式安装
///（如 jdtls 官方发行版生成的 `jdtls` 包装脚本）依赖其被 `command_exists` 解析。
#[must_use]
pub fn prepend_neeko_bin(path: &str) -> String {
    prepend_bin(std::env::var("HOME").ok().as_deref(), path)
}

/// 纯逻辑：把 `<home>/.neeko/bin` 置顶到 `path`。
///
/// `home` 缺失/空白 → 原样返回 `path`：绝不注入 `/.neeko/bin` 这种伪路径
///（HOME 未设时旧实现会拼出 `/.neeko/bin` 并写进进程 PATH）。
#[must_use]
fn prepend_bin(home: Option<&str>, path: &str) -> String {
    let Some(home) = home.map(str::trim).filter(|h| !h.is_empty()) else {
        return path.to_string();
    };
    let neeko_bin = format!("{home}/.neeko/bin");
    if path.trim().is_empty() {
        neeko_bin
    } else {
        format!("{neeko_bin}:{path}")
    }
}
