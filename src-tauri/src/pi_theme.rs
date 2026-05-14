use anyhow::Result;
use serde_json::json;
use std::fs;
use std::path::Path;

use crate::opencode_theme::{base64_encode, shell_escape};
use crate::utils::command::ssh::exec;
use crate::utils::command::wsl;

// ═══════════════════════════════════════════════════════════════════════════════
// 内部工具
// ═══════════════════════════════════════════════════════════════════════════════

/// Neeko 主题名 → Pi 主题名
fn map_theme_name(neeko_theme: &str) -> &str {
    match neeko_theme {
        "dark" => "neeko-dark",
        "one-dark-pro" => "neeko-one-dark-pro",
        "claude" => "neeko-claude",
        "light" => "neeko-light",
        _ => "neeko-dark",
    }
}

/// 获取 Pi 用户级主题目录 ~/.pi/agent/themes
fn pi_themes_dir() -> Result<std::path::PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("Failed to get home directory"))?;
    Ok(home.join(".pi").join("agent").join("themes"))
}

// ═══════════════════════════════════════════════════════════════════════════════
// 公共 API
// ═══════════════════════════════════════════════════════════════════════════════

/// 应用启动时调用，写入 4 个主题文件到 ~/.pi/agent/themes/
/// 幂等操作：每次启动更新，确保与代码一致
pub fn install_pi_theme_files() -> Result<()> {
    let themes_dir = pi_themes_dir()?;
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
        "[PiTheme] Installed theme files to {}",
        themes_dir.display()
    );
    Ok(())
}

/// PTY 创建前调用（本地）
/// 备份用户现有 settings.json，合并 theme 字段后写入
pub fn write_project_pi_settings(project_path: &str, neeko_theme: &str) -> Result<()> {
    let pi_dir = Path::new(project_path).join(".pi");
    let settings_path = pi_dir.join("settings.json");
    let backup_path = pi_dir.join("settings.json.neeko.bak");
    let theme_name = map_theme_name(neeko_theme);

    fs::create_dir_all(&pi_dir)?;

    if settings_path.exists() {
        // 备份（仅在没有备份时备份，避免覆盖用户手动恢复后的备份）
        if !backup_path.exists() {
            if let Err(e) = fs::copy(&settings_path, &backup_path) {
                log::warn!("[PiTheme] Failed to backup settings.json: {}", e);
            }
        }

        // 读取并合并
        match fs::read_to_string(&settings_path) {
            Ok(content) => {
                let mut config: serde_json::Value =
                    serde_json::from_str(&content).unwrap_or_else(|_| json!({}));
                if let Some(obj) = config.as_object_mut() {
                    obj.insert("theme".to_string(), json!(theme_name));
                }
                fs::write(&settings_path, serde_json::to_string_pretty(&config)?)?;
            }
            Err(e) => {
                log::warn!("[PiTheme] Failed to read settings.json: {}", e);
                fs::write(
                    &settings_path,
                    serde_json::to_string_pretty(&json!({ "theme": theme_name }))?,
                )?;
            }
        }
    } else {
        // 直接写入
        let config = json!({ "theme": theme_name });
        fs::write(&settings_path, serde_json::to_string_pretty(&config)?)?;
    }

    log::info!(
        "[PiTheme] Written settings.json to {} with theme={}",
        settings_path.display(),
        theme_name
    );
    Ok(())
}

/// 通过 WSL 安装主题文件到 WSL 内部的 ~/.pi/agent/themes/
pub fn install_wsl_pi_theme_files(distro: &str) -> Result<()> {
    let themes_dir = "$HOME/.pi/agent/themes";
    wsl::exec(distro, &format!("mkdir -p {}", themes_dir))?;
    log::debug!("[WSL][PiTheme] mkdir -p {} (distro={})", themes_dir, distro);

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
            "[WSL][PiTheme] Writing {} ({} bytes base64, distro={})",
            path,
            encoded.len(),
            distro
        );
        if let Err(e) = wsl::exec(distro, &cmd) {
            log::error!("[WSL][PiTheme] Failed to write {}: {}", path, e);
            return Err(e);
        }
    }

    log::info!("[PiTheme] Installed WSL theme files for distro={}", distro);
    Ok(())
}

/// WSL 项目终端创建前调用
/// 通过 wsl.exe 在 WSL 内部写入 .pi/settings.json
pub fn write_wsl_pi_settings(distro: &str, project_path: &str, neeko_theme: &str) -> Result<()> {
    let theme_name = map_theme_name(neeko_theme);
    let pi_dir = format!("{}/.pi", project_path);
    let settings_path = format!("{}/settings.json", pi_dir);
    let backup_path = format!("{}/settings.json.neeko.bak", pi_dir);

    log::debug!(
        "[WSL][PiTheme] Writing settings.json: distro={}, path={}, theme={}",
        distro,
        settings_path,
        theme_name
    );

    wsl::exec(distro, &format!("mkdir -p {}", shell_escape(&pi_dir)))?;

    // 备份（如果 settings.json 存在且备份不存在）
    let _ = wsl::exec(
        distro,
        &format!(
            "test -f {} && test ! -f {} && cp {} {}",
            shell_escape(&settings_path),
            shell_escape(&backup_path),
            shell_escape(&settings_path),
            shell_escape(&backup_path)
        ),
    );

    // 读取并合并已有 settings.json
    let merged_content = match wsl::exec(distro, &format!("cat {}", shell_escape(&settings_path))) {
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

    // 写入 settings.json
    let encoded = base64_encode(&merged_content);
    wsl::exec(
        distro,
        &format!(
            "echo '{}' | base64 -d > {}",
            encoded,
            shell_escape(&settings_path)
        ),
    )?;

    log::info!(
        "[PiTheme] Written WSL settings.json to {} with theme={} (merged)",
        settings_path,
        theme_name
    );
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSH 远程操作
// ═══════════════════════════════════════════════════════════════════════════════

/// 通过 SSH 在远程服务器上安装 Pi 主题文件
/// 将 4 个主题 JSON 写入远程 ~/.pi/agent/themes/
/// 合并为单条 shell 命令（一个 channel 只能 exec 一次）
pub async fn install_remote_pi_theme_files(
    channel: &mut russh::Channel<russh::client::Msg>,
) -> Result<()> {
    let themes = [
        ("neeko-dark", generate_dark_theme()),
        ("neeko-one-dark-pro", generate_one_dark_pro_theme()),
        ("neeko-claude", generate_claude_theme()),
        ("neeko-light", generate_light_theme()),
    ];

    let themes_dir = "$HOME/.pi/agent/themes";
    let mut script = format!("mkdir -p {}", themes_dir);
    for (name, theme_json) in &themes {
        let json_str = serde_json::to_string_pretty(theme_json)?;
        let encoded = base64_encode(&json_str);
        let path = format!("{}/{}.json", themes_dir, name);
        script.push_str(&format!(" && echo '{}' | base64 -d > {}", encoded, path));
    }

    log::debug!(
        "[SSH][PiTheme] Installing remote Pi theme files ({} bytes script)",
        script.len()
    );
    exec(channel, &script).await?;

    log::info!("[PiTheme] Installed remote Pi theme files");
    Ok(())
}

/// 通过 SSH 在远程项目目录写入 .pi/settings.json
/// 合并为单条 shell 命令（一个 channel 只能 exec 一次）
pub async fn write_remote_pi_settings(
    channel: &mut russh::Channel<russh::client::Msg>,
    project_path: &str,
    neeko_theme: &str,
) -> Result<()> {
    let theme_name = map_theme_name(neeko_theme);
    let pi_dir = format!("{}/.pi", project_path);
    let settings_path = format!("{}/settings.json", pi_dir);
    let backup_path = format!("{}/settings.json.neeko.bak", pi_dir);

    let config = json!({ "theme": theme_name });
    let content = serde_json::to_string_pretty(&config)?;
    let encoded = base64_encode(&content);

    // mkdir + backup + write 合并为一条命令
    let script = format!(
        "mkdir -p {} && (test -f {} && test ! -f {} && cp {} {}; true) && echo '{}' | base64 -d > {}",
        shell_escape(&pi_dir),
        shell_escape(&settings_path),
        shell_escape(&backup_path),
        shell_escape(&settings_path),
        shell_escape(&backup_path),
        encoded,
        shell_escape(&settings_path),
    );

    log::debug!(
        "[SSH][PiTheme] Writing remote settings.json to {} (theme={})",
        settings_path,
        theme_name
    );
    exec(channel, &script).await?;

    log::info!(
        "[PiTheme] Written remote settings.json to {} with theme={}",
        settings_path,
        theme_name
    );
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// 主题 JSON 生成
// ═══════════════════════════════════════════════════════════════════════════════

/// Pi 主题 51 色 token 结构体
struct PiThemeColors {
    name: &'static str,
    // vars section (可复用变量定义)
    vars: &'static [(&'static str, &'static str)],
    // Core UI (11)
    accent: &'static str,
    border: &'static str,
    border_accent: &'static str,
    border_muted: &'static str,
    success: &'static str,
    error: &'static str,
    warning: &'static str,
    muted: &'static str,
    dim: &'static str,
    text: &'static str,
    thinking_text: &'static str,
    // Backgrounds & Content (11)
    selected_bg: &'static str,
    user_message_bg: &'static str,
    user_message_text: &'static str,
    custom_message_bg: &'static str,
    custom_message_text: &'static str,
    custom_message_label: &'static str,
    tool_pending_bg: &'static str,
    tool_success_bg: &'static str,
    tool_error_bg: &'static str,
    tool_title: &'static str,
    tool_output: &'static str,
    // Markdown (10)
    md_heading: &'static str,
    md_link: &'static str,
    md_link_url: &'static str,
    md_code: &'static str,
    md_code_block: &'static str,
    md_code_block_border: &'static str,
    md_quote: &'static str,
    md_quote_border: &'static str,
    md_hr: &'static str,
    md_list_bullet: &'static str,
    // Tool Diffs (3)
    tool_diff_added: &'static str,
    tool_diff_removed: &'static str,
    tool_diff_context: &'static str,
    // Syntax Highlighting (9)
    syntax_comment: &'static str,
    syntax_keyword: &'static str,
    syntax_function: &'static str,
    syntax_variable: &'static str,
    syntax_string: &'static str,
    syntax_number: &'static str,
    syntax_type: &'static str,
    syntax_operator: &'static str,
    syntax_punctuation: &'static str,
    // Thinking Level Borders (6)
    thinking_off: &'static str,
    thinking_minimal: &'static str,
    thinking_low: &'static str,
    thinking_medium: &'static str,
    thinking_high: &'static str,
    thinking_xhigh: &'static str,
    // Bash Mode (1)
    bash_mode: &'static str,
    // Export (optional)
    export_page_bg: &'static str,
    export_card_bg: &'static str,
    export_info_bg: &'static str,
}

fn build_pi_theme_json(c: &PiThemeColors) -> serde_json::Value {
    // vars section
    let mut vars = serde_json::Map::new();
    for (key, val) in c.vars {
        vars.insert((*key).to_string(), json!(*val));
    }

    // colors section (all 51 tokens)
    let mut colors = serde_json::Map::new();
    // Core UI
    colors.insert("accent".into(), json!(c.accent));
    colors.insert("border".into(), json!(c.border));
    colors.insert("borderAccent".into(), json!(c.border_accent));
    colors.insert("borderMuted".into(), json!(c.border_muted));
    colors.insert("success".into(), json!(c.success));
    colors.insert("error".into(), json!(c.error));
    colors.insert("warning".into(), json!(c.warning));
    colors.insert("muted".into(), json!(c.muted));
    colors.insert("dim".into(), json!(c.dim));
    colors.insert("text".into(), json!(c.text));
    colors.insert("thinkingText".into(), json!(c.thinking_text));
    // Backgrounds & Content
    colors.insert("selectedBg".into(), json!(c.selected_bg));
    colors.insert("userMessageBg".into(), json!(c.user_message_bg));
    colors.insert("userMessageText".into(), json!(c.user_message_text));
    colors.insert("customMessageBg".into(), json!(c.custom_message_bg));
    colors.insert("customMessageText".into(), json!(c.custom_message_text));
    colors.insert("customMessageLabel".into(), json!(c.custom_message_label));
    colors.insert("toolPendingBg".into(), json!(c.tool_pending_bg));
    colors.insert("toolSuccessBg".into(), json!(c.tool_success_bg));
    colors.insert("toolErrorBg".into(), json!(c.tool_error_bg));
    colors.insert("toolTitle".into(), json!(c.tool_title));
    colors.insert("toolOutput".into(), json!(c.tool_output));
    // Markdown
    colors.insert("mdHeading".into(), json!(c.md_heading));
    colors.insert("mdLink".into(), json!(c.md_link));
    colors.insert("mdLinkUrl".into(), json!(c.md_link_url));
    colors.insert("mdCode".into(), json!(c.md_code));
    colors.insert("mdCodeBlock".into(), json!(c.md_code_block));
    colors.insert("mdCodeBlockBorder".into(), json!(c.md_code_block_border));
    colors.insert("mdQuote".into(), json!(c.md_quote));
    colors.insert("mdQuoteBorder".into(), json!(c.md_quote_border));
    colors.insert("mdHr".into(), json!(c.md_hr));
    colors.insert("mdListBullet".into(), json!(c.md_list_bullet));
    // Tool Diffs
    colors.insert("toolDiffAdded".into(), json!(c.tool_diff_added));
    colors.insert("toolDiffRemoved".into(), json!(c.tool_diff_removed));
    colors.insert("toolDiffContext".into(), json!(c.tool_diff_context));
    // Syntax
    colors.insert("syntaxComment".into(), json!(c.syntax_comment));
    colors.insert("syntaxKeyword".into(), json!(c.syntax_keyword));
    colors.insert("syntaxFunction".into(), json!(c.syntax_function));
    colors.insert("syntaxVariable".into(), json!(c.syntax_variable));
    colors.insert("syntaxString".into(), json!(c.syntax_string));
    colors.insert("syntaxNumber".into(), json!(c.syntax_number));
    colors.insert("syntaxType".into(), json!(c.syntax_type));
    colors.insert("syntaxOperator".into(), json!(c.syntax_operator));
    colors.insert("syntaxPunctuation".into(), json!(c.syntax_punctuation));
    // Thinking
    colors.insert("thinkingOff".into(), json!(c.thinking_off));
    colors.insert("thinkingMinimal".into(), json!(c.thinking_minimal));
    colors.insert("thinkingLow".into(), json!(c.thinking_low));
    colors.insert("thinkingMedium".into(), json!(c.thinking_medium));
    colors.insert("thinkingHigh".into(), json!(c.thinking_high));
    colors.insert("thinkingXhigh".into(), json!(c.thinking_xhigh));
    // Bash Mode
    colors.insert("bashMode".into(), json!(c.bash_mode));

    // export section
    let mut export = serde_json::Map::new();
    export.insert("pageBg".into(), json!(c.export_page_bg));
    export.insert("cardBg".into(), json!(c.export_card_bg));
    export.insert("infoBg".into(), json!(c.export_info_bg));

    // root
    let mut root = serde_json::Map::new();
    root.insert(
        "$schema".into(),
        json!("https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json"),
    );
    root.insert("name".into(), json!(c.name));
    if !c.vars.is_empty() {
        root.insert("vars".into(), serde_json::Value::Object(vars));
    }
    root.insert("colors".into(), serde_json::Value::Object(colors));
    root.insert("export".into(), serde_json::Value::Object(export));

    serde_json::Value::Object(root)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4 个主题生成器
// ═══════════════════════════════════════════════════════════════════════════════

fn generate_dark_theme() -> serde_json::Value {
    build_pi_theme_json(&PiThemeColors {
        name: "neeko-dark",
        vars: &[
            ("blue", "#61afef"),
            ("green", "#98c379"),
            ("yellow", "#e5c07b"),
            ("red", "#e06c75"),
            ("cyan", "#56b6c2"),
            ("gray", "#888888"),
            ("dimGray", "#666666"),
            ("darkGray", "#333333"),
        ],
        // Core UI
        accent: "blue",
        border: "blue",
        border_accent: "cyan",
        border_muted: "darkGray",
        success: "green",
        error: "red",
        warning: "yellow",
        muted: "gray",
        dim: "dimGray",
        text: "",
        thinking_text: "gray",
        // Backgrounds
        selected_bg: "#3f4045",
        user_message_bg: "#252528",
        user_message_text: "",
        custom_message_bg: "#2d2e32",
        custom_message_text: "",
        custom_message_label: "blue",
        tool_pending_bg: "#2d2e32",
        tool_success_bg: "#283228",
        tool_error_bg: "#3c2828",
        tool_title: "",
        tool_output: "gray",
        // Markdown
        md_heading: "yellow",
        md_link: "blue",
        md_link_url: "dimGray",
        md_code: "blue",
        md_code_block: "green",
        md_code_block_border: "gray",
        md_quote: "gray",
        md_quote_border: "gray",
        md_hr: "gray",
        md_list_bullet: "blue",
        // Diffs
        tool_diff_added: "green",
        tool_diff_removed: "red",
        tool_diff_context: "gray",
        // Syntax (One Dark palette)
        syntax_comment: "#5c6370",
        syntax_keyword: "#c678dd",
        syntax_function: "#61afef",
        syntax_variable: "#e06c75",
        syntax_string: "#98c379",
        syntax_number: "#d19a66",
        syntax_type: "#e5c07b",
        syntax_operator: "#56b6c2",
        syntax_punctuation: "#abb2bf",
        // Thinking
        thinking_off: "darkGray",
        thinking_minimal: "#555555",
        thinking_low: "#5f87af",
        thinking_medium: "blue",
        thinking_high: "#c678dd",
        thinking_xhigh: "red",
        // Bash
        bash_mode: "green",
        // Export
        export_page_bg: "#1a1b1e",
        export_card_bg: "#252528",
        export_info_bg: "#3c3728",
    })
}

fn generate_one_dark_pro_theme() -> serde_json::Value {
    build_pi_theme_json(&PiThemeColors {
        name: "neeko-one-dark-pro",
        vars: &[
            ("blue", "#61afef"),
            ("green", "#98c379"),
            ("yellow", "#e5c07b"),
            ("red", "#e06c75"),
            ("cyan", "#56b6c2"),
            ("gray", "#828997"),
            ("dimGray", "#5c6370"),
            ("darkGray", "#3e4451"),
        ],
        // Core UI
        accent: "blue",
        border: "blue",
        border_accent: "cyan",
        border_muted: "darkGray",
        success: "green",
        error: "red",
        warning: "yellow",
        muted: "gray",
        dim: "dimGray",
        text: "",
        thinking_text: "gray",
        // Backgrounds
        selected_bg: "#464d5b",
        user_message_bg: "#2c313a",
        user_message_text: "",
        custom_message_bg: "#333842",
        custom_message_text: "",
        custom_message_label: "blue",
        tool_pending_bg: "#333842",
        tool_success_bg: "#2e3a2e",
        tool_error_bg: "#3e2c2c",
        tool_title: "",
        tool_output: "gray",
        // Markdown
        md_heading: "yellow",
        md_link: "blue",
        md_link_url: "dimGray",
        md_code: "blue",
        md_code_block: "green",
        md_code_block_border: "gray",
        md_quote: "gray",
        md_quote_border: "gray",
        md_hr: "gray",
        md_list_bullet: "blue",
        // Diffs
        tool_diff_added: "green",
        tool_diff_removed: "red",
        tool_diff_context: "gray",
        // Syntax (One Dark Pro)
        syntax_comment: "#5c6370",
        syntax_keyword: "#c678dd",
        syntax_function: "#61afef",
        syntax_variable: "#e06c75",
        syntax_string: "#98c379",
        syntax_number: "#d19a66",
        syntax_type: "#e5c07b",
        syntax_operator: "#56b6c2",
        syntax_punctuation: "#abb2bf",
        // Thinking
        thinking_off: "darkGray",
        thinking_minimal: "#5c6370",
        thinking_low: "#5f87af",
        thinking_medium: "blue",
        thinking_high: "#c678dd",
        thinking_xhigh: "red",
        // Bash
        bash_mode: "green",
        // Export
        export_page_bg: "#21252b",
        export_card_bg: "#2c313a",
        export_info_bg: "#3c3728",
    })
}

fn generate_claude_theme() -> serde_json::Value {
    build_pi_theme_json(&PiThemeColors {
        name: "neeko-claude",
        vars: &[
            ("terracotta", "#c96442"),
            ("green", "#5a8a5e"),
            ("gold", "#b8860b"),
            ("red", "#c0392b"),
            ("gray", "#7a6555"),
            ("dimGray", "#a89282"),
            ("warmGray", "#d8cdc0"),
        ],
        // Core UI
        accent: "terracotta",
        border: "terracotta",
        border_accent: "#d4764e",
        border_muted: "warmGray",
        success: "green",
        error: "red",
        warning: "gold",
        muted: "gray",
        dim: "dimGray",
        text: "",
        thinking_text: "gray",
        // Backgrounds
        selected_bg: "#d5ccbe",
        user_message_bg: "#faf7f2",
        user_message_text: "",
        custom_message_bg: "#e6dfd6",
        custom_message_text: "",
        custom_message_label: "terracotta",
        tool_pending_bg: "#e6dfd6",
        tool_success_bg: "#e8f0e8",
        tool_error_bg: "#f0e8e8",
        tool_title: "",
        tool_output: "gray",
        // Markdown
        md_heading: "gold",
        md_link: "terracotta",
        md_link_url: "dimGray",
        md_code: "terracotta",
        md_code_block: "green",
        md_code_block_border: "gray",
        md_quote: "gray",
        md_quote_border: "gray",
        md_hr: "warmGray",
        md_list_bullet: "terracotta",
        // Diffs
        tool_diff_added: "green",
        tool_diff_removed: "red",
        tool_diff_context: "gray",
        // Syntax (Claude earthy palette)
        syntax_comment: "#a89282",
        syntax_keyword: "#8b5cf6",
        syntax_function: "#c96442",
        syntax_variable: "#c0392b",
        syntax_string: "#5a8a5e",
        syntax_number: "#b8860b",
        syntax_type: "#b8860b",
        syntax_operator: "#c96442",
        syntax_punctuation: "#2d1e14",
        // Thinking
        thinking_off: "warmGray",
        thinking_minimal: "gray",
        thinking_low: "#8b6b4e",
        thinking_medium: "terracotta",
        thinking_high: "#8b5cf6",
        thinking_xhigh: "red",
        // Bash
        bash_mode: "green",
        // Export
        export_page_bg: "#f0ebe2",
        export_card_bg: "#faf7f2",
        export_info_bg: "#fffae6",
    })
}

fn generate_light_theme() -> serde_json::Value {
    build_pi_theme_json(&PiThemeColors {
        name: "neeko-light",
        vars: &[
            ("blue", "#2f7cd3"),
            ("green", "#4a9e3f"),
            ("yellow", "#c49000"),
            ("red", "#d32f2f"),
            ("gray", "#6e6e6e"),
            ("dimGray", "#a0a0a0"),
            ("lightGray", "#d4d4d4"),
        ],
        // Core UI
        accent: "blue",
        border: "blue",
        border_accent: "blue",
        border_muted: "lightGray",
        success: "green",
        error: "red",
        warning: "yellow",
        muted: "gray",
        dim: "dimGray",
        text: "",
        thinking_text: "gray",
        // Backgrounds
        selected_bg: "#d2d4d9",
        user_message_bg: "#ffffff",
        user_message_text: "",
        custom_message_bg: "#f4f5f7",
        custom_message_text: "",
        custom_message_label: "blue",
        tool_pending_bg: "#f4f5f7",
        tool_success_bg: "#e8f0e8",
        tool_error_bg: "#f0e8e8",
        tool_title: "",
        tool_output: "gray",
        // Markdown
        md_heading: "yellow",
        md_link: "blue",
        md_link_url: "dimGray",
        md_code: "blue",
        md_code_block: "green",
        md_code_block_border: "gray",
        md_quote: "gray",
        md_quote_border: "gray",
        md_hr: "lightGray",
        md_list_bullet: "green",
        // Diffs
        tool_diff_added: "green",
        tool_diff_removed: "red",
        tool_diff_context: "gray",
        // Syntax (Light palette)
        syntax_comment: "#a0a1a7",
        syntax_keyword: "#a626a4",
        syntax_function: "#4078f2",
        syntax_variable: "#e45649",
        syntax_string: "#50a14f",
        syntax_number: "#986801",
        syntax_type: "#986801",
        syntax_operator: "#4078f2",
        syntax_punctuation: "#383a42",
        // Thinking
        thinking_off: "lightGray",
        thinking_minimal: "dimGray",
        thinking_low: "blue",
        thinking_medium: "#2f7cd3",
        thinking_high: "#875f87",
        thinking_xhigh: "#8b008b",
        // Bash
        bash_mode: "green",
        // Export
        export_page_bg: "#ebecf0",
        export_card_bg: "#ffffff",
        export_info_bg: "#fffae6",
    })
}
