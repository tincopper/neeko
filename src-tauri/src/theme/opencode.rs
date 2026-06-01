use anyhow::Result;
use serde_json::json;
use std::fs;
use std::path::Path;

use super::common::{base64_encode, map_theme_name, read_config_bool, shell_escape};
use crate::common::utils::command::ssh::exec;
use crate::common::utils::command::wsl;

// ═══════════════════════════════════════════════════════════════════════════════
// 内部工具
// ═══════════════════════════════════════════════════════════════════════════════

/// 获取 OpenCode 用户级主题目录 ~/.config/opencode/themes
fn opencode_themes_dir() -> Result<std::path::PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("Failed to get home directory"))?;
    Ok(home.join(".config").join("opencode").join("themes"))
}

// ═══════════════════════════════════════════════════════════════════════════════
// 公共 API
// ═══════════════════════════════════════════════════════════════════════════════

/// 应用启动时调用，写入 4 个主题文件到 ~/.config/opencode/themes/
/// 幂等操作：每次启动更新，确保与代码一致
pub fn install_theme_files() -> Result<()> {
    let themes_dir = opencode_themes_dir()?;
    fs::create_dir_all(&themes_dir)?;

    let themes = [
        ("neeko-dark", generate_dark_theme()),
        ("neeko-one-dark-pro", generate_one_dark_pro_theme()),
        ("neeko-claude", generate_claude_theme()),
        ("neeko-light", generate_light_theme()),
    ];

    for (name, theme_json) in &themes {
        let path = themes_dir.join(format!("{}.json", name));
        let content = serde_json::to_string_pretty(theme_json)?;
        fs::write(&path, content)?;
    }

    log::info!(
        "[OpenCodeTheme] Installed theme files to {}",
        themes_dir.display()
    );
    Ok(())
}

/// PTY 创建前调用（本地 / WSL）
/// 备份用户现有 tui.json，合并 theme 字段后写入
pub fn write_project_tui_config(project_path: &str, neeko_theme: &str) -> Result<()> {
    let opencode_dir = Path::new(project_path).join(".opencode");
    let tui_path = opencode_dir.join("tui.json");
    let backup_path = opencode_dir.join("tui.json.neeko.bak");
    let theme_name = map_theme_name(neeko_theme);
    let mut wrote = false;

    fs::create_dir_all(&opencode_dir)?;

    if tui_path.exists() {
        // 备份（仅在没有备份时备份，避免覆盖用户手动恢复后的备份）
        if !backup_path.exists() {
            if let Err(e) = fs::copy(&tui_path, &backup_path) {
                log::warn!("[OpenCodeTheme] Failed to backup tui.json: {}", e);
            }
        }

        // 读取并合并
        match fs::read_to_string(&tui_path) {
            Ok(content) => {
                let mut config: serde_json::Value =
                    serde_json::from_str(&content).unwrap_or_else(|_| json!({}));
                if let Some(obj) = config.as_object_mut() {
                    obj.insert("theme".to_string(), json!(theme_name));
                }
                let merged = serde_json::to_string_pretty(&config)?;
                if merged != content {
                    fs::write(&tui_path, merged)?;
                    wrote = true;
                }
            }
            Err(e) => {
                log::warn!("[OpenCodeTheme] Failed to read tui.json: {}", e);
                fs::write(
                    &tui_path,
                    serde_json::to_string_pretty(&json!({ "theme": theme_name }))?,
                )?;
                wrote = true;
            }
        }
    } else {
        // 直接写入
        let config = json!({ "theme": theme_name });
        fs::write(&tui_path, serde_json::to_string_pretty(&config)?)?;
        wrote = true;
    }

    if wrote {
        log::info!(
            "[OpenCodeTheme] Written tui.json to {} with theme={}",
            tui_path.display(),
            theme_name
        );
    } else {
        log::debug!(
            "[OpenCodeTheme] Skip writing tui.json (unchanged): {}",
            tui_path.display()
        );
    }

    Ok(())
}

/// 通过 WSL 安装主题文件到 WSL 内部的 ~/.config/opencode/themes/
pub fn install_wsl_theme_files(distro: &str) -> Result<()> {
    let themes_dir = "$HOME/.config/opencode/themes";
    wsl::exec(distro, &format!("mkdir -p {}", themes_dir))?;
    log::debug!("[WSL][Theme] mkdir -p {} (distro={})", themes_dir, distro);

    let themes = [
        ("neeko-dark", generate_dark_theme()),
        ("neeko-one-dark-pro", generate_one_dark_pro_theme()),
        ("neeko-claude", generate_claude_theme()),
        ("neeko-light", generate_light_theme()),
    ];

    for (name, theme_json) in &themes {
        let json_str = serde_json::to_string_pretty(theme_json)?;
        let encoded = base64_encode(&json_str);
        let path = format!("{}/{}.json", themes_dir, name);
        let cmd = format!("echo '{}' | base64 -d > {}", encoded, path);
        log::debug!(
            "[WSL][Theme] Writing {} ({} bytes base64, distro={})",
            path,
            encoded.len(),
            distro
        );
        if let Err(e) = wsl::exec(distro, &cmd) {
            log::error!("[WSL][Theme] Failed to write {}: {}", path, e);
            return Err(e);
        }
    }

    log::info!(
        "[OpenCodeTheme] Installed WSL theme files for distro={}",
        distro
    );
    Ok(())
}

/// WSL 项目终端创建前调用
/// 通过 wsl.exe 在 WSL 内部写入 .opencode/tui.json
pub fn write_wsl_tui_config(distro: &str, project_path: &str, neeko_theme: &str) -> Result<()> {
    let theme_name = map_theme_name(neeko_theme);
    let opencode_dir = format!("{}/.opencode", project_path);
    let tui_path = format!("{}/tui.json", opencode_dir);
    let backup_path = format!("{}/tui.json.neeko.bak", opencode_dir);

    log::debug!(
        "[WSL][Theme] Writing tui.json: distro={}, tui_path={}, theme={}",
        distro,
        tui_path,
        theme_name
    );

    wsl::exec(distro, &format!("mkdir -p {}", shell_escape(&opencode_dir)))?;

    // 备份（如果 tui.json 存在且备份不存在）
    let _ = wsl::exec(
        distro,
        &format!(
            "test -f {} && test ! -f {} && cp {} {}",
            shell_escape(&tui_path),
            shell_escape(&backup_path),
            shell_escape(&tui_path),
            shell_escape(&backup_path)
        ),
    );

    // 读取并合并已有 tui.json（与本地版本行为一致）
    let merged_content = match wsl::exec(distro, &format!("cat {}", shell_escape(&tui_path))) {
        Ok(raw) => {
            let mut config: serde_json::Value =
                serde_json::from_str(raw.trim()).unwrap_or_else(|_| json!({}));
            if let Some(obj) = config.as_object_mut() {
                obj.insert("theme".to_string(), json!(theme_name));
            }
            serde_json::to_string_pretty(&config)?
        }
        Err(_) => serde_json::to_string_pretty(&json!({ "theme": theme_name }))?,
    };

    // 写入 tui.json
    let encoded = base64_encode(&merged_content);
    wsl::exec(
        distro,
        &format!(
            "echo '{}' | base64 -d > {}",
            encoded,
            shell_escape(&tui_path)
        ),
    )?;

    log::info!(
        "[OpenCodeTheme] Written WSL tui.json to {} with theme={} (merged)",
        tui_path,
        theme_name
    );
    Ok(())
}

/// 从 ~/.neeko/config.json 读取 enable_pi_theme_sync 字段
pub fn read_enable_pi_theme_sync() -> bool {
    read_config_bool("enablePiThemeSync")
}

/// 从 ~/.neeko/config.json 读取 enable_open_code_theme_sync 字段
pub fn read_enable_opencode_theme_sync() -> bool {
    read_config_bool("enableOpenCodeThemeSync")
}

/// Re-export from common for backward compatibility
pub use super::common::get_current_theme;

// ═══════════════════════════════════════════════════════════════════════════════
// SSH 远程操作
// ═══════════════════════════════════════════════════════════════════════════════

/// 通过 SSH 在远程服务器上安装主题文件
/// 将 4 个主题 JSON 写入远程 ~/.config/opencode/themes/
/// 合并为单条 shell 命令（一个 channel 只能 exec 一次）
pub async fn install_remote_theme_files(
    channel: &mut russh::Channel<russh::client::Msg>,
) -> Result<()> {
    let themes = [
        ("neeko-dark", generate_dark_theme()),
        ("neeko-one-dark-pro", generate_one_dark_pro_theme()),
        ("neeko-claude", generate_claude_theme()),
        ("neeko-light", generate_light_theme()),
    ];

    let themes_dir = "$HOME/.config/opencode/themes";
    let mut script = format!("mkdir -p {}", themes_dir);
    for (name, theme_json) in &themes {
        let json_str = serde_json::to_string_pretty(theme_json)?;
        let encoded = base64_encode(&json_str);
        let path = format!("{}/{}.json", themes_dir, name);
        script.push_str(&format!(" && echo '{}' | base64 -d > {}", encoded, path));
    }

    log::debug!(
        "[SSH][Theme] Installing remote theme files ({} bytes script)",
        script.len()
    );
    exec(channel, &script).await?;

    log::info!("[OpenCodeTheme] Installed remote theme files");
    Ok(())
}

/// 通过 SSH 在远程项目目录写入 .opencode/tui.json
/// 合并为单条 shell 命令（一个 channel 只能 exec 一次）
pub async fn write_remote_tui_config(
    channel: &mut russh::Channel<russh::client::Msg>,
    project_path: &str,
    neeko_theme: &str,
) -> Result<()> {
    let theme_name = map_theme_name(neeko_theme);
    let opencode_dir = format!("{}/.opencode", project_path);
    let tui_path = format!("{}/tui.json", opencode_dir);
    let backup_path = format!("{}/tui.json.neeko.bak", opencode_dir);

    let config = json!({ "theme": theme_name });
    let content = serde_json::to_string_pretty(&config)?;
    let encoded = base64_encode(&content);

    // mkdir + backup + write 合并为一条命令
    let script = format!(
        "mkdir -p {} && (test -f {} && test ! -f {} && cp {} {}; true) && echo '{}' | base64 -d > {}",
        shell_escape(&opencode_dir),
        shell_escape(&tui_path),
        shell_escape(&backup_path),
        shell_escape(&tui_path),
        shell_escape(&backup_path),
        encoded,
        shell_escape(&tui_path),
    );

    log::debug!(
        "[SSH][Theme] Writing remote tui.json to {} (theme={})",
        tui_path,
        theme_name
    );
    exec(channel, &script).await?;

    log::info!(
        "[OpenCodeTheme] Written remote tui.json to {} with theme={}",
        tui_path,
        theme_name
    );
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// 主题 JSON 生成
// ═══════════════════════════════════════════════════════════════════════════════

/// 通用主题结构体，减少重复
struct ThemeColors {
    // 基础
    primary: &'static str,
    secondary: &'static str,
    accent: &'static str,
    error: &'static str,
    warning: &'static str,
    success: &'static str,
    info: &'static str,
    text: &'static str,
    text_secondary: &'static str,
    text_muted: &'static str,
    background: &'static str,
    background_panel: &'static str,
    background_element: &'static str,
    border: &'static str,
    border_active: &'static str,
    border_subtle: &'static str,
    // Diff
    diff_added: &'static str,
    diff_removed: &'static str,
    diff_added_bg: &'static str,
    diff_removed_bg: &'static str,
    // Syntax
    syntax_comment: &'static str,
    syntax_keyword: &'static str,
    syntax_function: &'static str,
    syntax_variable: &'static str,
    syntax_string: &'static str,
    syntax_number: &'static str,
    syntax_type: &'static str,
    syntax_operator: &'static str,
    syntax_punctuation: &'static str,
}

fn build_theme_json(c: &ThemeColors) -> serde_json::Value {
    let mut theme = serde_json::Map::new();

    // Required fields
    theme.insert("primary".into(), json_str(c.primary));
    theme.insert("secondary".into(), json_str(c.secondary));
    theme.insert("accent".into(), json_str(c.accent));
    theme.insert("text".into(), json_str(c.text));
    theme.insert("textMuted".into(), json_str(c.text_muted));
    theme.insert("background".into(), json_str(c.background));

    // Status
    theme.insert("error".into(), json_str(c.error));
    theme.insert("warning".into(), json_str(c.warning));
    theme.insert("success".into(), json_str(c.success));
    theme.insert("info".into(), json_str(c.info));

    // Layout
    theme.insert("backgroundPanel".into(), json_str(c.background_panel));
    theme.insert("backgroundElement".into(), json_str(c.background_element));
    theme.insert("border".into(), json_str(c.border));
    theme.insert("borderActive".into(), json_str(c.border_active));
    theme.insert("borderSubtle".into(), json_str(c.border_subtle));

    // Diff
    theme.insert("diffAdded".into(), json_str(c.diff_added));
    theme.insert("diffRemoved".into(), json_str(c.diff_removed));
    theme.insert("diffContext".into(), json_str(c.text_muted));
    theme.insert("diffHunkHeader".into(), json_str(c.text_secondary));
    theme.insert("diffHighlightAdded".into(), json_str(c.diff_added_bg));
    theme.insert("diffHighlightRemoved".into(), json_str(c.diff_removed_bg));
    theme.insert("diffAddedBg".into(), json_str(c.diff_added_bg));
    theme.insert("diffRemovedBg".into(), json_str(c.diff_removed_bg));
    theme.insert("diffContextBg".into(), json_str("none"));
    theme.insert("diffLineNumber".into(), json_str(c.text_muted));
    theme.insert("diffAddedLineNumberBg".into(), json_str(c.diff_added_bg));
    theme.insert(
        "diffRemovedLineNumberBg".into(),
        json_str(c.diff_removed_bg),
    );

    // Markdown
    theme.insert("markdownText".into(), json_str(c.text));
    theme.insert("markdownHeading".into(), json_str(c.primary));
    theme.insert("markdownLink".into(), json_str(c.primary));
    theme.insert("markdownLinkText".into(), json_str(c.secondary));
    theme.insert("markdownCode".into(), json_str(c.secondary));
    theme.insert("markdownBlockQuote".into(), json_str(c.text_secondary));
    theme.insert("markdownEmph".into(), json_str(c.accent));
    theme.insert("markdownStrong".into(), json_str(c.text));
    theme.insert("markdownHorizontalRule".into(), json_str(c.border));
    theme.insert("markdownListItem".into(), json_str(c.primary));
    theme.insert("markdownListEnumeration".into(), json_str(c.accent));
    theme.insert("markdownImage".into(), json_str(c.primary));
    theme.insert("markdownImageText".into(), json_str(c.secondary));
    theme.insert("markdownCodeBlock".into(), json_str(c.secondary));

    // Syntax
    theme.insert("syntaxComment".into(), json_str(c.syntax_comment));
    theme.insert("syntaxKeyword".into(), json_str(c.syntax_keyword));
    theme.insert("syntaxFunction".into(), json_str(c.syntax_function));
    theme.insert("syntaxVariable".into(), json_str(c.syntax_variable));
    theme.insert("syntaxString".into(), json_str(c.syntax_string));
    theme.insert("syntaxNumber".into(), json_str(c.syntax_number));
    theme.insert("syntaxType".into(), json_str(c.syntax_type));
    theme.insert("syntaxOperator".into(), json_str(c.syntax_operator));
    theme.insert("syntaxPunctuation".into(), json_str(c.syntax_punctuation));

    let mut root = serde_json::Map::new();
    root.insert("$schema".into(), json_str("https://opencode.ai/theme.json"));
    root.insert("theme".into(), serde_json::Value::Object(theme));

    serde_json::Value::Object(root)
}

fn json_str(s: &str) -> serde_json::Value {
    serde_json::Value::String(s.to_string())
}

fn generate_dark_theme() -> serde_json::Value {
    build_theme_json(&ThemeColors {
        primary: "#2997ff",
        secondary: "#30d158",
        accent: "#ffd60a",
        error: "#ff453a",
        warning: "#ffd60a",
        success: "#30d158",
        info: "#2997ff",
        text: "#ffffff",
        text_secondary: "#cccccc",
        text_muted: "#999999",
        background: "#181A1C",
        background_panel: "#181A1C",
        background_element: "#333337",
        border: "#3b3b40",
        border_active: "#2997ff",
        border_subtle: "#222225",
        diff_added: "#30d158",
        diff_removed: "#ff453a",
        diff_added_bg: "#30d15820",
        diff_removed_bg: "#ff453a20",
        syntax_comment: "#5c6370",
        syntax_keyword: "#c678dd",
        syntax_function: "#61afef",
        syntax_variable: "#e06c75",
        syntax_string: "#98c379",
        syntax_number: "#d19a66",
        syntax_type: "#e5c07b",
        syntax_operator: "#56b6c2",
        syntax_punctuation: "#abb2bf",
    })
}

fn generate_one_dark_pro_theme() -> serde_json::Value {
    build_theme_json(&ThemeColors {
        primary: "#61afef",
        secondary: "#98c379",
        accent: "#e5c07b",
        error: "#e06c75",
        warning: "#e5c07b",
        success: "#98c379",
        info: "#61afef",
        text: "#abb2bf",
        text_secondary: "#828997",
        text_muted: "#5c6370",
        background: "#2c313a",
        background_panel: "#333842",
        background_element: "#3e4451",
        border: "#3e4451",
        border_active: "#61afef",
        border_subtle: "#3e4451",
        diff_added: "#98c379",
        diff_removed: "#e06c75",
        diff_added_bg: "#98c37920",
        diff_removed_bg: "#e06c7520",
        syntax_comment: "#5c6370",
        syntax_keyword: "#c678dd",
        syntax_function: "#61afef",
        syntax_variable: "#e06c75",
        syntax_string: "#98c379",
        syntax_number: "#d19a66",
        syntax_type: "#e5c07b",
        syntax_operator: "#56b6c2",
        syntax_punctuation: "#abb2bf",
    })
}

fn generate_claude_theme() -> serde_json::Value {
    build_theme_json(&ThemeColors {
        primary: "#c96442",
        secondary: "#5a8a5e",
        accent: "#b8860b",
        error: "#c0392b",
        warning: "#b8860b",
        success: "#5a8a5e",
        info: "#c96442",
        text: "#2d1e14",
        text_secondary: "#7a6555",
        text_muted: "#a89282",
        background: "#faf7f2",
        background_panel: "#e6dfd6",
        background_element: "#dcd4c8",
        border: "#d4c9bb",
        border_active: "#c96442",
        border_subtle: "#d8d0c4",
        diff_added: "#5a8a5e",
        diff_removed: "#c0392b",
        diff_added_bg: "#5a8a5e18",
        diff_removed_bg: "#c0392b18",
        syntax_comment: "#a89282",
        syntax_keyword: "#8b5cf6",
        syntax_function: "#c96442",
        syntax_variable: "#c0392b",
        syntax_string: "#5a8a5e",
        syntax_number: "#b8860b",
        syntax_type: "#b8860b",
        syntax_operator: "#c96442",
        syntax_punctuation: "#2d1e14",
    })
}

fn generate_light_theme() -> serde_json::Value {
    build_theme_json(&ThemeColors {
        primary: "#2f7cd3",
        secondary: "#4a9e3f",
        accent: "#c49000",
        error: "#d32f2f",
        warning: "#c49000",
        success: "#4a9e3f",
        info: "#2f7cd3",
        text: "#1e1e1e",
        text_secondary: "#6e6e6e",
        text_muted: "#a0a0a0",
        background: "#ffffff",
        background_panel: "#f5f5f5",
        background_element: "#e8e8e8",
        border: "#d4d4d4",
        border_active: "#2f7cd3",
        border_subtle: "#e0e0e0",
        diff_added: "#4a9e3f",
        diff_removed: "#d32f2f",
        diff_added_bg: "#4a9e3f15",
        diff_removed_bg: "#d32f2f15",
        syntax_comment: "#a0a1a7",
        syntax_keyword: "#a626a4",
        syntax_function: "#4078f2",
        syntax_variable: "#e45649",
        syntax_string: "#50a14f",
        syntax_number: "#986801",
        syntax_type: "#986801",
        syntax_operator: "#4078f2",
        syntax_punctuation: "#383a42",
    })
}
