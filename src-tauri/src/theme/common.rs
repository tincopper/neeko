use std::path::PathBuf;

use crate::common::executor::factory::ExecTarget;
use crate::common::utils::command::local::base64_write_script;

/// Neeko 主题名 → Agent 主题名（OpenCode 和 Pi 共用同一映射）
#[allow(clippy::must_use_candidate)]
pub fn map_theme_name(neeko_theme: &str) -> &str {
    match neeko_theme {
        "dark" => "neeko-dark",
        "one-dark-pro" => "neeko-one-dark-pro",
        "claude" => "neeko-claude",
        "light" => "neeko-light",
        "classic-dark" => "neeko-classic-dark",
        _ => "neeko-dark",
    }
}

/// 简单的 shell 转义
#[must_use]
pub fn shell_escape(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// 标准 base64 编码 —— 统一走 `base64` crate（避免与 `file_write` 各自实现）。
#[must_use]
pub(crate) fn base64_std(input: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(input.as_bytes())
}

/// 从 ~/.neeko/config.json 读取当前主题
#[must_use]
pub fn get_current_theme(config_json: &serde_json::Value) -> String {
    config_json
        .get("theme")
        .and_then(|v| v.as_str())
        .unwrap_or("dark")
        .to_string()
}

/// 从 ~/.neeko/config.json 读取当前主题名（读取文件）
#[must_use]
pub fn read_neeko_theme() -> Option<String> {
    let home = dirs::home_dir()?;
    let config_path = home.join(".neeko").join("config.json");
    let content = std::fs::read_to_string(&config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;
    Some(get_current_theme(&config))
}

/// 从 ~/.neeko/config.json 读取布尔配置项
#[must_use]
pub fn read_config_bool(key: &str) -> bool {
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
    config.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

/// 获取用户 home 目录下的路径
pub fn home_subdir(subdir: &str) -> std::io::Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "Failed to get home directory")
    })?;
    Ok(home.join(subdir))
}

// ─── WSL 主题文件同步（pi / opencode 共用）───────────────────────────────
//
// 第一性原理：主题写入 = 「建目录 → 备份 → 读旧值合并 → 写回」的固定生命周期，与
// 具体 Agent 无关。收敛到此，换执行环境（如未来别的 shell 通道）只改一处。

/// WSL 执行目标（避免各主题文件重复 `ExecTarget::Wsl { distro }` 构造）。
pub(crate) fn wsl_target(distro: &str) -> ExecTarget {
    ExecTarget::Wsl {
        distro: distro.to_string(),
    }
}

/// WSL 内建目录。
///
/// `dir` 是**字面路径**（经单引号转义，空格安全），不做 shell 变量展开 ——
/// 需要 `$HOME` 前缀时先经 [`wsl_home`] 解析成绝对路径再传入（不得把
/// `"$HOME/…"` 这类模板传进来：单引号会阻止展开，结果会写进字面量 `$HOME` 目录）。
pub(crate) async fn ensure_wsl_dir(target: &ExecTarget, dir: &str) -> anyhow::Result<()> {
    let script = format!("mkdir -p {}", shell_escape(dir));
    let _ = crate::core::exec::collect_script(target, &script, None, &[]).await?;
    Ok(())
}

/// WSL 内解析 `$HOME`（argv `printenv`），供拼绝对路径用。
pub(crate) async fn wsl_home(target: &ExecTarget) -> anyhow::Result<String> {
    let home = crate::core::exec::run(target, "printenv", &["HOME"])
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    let home = home.trim();
    if home.is_empty() {
        anyhow::bail!("WSL login shell returned an empty HOME");
    }
    Ok(home.to_string())
}

/// WSL 内写文件：base64 管道（script 形态），内容任意字节安全。
pub(crate) async fn write_wsl_file(
    target: &ExecTarget,
    path: &str,
    content: &str,
) -> anyhow::Result<()> {
    let script = base64_write_script(&base64_std(content), path);
    let _ = crate::core::exec::collect_script(target, &script, None, &[]).await?;
    Ok(())
}

/// WSL 内读文件（argv `cat`）。
pub(crate) async fn read_wsl_file(target: &ExecTarget, path: &str) -> anyhow::Result<String> {
    crate::core::exec::run(target, "cat", &[path])
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
}

/// 目标文件存在且备份缺失时复制一次（argv `test` / `cp`，不经 shell）。
pub(crate) async fn backup_wsl_file_once(
    target: &ExecTarget,
    path: &str,
    backup: &str,
) -> anyhow::Result<()> {
    let exists = crate::core::exec::run(target, "test", &["-f", path])
        .await
        .is_ok();
    let backup_missing = crate::core::exec::run(target, "test", &["!", "-f", backup])
        .await
        .is_ok();
    if exists && backup_missing {
        let _ = crate::core::exec::run(target, "cp", &[path, backup]).await;
    }
    Ok(())
}

/// WSL 内同步一个携带 `theme` 字段的 JSON 文件（mkdir → 备份 → 读合并 → base64 写）。
/// pi 的 `settings.json` 与 opencode 的 `tui.json` 同构，收敛到这里。
pub(crate) async fn sync_wsl_theme_json(
    target: &ExecTarget,
    dir: &str,
    file_path: &str,
    backup_path: &str,
    theme_name: &str,
) -> anyhow::Result<()> {
    ensure_wsl_dir(target, dir).await?;
    backup_wsl_file_once(target, file_path, backup_path).await?;
    let merged = match read_wsl_file(target, file_path).await {
        Ok(raw) => {
            let mut config: serde_json::Value =
                serde_json::from_str(raw.trim()).unwrap_or_else(|_| serde_json::json!({}));
            if let Some(obj) = config.as_object_mut() {
                obj.insert("theme".to_string(), serde_json::json!(theme_name));
            }
            serde_json::to_string_pretty(&config)?
        }
        Err(_) => serde_json::to_string_pretty(&serde_json::json!({ "theme": theme_name }))?,
    };
    write_wsl_file(target, file_path, &merged).await
}
