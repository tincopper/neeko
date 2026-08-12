//! 应用元数据组装（About 域业务层）。

use serde::Serialize;

/// 应用版本/元数据信息，供前端 About 页展示。
///
/// 序列化采用 camelCase，与前端 `src/shared/types/app.ts` 的 `AppInfo` 字段对齐。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// 应用名称（如 "Neeko"）。
    pub name: String,
    /// 应用版本号（语义化版本，如 "1.0.6"）。
    pub version: String,
    /// 应用包标识符（如 "com.neeko.desktop"）。
    pub identifier: String,
    /// 应用描述。
    pub description: Option<String>,
    /// 作者字符串。
    pub authors: Option<String>,
    /// 许可证（SPDX 标识，如 "Apache-2.0"）。
    pub license: String,
    /// Tauri 框架版本。
    pub tauri_version: String,
    /// 操作系统名称（macos / linux / windows）。
    pub os: String,
    /// CPU 架构（aarch64 / x86_64 …）。
    pub arch: String,
    /// 版权声明。
    pub copyright: Option<String>,
}

/// 组装应用元数据 —— 纯函数，所有来源已由调用方解析为字符串/Option，
/// 不依赖 Tauri runtime 即可单测。生产路径由 `about::commands::get_app_info`
/// 注入来自 `AppHandle` 的值。
#[must_use]
pub fn build_app_info(
    name: String,
    version: String,
    identifier: String,
    description: Option<String>,
    authors: Option<String>,
    copyright: Option<String>,
) -> AppInfo {
    AppInfo {
        name,
        version,
        identifier,
        description,
        authors,
        license: env!("CARGO_PKG_LICENSE").to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        copyright,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_input() -> (
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) {
        (
            "Neeko".into(),
            "1.0.6".into(),
            "com.neeko.desktop".into(),
            Some("Multi-project AI agent session manager".into()),
            Some("Tomgs".into()),
            Some("Copyright © 2024 Tomgs. All rights reserved.".into()),
        )
    }

    fn sample_app_info() -> AppInfo {
        let (name, version, identifier, description, authors, copyright) = sample_input();
        build_app_info(name, version, identifier, description, authors, copyright)
    }

    #[test]
    fn maps_all_fields() {
        let info = sample_app_info();
        assert_eq!(info.name, "Neeko");
        assert_eq!(info.version, "1.0.6");
        assert_eq!(info.identifier, "com.neeko.desktop");
        assert_eq!(
            info.description.as_deref(),
            Some("Multi-project AI agent session manager")
        );
        assert_eq!(info.authors.as_deref(), Some("Tomgs"));
        assert_eq!(
            info.copyright.as_deref(),
            Some("Copyright © 2024 Tomgs. All rights reserved.")
        );
        assert_eq!(info.license, env!("CARGO_PKG_LICENSE"));
        assert!(!info.tauri_version.is_empty());
        assert!(!info.os.is_empty());
        assert!(!info.arch.is_empty());
    }

    #[test]
    fn none_when_no_metadata() {
        let info = build_app_info(
            "Neeko".into(),
            "1.0.6".into(),
            "com.neeko.dev".into(),
            None,
            None,
            None,
        );
        assert!(info.description.is_none());
        assert!(info.authors.is_none());
        assert!(info.copyright.is_none());
    }

    #[test]
    fn serializes_camel_case_keys() {
        let info = sample_app_info();
        let value = serde_json::to_value(&info).unwrap();
        let obj = value.as_object().unwrap();
        assert_eq!(
            obj.get("tauriVersion").and_then(|v| v.as_str()),
            Some(tauri::VERSION)
        );
        assert_eq!(obj.get("version").and_then(|v| v.as_str()), Some("1.0.6"));
        assert_eq!(
            obj.get("identifier").and_then(|v| v.as_str()),
            Some("com.neeko.desktop")
        );
        assert!(obj.contains_key("os"));
        assert!(obj.contains_key("arch"));
        // 必须为 camelCase，不得出现 snake_case 键。
        assert!(obj.get("tauri_version").is_none());
    }
}
