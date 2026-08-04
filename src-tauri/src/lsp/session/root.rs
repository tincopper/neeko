//! Workspace-root resolution for LSP sessions (VS Code-style).
//!
//! `typescript-language-server` locates the `typescript` library by walking up
//! from the workspace root it receives in the `initialize` handshake
//! (`rootUri`/`rootPath`), falling back to the global npm installation. When
//! Neeko initializes a session from the project root of a monorepo whose
//! frontend lives in a subdirectory (e.g. a Rust workspace with `frontend/`),
//! the root contains no `node_modules` and the server fails. Aligning with
//! VS Code, we resolve the root from the *opened document*: walk up to the
//! nearest directory containing a TypeScript root marker.
//!
//! (Implementation — tests live below.)

use std::path::{Path, PathBuf};

/// Root markers that scope a TypeScript / JavaScript project.
pub(crate) const TS_ROOT_MARKERS: &[&str] = &["tsconfig.json", "jsconfig.json", "package.json"];

/// Language ids whose servers must be rooted at the nearest TS project,
/// because `typescript-language-server` resolves its `typescript` dependency
/// from the workspace root of the `initialize` handshake.
pub(crate) fn is_document_root_scoped(language_id: &str) -> bool {
    matches!(
        language_id,
        "typescript" | "typescriptreact" | "javascript" | "javascriptreact"
    )
}

/// Resolve the workspace root an LSP session should be initialized with.
///
/// For document-scoped languages (TypeScript family), walk up from the opened
/// document to the nearest directory containing `tsconfig.json`, `jsconfig.json`
/// or `package.json`, mirroring VS Code's per-document
/// workspace-version resolution. Falls back to `project_path` when no marker
/// is found, no document is given, or the document lies outside the project.
/// Other languages always keep `project_path` (their servers locate their own
/// project via their own markers, e.g. `Cargo.toml`).
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
    language_id: &str,
) -> PathBuf {
    let project_root = Path::new(project_path);
    if !is_document_root_scoped(language_id) {
        return project_root.to_path_buf();
    }
    let Some(doc) = document_path else {
        // No document available (e.g. session restart / auto-start).
        // For monorepos whose frontend lives in a subdirectory, the project
        // root may not be the TS project. Scan subdirectories for a TS root.
        if let Some(root) = scan_project_for_ts_root(project_root) {
            return root;
        }
        return project_root.to_path_buf();
    };

    let doc_path = match doc.strip_prefix("file://") {
        Some(rest) => file_url_to_path(rest).unwrap_or_else(|| project_root.to_path_buf()),
        None => PathBuf::from(doc),
    };
    if !doc_path.starts_with(project_root) {
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
        if TS_ROOT_MARKERS.iter().any(|m| dir.join(m).is_file()) {
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

/// Scan `project_root` subdirectories (BFS) for the nearest directory
/// containing a TS root marker. Used when no document is open — e.g. a
/// monorepo whose frontend lives in a subdirectory with its own
/// `tsconfig.json` + `node_modules`. Returns `None` when no marker is
/// found within [`MAX_SCAN_DEPTH`] levels.
#[must_use]
fn scan_project_for_ts_root(project_root: &Path) -> Option<PathBuf> {
    let mut queue: VecDeque<(PathBuf, u32)> = VecDeque::new();
    queue.push_back((project_root.to_path_buf(), 0));

    while let Some((dir, depth)) = queue.pop_front() {
        if TS_ROOT_MARKERS.iter().any(|m| dir.join(m).is_file()) {
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

/// Convert the part of a `file://` URI *after* the scheme into a filesystem path.
///
/// `rest` is the slice following `"file://"`. For example, both
/// `file:///unix/path` (non-Windows) and `file:///C:/repo` (Windows) hand us a
/// `rest` of `"/unix/path"` and `"/C:/repo"` respectively.
///
/// Returns `None` when the rest cannot be decoded into a valid native path
/// (e.g. malformed percent-encoding). Callers fall back to the project root.
pub(crate) fn file_url_to_path(rest: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        // Drop the leading slash so "/C:/repo" becomes "C:/repo", then
        // percent-decode to support spaces and non-ASCII filenames.
        let trimmed = rest.strip_prefix('/').unwrap_or(rest);
        let decoded = urlencoding::decode(trimmed).ok()?;
        Some(PathBuf::from(decoded.as_ref()))
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Re-parse the full URL so `url` can validate the structure, then ask
        // it for the native path. The full URL is `file://{rest}` by construction.
        let url = url::Url::parse(&format!("file://{}", rest)).ok()?;
        url.to_file_path().ok()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

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
            "typescriptreact",
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
            "typescript",
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
            "typescript",
        );
        assert_eq!(resolved, root.path());
    }

    #[test]
    fn no_document_keeps_project_root() {
        let root = tempdir().unwrap();
        write(root.path(), "tsconfig.json", "{}");
        let resolved = resolve_session_root(root.path().to_str().unwrap(), None, "typescript");
        assert_eq!(resolved, root.path());
    }

    #[test]
    fn non_ts_languages_keep_project_root() {
        let root = tempdir().unwrap();
        write(root.path(), "frontend/tsconfig.json", "{}");
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some(root.path().join("frontend/a.ts").to_str().unwrap()),
            "rust",
        );
        assert_eq!(resolved, root.path());
    }

    #[test]
    fn accepts_file_uri_documents() {
        let root = tempdir().unwrap();
        write(root.path(), "frontend/tsconfig.json", "{}");
        let uri = file_uri(root.path(), "frontend/src/a.tsx");
        let resolved =
            resolve_session_root(root.path().to_str().unwrap(), Some(&uri), "typescriptreact");
        assert_eq!(resolved, root.path().join("frontend"));
    }

    #[test]
    fn document_outside_project_keeps_project_root() {
        let root = tempdir().unwrap();
        write(root.path(), "tsconfig.json", "{}");
        let resolved = resolve_session_root(
            root.path().to_str().unwrap(),
            Some("/tmp/elsewhere/a.ts"),
            "typescript",
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
            "typescript",
        );
        assert_eq!(resolved, root.path().join("frontend"));
    }

    #[test]
    fn file_uri_with_percent_encoded_space_decodes() {
        let root = tempdir().unwrap();
        write(root.path(), "my project/tsconfig.json", "{}");
        // Spaces (and other non-ASCII bytes) are percent-encoded in URIs.
        let uri = format!("file://{}/my%20project/src/a.ts", root.path().display());
        let resolved =
            resolve_session_root(root.path().to_str().unwrap(), Some(&uri), "typescript");
        assert_eq!(resolved, root.path().join("my project"));
    }

    #[test]
    fn malformed_file_uri_falls_back_to_project_root() {
        let root = tempdir().unwrap();
        write(root.path(), "tsconfig.json", "{}");
        // Invalid percent-encoding: "%ZZ" is not a valid byte.
        let bad = format!("file://{}/%ZZ/a.ts", root.path().display());
        let resolved =
            resolve_session_root(root.path().to_str().unwrap(), Some(&bad), "typescript");
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
            "typescript",
        );
        assert_eq!(resolved, root.path().join("frontend"));
    }

    #[test]
    fn detects_document_root_scoped_languages() {
        assert!(is_document_root_scoped("typescript"));
        assert!(is_document_root_scoped("typescriptreact"));
        assert!(is_document_root_scoped("javascript"));
        assert!(is_document_root_scoped("javascriptreact"));
        assert!(!is_document_root_scoped("rust"));
        assert!(!is_document_root_scoped("python"));
    }
    // ── scan_project_for_ts_root (no document available) ─────────────────────

    #[test]
    fn no_document_scans_subdir_for_ts_root() {
        // Monorepo: frontend lives in a subdirectory with its own tsconfig.json
        let root = tempdir().unwrap();
        write(root.path(), "frontend/tsconfig.json", "{}");
        write(root.path(), "frontend/src/a.ts", "export const a = 1;");
        let resolved = resolve_session_root(root.path().to_str().unwrap(), None, "typescript");
        assert_eq!(resolved, root.path().join("frontend"));
    }

    #[test]
    fn no_document_finds_nested_ts_root() {
        // Deeper nesting: packages/web/tsconfig.json
        let root = tempdir().unwrap();
        write(root.path(), "packages/web/tsconfig.json", "{}");
        let resolved = resolve_session_root(root.path().to_str().unwrap(), None, "typescript");
        assert_eq!(resolved, root.path().join("packages/web"));
    }

    #[test]
    fn no_document_skips_node_modules() {
        // node_modules should never be considered a TS root even if it has package.json
        let root = tempdir().unwrap();
        write(root.path(), "node_modules/some-pkg/package.json", "{}");
        // No real TS root → falls back to project root
        let resolved = resolve_session_root(root.path().to_str().unwrap(), None, "typescript");
        assert_eq!(resolved, root.path());
    }

    #[test]
    fn no_document_respects_max_depth() {
        // Beyond MAX_SCAN_DEPTH → falls back to project root
        let root = tempdir().unwrap();
        write(root.path(), "a/b/c/d/e/frontend/tsconfig.json", "{}");
        let resolved = resolve_session_root(root.path().to_str().unwrap(), None, "typescript");
        // depth 6 > MAX_SCAN_DEPTH (4), so we fall back
        assert_eq!(resolved, root.path());
    }

    #[test]
    fn no_document_falls_back_when_no_marker() {
        let root = tempdir().unwrap();
        write(root.path(), "src/a.ts", "export const a = 1;");
        let resolved = resolve_session_root(root.path().to_str().unwrap(), None, "typescript");
        assert_eq!(resolved, root.path());
    }

    #[test]
    fn no_document_non_ts_language_skips_scan() {
        // For non-TS languages, no scan happens — returns project root immediately
        let root = tempdir().unwrap();
        write(root.path(), "frontend/tsconfig.json", "{}");
        let resolved = resolve_session_root(root.path().to_str().unwrap(), None, "rust");
        assert_eq!(resolved, root.path());
    }
}
