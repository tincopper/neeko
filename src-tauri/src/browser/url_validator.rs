//! URL 安全校验:确保浏览器 webview 仅允许 http/https/file(白名单内)导航,
//! 防止 javascript:/data: 等危险 scheme 和路径穿越提权。

use crate::AppError;

/// 校验 URL scheme 是否安全(允许 http/https;file 仅限白名单根目录内)。
///
/// `allowed_file_root` 为 file:// 导航允许的根目录(项目根)。传入 `None` 时
/// 拒绝任何 file:// URL(防御:无项目上下文时不允许浏览本地文件)。
pub fn validate_url_scheme(
    url: &str,
    allowed_file_root: Option<&std::path::Path>,
) -> Result<(), AppError> {
    let trimmed = url.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(());
    }
    if trimmed.starts_with("file://") {
        validate_file_url(trimmed, allowed_file_root)
    } else {
        Err(AppError::InvalidInput(format!(
            "URL scheme not allowed (only http/https/file): {}",
            trimmed
        )))
    }
}

/// 校验 file:// URL 的本地路径位于白名单根目录内(经 canonicalize 防穿越)。
fn validate_file_url(
    url: &str,
    allowed_file_root: Option<&std::path::Path>,
) -> Result<(), AppError> {
    let root = match allowed_file_root {
        Some(r) => r,
        None => {
            return Err(AppError::InvalidInput(
                "file:// URL not allowed: no allowlisted project root".into(),
            ))
        }
    };

    // 剥离 file:// 前缀与查询/fragment(防御性)
    let path_str = url.trim_start_matches("file://");
    let path_str = path_str.split(['?', '#']).next().unwrap_or(path_str);
    let raw_path = std::path::PathBuf::from(path_str);

    let root_canon = root
        .canonicalize()
        .map_err(|e| AppError::InvalidInput(format!("Invalid project root: {e}")))?;
    let path_canon = raw_path
        .canonicalize()
        .map_err(|_| AppError::InvalidInput(format!("File not found or inaccessible: {}", url)))?;

    if path_canon.starts_with(&root_canon) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "file:// URL outside project root: {}",
            url
        )))
    }
}

/// 从项目 ID 解析项目根作为 file:// 白名单基准。
/// 无对应项目时返回 `None`(file:// 将被拒绝)。
pub fn resolve_project_root(
    state: &crate::app_state::AppStateWrapper,
    project_id: &str,
) -> Option<std::path::PathBuf> {
    let manager = state.project_manager.lock().ok()?;
    manager.get_project(project_id).map(|p| p.path.clone())
}

/// 从 webview label(`neeko-browser-{projectId}`)反推项目根作为 file:// 白名单基准。
/// 非浏览器 label 或无对应项目时返回 `None`(file:// 将被拒绝)。
pub fn resolve_allowed_file_root(
    state: &crate::app_state::AppStateWrapper,
    label: &str,
) -> Option<std::path::PathBuf> {
    let project_id = label.strip_prefix("neeko-browser-")?;
    resolve_project_root(state, project_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::StorageManager;
    use std::sync::Arc;

    /// 构造隔离的 AppStateWrapper：StorageManager 指向临时目录，
    /// 严禁使用默认 `~/.neeko`（否则 add_project 的 auto-save 会覆盖用户数据）。
    fn isolated_state(tmp: &tempfile::TempDir) -> crate::app_state::AppStateWrapper {
        let storage = StorageManager::with_dir(tmp.path().join(".neeko")).unwrap();
        let store = Arc::new(crate::library::LibraryStore::open_in_memory().unwrap());
        crate::app_state::AppStateWrapper::new_with_storage_and_library(storage, store)
    }

    #[test]
    fn test_validate_url_scheme_http() {
        assert!(validate_url_scheme("http://localhost:3000", None).is_ok());
    }

    #[test]
    fn test_validate_url_scheme_https() {
        assert!(validate_url_scheme("https://github.com", None).is_ok());
    }

    #[test]
    fn test_validate_url_scheme_ftp_rejected() {
        let result = validate_url_scheme("ftp://example.com", None);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::InvalidInput(_) => {} // expected
            other => panic!("Expected InvalidInput error, got: {:?}", other),
        }
    }

    #[test]
    fn test_validate_url_scheme_file_without_root_rejected() {
        // 无白名单根时 file:// 一律拒绝(防御)
        let result = validate_url_scheme("file:///tmp/a.html", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_scheme_file_allowed_inside_root() {
        let root = tempfile::tempdir().unwrap();
        let inner = root.path().join("sub");
        std::fs::create_dir_all(&inner).unwrap();
        let file_path = inner.join("test.html");
        std::fs::write(&file_path, "<html></html>").unwrap();

        let file_url = format!("file://{}", file_path.display());
        let result = validate_url_scheme(&file_url, Some(root.path()));
        assert!(
            result.is_ok(),
            "in-allowlist file:// should pass: {:?}",
            result
        );
    }

    #[test]
    fn test_validate_url_scheme_file_outside_root_rejected() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let file_path = outside.path().join("secret.txt");
        std::fs::write(&file_path, "secret").unwrap();

        let file_url = format!("file://{}", file_path.display());
        let result = validate_url_scheme(&file_url, Some(root.path()));
        assert!(result.is_err(), "out-of-allowlist file:// must be rejected");
    }

    #[test]
    fn test_validate_url_scheme_file_traversal_rejected() {
        let root = tempfile::tempdir().unwrap();
        // 构造一个白名单内不存在的穿越路径:root/../secret.txt
        let traversal = root.path().join("..").join("..").join("etc").join("passwd");
        let file_url = format!("file://{}", traversal.display());
        // canonicalize 对不存在路径失败 -> 拒绝
        let result = validate_url_scheme(&file_url, Some(root.path()));
        assert!(result.is_err(), "traversal file:// must be rejected");
    }

    #[test]
    fn test_validate_url_scheme_javascript_rejected() {
        let result = validate_url_scheme("javascript:alert(1)", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_scheme_empty() {
        let result = validate_url_scheme("", None);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_scheme_with_whitespace() {
        assert!(validate_url_scheme("  https://example.com  ", None).is_ok());
    }

    #[test]
    fn test_validate_file_url_normalizes_query_fragment() {
        // 带查询串/锚点的 file URL 仍解析为路径并校验
        let root = tempfile::tempdir().unwrap();
        let file_path = root.path().join("page.html");
        std::fs::write(&file_path, "<html></html>").unwrap();
        let file_url = format!("file://{}?x=1#top", file_path.display());
        let result = validate_url_scheme(&file_url, Some(root.path()));
        assert!(result.is_ok());
    }

    #[test]
    fn test_resolve_project_root_unknown_id_returns_none() {
        // 未知项目 ID -> None(不 panic)
        let tmp = tempfile::tempdir().unwrap();
        let state = isolated_state(&tmp);
        assert!(resolve_project_root(&state, "unknown-project").is_none());
    }

    #[test]
    fn test_resolve_project_root_returns_registered_project_path() {
        // 已注册项目 -> 返回项目根,且 file:// 校验可据此放行根内文件
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("page.html");
        std::fs::write(&file_path, "<html></html>").unwrap();

        let state = isolated_state(&tmp);
        let project = state
            .project_manager
            .lock()
            .unwrap()
            .add_project(tmp.path().to_path_buf(), None, None, None)
            .expect("add_project should succeed");

        let root = resolve_project_root(&state, &project.id);
        assert_eq!(root.as_deref(), Some(tmp.path()));

        // 与 open_in_default_browser 相同的调用链:project_id -> root -> 校验
        let file_url = format!("file://{}", file_path.display());
        assert!(validate_url_scheme(&file_url, root.as_deref()).is_ok());
    }

    #[test]
    fn test_resolve_allowed_file_root_from_label() {
        // 非浏览器 label 或未知项目 -> None(不 panic)
        let tmp = tempfile::tempdir().unwrap();
        let state = isolated_state(&tmp);
        assert!(resolve_allowed_file_root(&state, "neeko-browser-unknown").is_none());
        assert!(resolve_allowed_file_root(&state, "other-label").is_none());
    }

    #[test]
    fn test_file_path_helpers() {
        // fileUrlToFilePath 对应逻辑在 TS 侧;此处验证 Rust 侧路径拼接假设
        // Windows 上 `/tmp` 是无盘符的根相对路径,is_absolute() 为 false,按平台取绝对路径样例
        #[cfg(windows)]
        let absolute = std::path::Path::new(r"C:\tmp");
        #[cfg(not(windows))]
        let absolute = std::path::Path::new("/tmp");
        assert!(absolute.is_absolute());
    }
}
