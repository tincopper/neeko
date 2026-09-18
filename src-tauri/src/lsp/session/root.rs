//! Workspace-root resolution for LSP sessions (VS Code-style).
//!
//! 会话根按**插件数据**决定（`LspPlugin::root_scope`）：
//!
//! - `RootScope::ProjectScoped`（默认）：会话根 = 项目根，服务器按自己的 markers
//!   找工程。
//! - `RootScope::DocumentScoped { markers }`：会话根 = 从打开文档向上遇到的、含任一
//!   marker 的最近目录（VS Code 语义）。典型是 TS/JS 家族 ——
//!   `typescript-language-server` 从 `initialize` 收到的会话根向上解析
//!   `node_modules/typescript`，而 monorepo 里前端常在自己的子目录（如
//!   `frontend/`）；若按项目根初始化，那里没有 `node_modules`，服务器解析失败。
//!
//! 本模块**不认识任何语言名**：范围与 markers 都来自插件数据（新增语言只加数据）。
//!
//! (Implementation — tests live below.)

use std::path::{Path, PathBuf};

use crate::lsp::plugin::LspPlugin;

/// Resolve the workspace root an LSP session should be initialized with.
///
/// For document-scoped plugins (`RootScope::DocumentScoped`), walk up from the
/// opened document to the nearest directory containing one of the plugin's
/// `markers`, mirroring VS Code's per-document workspace-version resolution.
/// Falls back to `project_path` when no marker is found, no document is given,
/// or the document lies outside the project. Project-scoped plugins always keep
/// `project_path` (their servers locate their own project via their own
/// markers, e.g. `Cargo.toml`).
///
/// ## `file://` URI → path 跨平台转换
///
/// The frontend sends document locations as `file://` URIs. Converting those
/// back to a filesystem path is *not* portable with a single call:
///
/// - On **non-Windows**, `url::Url::parse` + `to_file_path()` correctly turns
///   `file:///unix/path` into `/unix/path`.
/// - On **Windows**, `url::Url::from_directory_path` produces
///   `file:///C:/repo`, but the inverse `to_file_path()` returns `Err` because
///   `url` strictly follows RFC 8089 (the authority component is implicit on
///   Windows file URLs). Using the generic branch would therefore silently
///   fall back to `project_path` on Windows and defeat this whole fix.
///
/// To stay correct on all three platforms, [`file_url_to_path`] picks a
/// dedicated branch per `#[cfg(target_os)]`.
use std::collections::VecDeque;
#[must_use]
pub(crate) fn resolve_session_root(
    project_path: &str,
    document_path: Option<&str>,
    plugin: &LspPlugin,
) -> PathBuf {
    let project_root = Path::new(project_path);
    // 语言无关：范围与 markers 全部来自插件数据（`RootScope`），
    // 本模块不认识任何语言名 —— 新语言声明数据即可获得文档定根。
    let Some(markers) = plugin.root_scope.walk_markers() else {
        return project_root.to_path_buf();
    };
    let Some(doc) = document_path else {
        // No document available (e.g. session restart / auto-start).
        // For monorepos whose frontend lives in a subdirectory, the project
        // root may not be the server's own project. Scan subdirectories.
        if let Some(root) = scan_project_for_root_markers(project_root, markers) {
            return root;
        }
        return project_root.to_path_buf();
    };

    let doc_path = match doc.strip_prefix("file://") {
        Some(rest) => file_url_to_path(rest).unwrap_or_else(|| project_root.to_path_buf()),
        None => PathBuf::from(doc),
    };
    if !contains_document(project_root, &doc_path) {
        // Document outside the project: keep the project root.
        return project_root.to_path_buf();
    }

    let start_dir = if doc_path.is_dir() {
        doc_path
    } else {
        doc_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| project_root.to_path_buf())
    };

    let mut dir = start_dir.as_path();
    loop {
        if markers.iter().any(|m| dir.join(m).is_file()) {
            return dir.to_path_buf();
        }
        if dir == project_root {
            return project_root.to_path_buf();
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => return project_root.to_path_buf(),
        }
    }
}
/// `doc` 是否位于 `root` 之内。
///
/// 红线 8：判定包含关系**必须先物理化两侧路径** —— `Path::starts_with` 按组件比较但
/// 不做归一化，`<root>/../other/a.ts` 的组件前缀仍是 `<root>`，会被误判为"在项目内"。
/// 该误判在 Windows 上**真的会发生**（`platform::file_url` 的 Windows 分支只做
/// percent-decode，不消点段）；Unix 侧只是恰好被 `url::Url::to_file_path()` 顺带消掉。
///
/// 文档本身可能尚未落盘（新建未保存的文件）→ 退回对**父目录**规范化；父目录也不
/// 存在（深度新建目录）时才退回词法判定（尽力而为，不阻断打开流程）。
/// 返回值一律使用调用方传入的原始路径（不把软链接项目路径改写成真实路径）。
fn contains_document(root: &Path, doc: &Path) -> bool {
    let doc_real = doc
        .canonicalize()
        .ok()
        .or_else(|| doc.parent().and_then(|p| p.canonicalize().ok()));
    match (root.canonicalize(), doc_real) {
        (Ok(root_real), Some(doc_real)) => doc_real.starts_with(root_real),
        _ => doc.starts_with(root),
    }
}

/// Maximum subdirectory scan depth when no document is available.
const MAX_SCAN_DEPTH: u32 = 4;

/// Skip common non-project directories during scan.
fn is_skip_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | ".nuxt"
            | "vendor"
            | "out"
    )
}

/// Scan `project_root` subdirectories (BFS) for the nearest directory containing
/// any of `markers` (from the plugin's [`crate::lsp::plugin::RootScope`]).
///
/// Used when no document is open — e.g. a monorepo whose frontend lives in a
/// subdirectory with its own project markers. Returns `None` when no marker is
/// found within [`MAX_SCAN_DEPTH`] levels.
#[must_use]
fn scan_project_for_root_markers(project_root: &Path, markers: &[String]) -> Option<PathBuf> {
    let mut queue: VecDeque<(PathBuf, u32)> = VecDeque::new();
    queue.push_back((project_root.to_path_buf(), 0));

    while let Some((dir, depth)) = queue.pop_front() {
        if markers.iter().any(|m| dir.join(m).is_file()) {
            return Some(dir);
        }
        if depth >= MAX_SCAN_DEPTH {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(ft) = entry.file_type() else { continue };
            if !ft.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let Some(name_str) = name.to_str() else {
                continue;
            };
            if is_skip_dir(name_str) {
                continue;
            }
            queue.push_back((entry.path(), depth + 1));
        }
    }
    None
}

/// Convert the part of a `file://` URI *after* the scheme into a filesystem path。
///
/// 平台差异集中化于 `crate::platform::file_url`。
pub(crate) fn file_url_to_path(rest: &str) -> Option<PathBuf> {
    crate::platform::file_url::file_url_to_path(rest)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use crate::lsp::plugin::{LspPlugin, RootScope};
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

    /// 项目根语义的插件桩（默认 `RootScope::ProjectScoped`）。
    fn project_scoped(language_id: &str) -> LspPlugin {
        LspPlugin::builtin(language_id, &[], "stub-ls", &["stub-ls"], None)
    }

    /// TS/JS 家族的插件桩：文档定根 + 三个工程 marker（与 builtins 声明同形）。
    fn document_scoped(language_id: &str) -> LspPlugin {
        project_scoped(language_id).with_root_scope(RootScope::document_scoped(&[
            "tsconfig.json",
            "jsconfig.json",
            "package.json",
        ]))
    }

    fn write(dir: &Path, rel: &str, content: &str) {
        let p = dir.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }

    /// Build a `file://` URI for a path joined onto `root`.
    fn file_uri(root: &Path, suffix: &str) -> String {
        // `display()` uses the platform separator, matching real frontend URIs.
        format!("file://{}", root.join(suffix).display())
    }

    #[test]
    fn uses_nearest_marker_dir_from_document() {
        let root = tempdir().unwrap();
        write(root.path(), "frontend/tsconfig.json", "{}");
        write(
            root.path(),
            "frontend/src/components/App.tsx",
            "export const a = 1;",
        );
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some(
                root.path()
                    .join("frontend/src/components/App.tsx")
                    .to_str()
                    .unwrap(),
            ),
            &document_scoped("typescriptreact"),
        );
        assert_eq!(resolved, root.path().join("frontend"));
    }

    #[test]
    fn prefers_closest_marker_over_ancestors() {
        let root = tempdir().unwrap();
        write(root.path(), "package.json", "{}");
        write(root.path(), "frontend/tsconfig.json", "{}");
        write(root.path(), "frontend/src/a.ts", "export const a = 1;");
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some(root.path().join("frontend/src/a.ts").to_str().unwrap()),
            &document_scoped("typescript"),
        );
        assert_eq!(resolved, root.path().join("frontend"));
    }

    #[test]
    fn falls_back_to_project_root_when_no_marker() {
        let root = tempdir().unwrap();
        write(root.path(), "src/a.ts", "export const a = 1;");
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some(root.path().join("src/a.ts").to_str().unwrap()),
            &document_scoped("typescript"),
        );
        assert_eq!(resolved, root.path());
    }

    #[test]
    fn no_document_keeps_project_root() {
        let root = tempdir().unwrap();
        write(root.path(), "tsconfig.json", "{}");
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            None,
            &document_scoped("typescript"),
        );
        assert_eq!(resolved, root.path());
    }

    #[test]
    fn non_ts_languages_keep_project_root() {
        let root = tempdir().unwrap();
        write(root.path(), "frontend/tsconfig.json", "{}");
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some(root.path().join("frontend/a.ts").to_str().unwrap()),
            &project_scoped("rust"),
        );
        assert_eq!(resolved, root.path());
    }

    #[test]
    fn accepts_file_uri_documents() {
        let root = tempdir().unwrap();
        write(root.path(), "frontend/tsconfig.json", "{}");
        let uri = file_uri(root.path(), "frontend/src/a.tsx");
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some(&uri),
            &document_scoped("typescriptreact"),
        );
        assert_eq!(resolved, root.path().join("frontend"));
    }

    #[test]
    fn document_outside_project_keeps_project_root() {
        let root = tempdir().unwrap();
        write(root.path(), "tsconfig.json", "{}");
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some("/tmp/elsewhere/a.ts"),
            &document_scoped("typescript"),
        );
        assert_eq!(resolved, root.path());
    }

    #[test]
    fn document_dir_with_marker_resolves_to_itself() {
        let root = tempdir().unwrap();
        write(root.path(), "frontend/tsconfig.json", "{}");
        // The opened "document" is itself a directory that contains a marker.
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some(root.path().join("frontend").to_str().unwrap()),
            &document_scoped("typescript"),
        );
        assert_eq!(resolved, root.path().join("frontend"));
    }

    #[test]
    fn file_uri_with_percent_encoded_space_decodes() {
        let root = tempdir().unwrap();
        write(root.path(), "my project/tsconfig.json", "{}");
        // Spaces (and other non-ASCII bytes) are percent-encoded in URIs.
        let uri = format!("file://{}/my%20project/src/a.ts", root.path().display());
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some(&uri),
            &document_scoped("typescript"),
        );
        assert_eq!(resolved, root.path().join("my project"));
    }

    #[test]
    fn malformed_file_uri_falls_back_to_project_root() {
        let root = tempdir().unwrap();
        write(root.path(), "tsconfig.json", "{}");
        // Invalid percent-encoding: "%ZZ" is not a valid byte.
        let bad = format!("file://{}/%ZZ/a.ts", root.path().display());
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some(&bad),
            &document_scoped("typescript"),
        );
        assert_eq!(resolved, root.path());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_file_uri_with_drive_letter_resolves() {
        // Directly exercise the Windows branch: "/C:/repo/frontend/src/a.tsx"
        // (the `rest` of `file:///C:/repo/frontend/src/a.tsx`) must decode to a
        // path rooted at `C:\repo`.
        let path = file_url_to_path("/C:/repo/frontend/src/a.tsx").unwrap();
        assert_eq!(path, PathBuf::from("C:\\repo\\frontend\\src\\a.tsx"));
    }

    #[test]
    fn marker_in_document_dir_itself() {
        let root = tempdir().unwrap();
        write(root.path(), "frontend/tsconfig.json", "{}");
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some(root.path().join("frontend/tsconfig.json").to_str().unwrap()),
            &document_scoped("typescript"),
        );
        assert_eq!(resolved, root.path().join("frontend"));
    }

    // ── scan for the session root (no document available) ────────────────────

    #[test]
    fn no_document_scans_subdir_for_ts_root() {
        // Monorepo: frontend lives in a subdirectory with its own tsconfig.json
        let root = tempdir().unwrap();
        write(root.path(), "frontend/tsconfig.json", "{}");
        write(root.path(), "frontend/src/a.ts", "export const a = 1;");
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            None,
            &document_scoped("typescript"),
        );
        assert_eq!(resolved, root.path().join("frontend"));
    }

    #[test]
    fn no_document_finds_nested_ts_root() {
        // Deeper nesting: packages/web/tsconfig.json
        let root = tempdir().unwrap();
        write(root.path(), "packages/web/tsconfig.json", "{}");
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            None,
            &document_scoped("typescript"),
        );
        assert_eq!(resolved, root.path().join("packages/web"));
    }

    #[test]
    fn no_document_skips_node_modules() {
        // node_modules should never be considered a TS root even if it has package.json
        let root = tempdir().unwrap();
        write(root.path(), "node_modules/some-pkg/package.json", "{}");
        // No real TS root → falls back to project root
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            None,
            &document_scoped("typescript"),
        );
        assert_eq!(resolved, root.path());
    }

    #[test]
    fn no_document_respects_max_depth() {
        // Beyond MAX_SCAN_DEPTH → falls back to project root
        let root = tempdir().unwrap();
        write(root.path(), "a/b/c/d/e/frontend/tsconfig.json", "{}");
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            None,
            &document_scoped("typescript"),
        );
        // depth 6 > MAX_SCAN_DEPTH (4), so we fall back
        assert_eq!(resolved, root.path());
    }

    #[test]
    fn no_document_falls_back_when_no_marker() {
        let root = tempdir().unwrap();
        write(root.path(), "src/a.ts", "export const a = 1;");
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            None,
            &document_scoped("typescript"),
        );
        assert_eq!(resolved, root.path());
    }

    #[test]
    fn no_document_non_ts_language_skips_scan() {
        // For non-TS languages, no scan happens — returns project root immediately
        let root = tempdir().unwrap();
        write(root.path(), "frontend/tsconfig.json", "{}");
        let resolved =
            resolve_session_root(root.path().to_str().unwrap(), None, &project_scoped("rust"));
        assert_eq!(resolved, root.path());
    }

    /// 数据化证明：**自定义语言**只需声明 `DocumentScoped(["mylang.toml"])` 即可获得
    /// 文档定根 —— 白名单写死在代码里时，这条测试不可能通过。
    #[test]
    fn document_scoped_markers_come_from_plugin_data() {
        let root = tempdir().unwrap();
        write(root.path(), "pkg/mylang.toml", "x = 1");
        write(root.path(), "pkg/src/a.mylang", "a");
        let plugin =
            project_scoped("mylang").with_root_scope(RootScope::document_scoped(&["mylang.toml"]));

        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some(root.path().join("pkg/src/a.mylang").to_str().unwrap()),
            &plugin,
        );

        assert_eq!(resolved, root.path().join("pkg"));
    }

    /// 无文档时的浅层扫描同样吃插件 marker（白名单时代只认三个 TS marker）。
    #[test]
    fn no_document_scan_uses_plugin_markers() {
        let root = tempdir().unwrap();
        write(root.path(), "pkg/mylang.toml", "x = 1");
        let plugin =
            project_scoped("mylang").with_root_scope(RootScope::document_scoped(&["mylang.toml"]));

        let resolved = resolve_session_root(root.path().to_str().unwrap(), None, &plugin);

        assert_eq!(resolved, root.path().join("pkg"));
    }

    /// 红线 8（路径安全）：文档路径来自前端，`..` **不得**把会话根带出项目根。
    ///
    /// `Path::starts_with` 按组件比较但**不归一化**：`<root>/../<other>/a.ts` 的组件
    /// 前缀仍是 `<root>` → 误判为"在项目内"（已用 rustc 实测）。必须在判定包含关系前
    /// 规范化两侧路径（返回值仍保持原样，避免把软链接项目路径改写为真实路径）。
    #[test]
    fn dotdot_document_path_cannot_escape_project_root() {
        let outside = tempdir().unwrap();
        write(outside.path(), "outside/tsconfig.json", "{}");
        let root = tempdir().unwrap();
        write(root.path(), "src/a.ts", "export const a = 1;");

        // 构造真实存在的逃逸路径：<root>/../<outside_dir>/outside/a.ts
        let escaping = root
            .path()
            .join("..")
            .join(outside.path().file_name().unwrap())
            .join("outside")
            .join("a.ts");
        let uri = file_uri(root.path(), ""); // 占位，下面直接给出完整 URI
        let _ = uri;
        let escaping_uri = format!("file://{}", escaping.display());

        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some(&escaping_uri),
            &document_scoped("typescript"),
        );
        assert_eq!(
            resolved,
            root.path(),
            "含 `..` 的 file:// 文档路径不得把会话根解析到项目外（路径穿越，红线 8）"
        );

        // 裸路径形态（非 `file://`；`pub(crate)` 调用方可能这么传）：同样不得逃逸。
        // 平台差异：Unix 侧 `file://` → `url::Url::to_file_path()` 会归一化点段（此断言
        // 在 URI 形态下本来就是绿的），而 Windows 侧 `strip_prefix('/') + decode` **不**归一化
        // —— 裸路径形态在两端都保留 `..`，故这条断言是真正的护栏。
        let resolved_raw = resolve_session_root(
            root.path().to_str().unwrap(),
            Some(escaping.to_str().unwrap()),
            &document_scoped("typescript"),
        );
        assert_eq!(
            resolved_raw,
            root.path(),
            "含 `..` 的裸文档路径不得把会话根解析到项目外（路径穿越，红线 8）"
        );
    }

    /// `contains_document` 的退化路径：路径不存在（规范化失败）时回退词法判定 ——
    /// 保持既有宽容语义，不给正常打开流程引入新的失败面。
    #[test]
    fn contains_document_falls_back_to_lexical_when_paths_missing() {
        let root = tempdir().unwrap();
        assert!(contains_document(
            root.path(),
            &root.path().join("missing/a.ts")
        ));
        assert!(!contains_document(
            root.path(),
            Path::new("/definitely/other")
        ));
    }
}
