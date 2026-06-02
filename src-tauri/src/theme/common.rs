use std::path::PathBuf;

/// Neeko 主题名 → Agent 主题名（OpenCode 和 Pi 共用同一映射）
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
pub fn shell_escape(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// base64 编码（不依赖外部 crate）
pub fn base64_encode(input: &str) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = input.as_bytes();
    let mut result = String::new();

    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };

        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);

        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}

/// 从 ~/.neeko/config.json 读取当前主题
pub fn get_current_theme(config_json: &serde_json::Value) -> String {
    config_json
        .get("theme")
        .and_then(|v| v.as_str())
        .unwrap_or("dark")
        .to_string()
}

/// 从 ~/.neeko/config.json 读取当前主题名（读取文件）
pub fn read_neeko_theme() -> Option<String> {
    let home = dirs::home_dir()?;
    let config_path = home.join(".neeko").join("config.json");
    let content = std::fs::read_to_string(&config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;
    Some(get_current_theme(&config))
}

/// 从 ~/.neeko/config.json 读取布尔配置项
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
