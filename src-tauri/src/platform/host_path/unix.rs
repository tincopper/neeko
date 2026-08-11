/// Unix：通过登录 shell 探测解析用户 PATH（`.zprofile` + `.zshrc` 均生效）。
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
}
