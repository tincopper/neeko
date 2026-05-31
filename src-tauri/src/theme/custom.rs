use crate::common::theme_types::{CustomTheme, ThemeListItem};
use std::path::PathBuf;

const REQUIRED_NAMES: &[&str] = &[
    "bg-primary",
    "bg-secondary",
    "text-primary",
    "border-color",
    "accent-blue",
    "accent-green",
    "accent-red",
    "accent-yellow",
];

fn themes_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(home.join(".neeko").join("themes"))
}

/// 扫描 ~/.neeko/themes/*.json，返回可用主题列表
pub fn scan_custom_themes() -> Vec<ThemeListItem> {
    let dir = match themes_dir() {
        Some(d) => d,
        None => return vec![],
    };

    if !dir.exists() {
        return vec![];
    }

    let mut result = vec![];

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string());

            if let Some(ref name) = name {
                match read_and_validate(&path) {
                    Ok(theme) => result.push(ThemeListItem {
                        name: name.clone(),
                        label: theme.name,
                        is_custom: true,
                    }),
                    Err(_) => {
                        // 无效主题不加入列表
                    }
                }
            }
        }
    }

    result
}

/// 读取并验证单个自定义主题 JSON 文件
pub fn read_custom_theme(name: &str) -> Option<CustomTheme> {
    let dir = themes_dir()?;
    let path = dir.join(format!("{}.json", name));
    if !path.exists() {
        return None;
    }
    read_and_validate(&path).ok()
}

fn read_and_validate(path: &PathBuf) -> Result<CustomTheme, String> {
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let theme: CustomTheme =
        serde_json::from_str(&content).map_err(|e| format!("Invalid JSON: {}", e))?;

    if theme.name.trim().is_empty() {
        return Err("Theme name is empty".to_string());
    }

    for required in REQUIRED_NAMES {
        if !theme.variables.contains_key(*required) {
            return Err(format!("Missing required variable: {}", required));
        }
    }

    Ok(theme)
}
