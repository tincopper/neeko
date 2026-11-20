//! Project-scoped session discovery helpers.
//!
//! High cohesion: all path-encoding / directory-prefix matching for agent
//! session roots lives here. Adapters decide *which* encode style they use;
//! the manager only consumes `discovery_roots()`.
//!
//! Inspired by Orca's Claude scope discovery:
//! - encode project path by replacing non-alnum with `-`
//! - include dir when name == prefix or name.starts_with(prefix + "-")
//!   so worktrees / nested paths under the same encode stay in scope

use std::path::{Path, PathBuf};

/// How an agent encodes a project cwd into a directory name under its session root.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodeStyle {
    /// Claude / Reasonix style: non-alnum → `-`
    /// `/Users/tomgs/proj` → `-Users-tomgs-proj`
    Claude,
    /// Pi style: `--` + slash→`-` + trailing `--`
    /// `/Users/tomgs/proj` → `--Users-tomgs-proj--`
    Pi,
    /// OMP style: prefer home-relative encode, also accept full-path encode.
    /// `/Users/tomgs/RustroverProjects/neeko` → `-RustroverProjects-neeko`
    /// (when home is `/Users/tomgs`)
    Omp,
}

/// Normalize path separators and drop a trailing slash (except root).
#[must_use]
pub fn normalize_project_path(path: &str) -> String {
    let mut s = path.replace('\\', "/");
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    s
}

/// Claude/Reasonix encode: every non-alphanumeric becomes `-`.
#[must_use]
pub fn encode_claude_project_path(path: &str) -> String {
    let normalized = normalize_project_path(path);
    normalized
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Pi encode: `--Users-tomgs-proj--` (slashes → `-`, wrapped in `--`).
#[must_use]
pub fn encode_pi_project_path(path: &str) -> String {
    let normalized = normalize_project_path(path);
    let body = normalized.trim_start_matches('/').replace('/', "-");
    format!("--{body}--")
}

/// OMP encode candidates: home-relative first, then full Claude-style.
#[must_use]
pub fn encode_omp_project_paths(path: &str) -> Vec<String> {
    let normalized = normalize_project_path(path);
    let mut out = Vec::new();

    if let Some(home) = dirs::home_dir() {
        let home_s = normalize_project_path(&home.to_string_lossy());
        if normalized == home_s {
            out.push("-".to_string());
        } else if let Some(rel) = normalized
            .strip_prefix(&home_s)
            .and_then(|r| r.strip_prefix('/'))
        {
            out.push(format!("-{}", rel.replace('/', "-")));
        }
    }

    let full = encode_claude_project_path(&normalized);
    if !out.iter().any(|e| e == &full) {
        out.push(full);
    }
    out
}

/// Encode prefixes for a given style (may return multiple OMP candidates).
#[must_use]
pub fn encode_prefixes(path: &str, style: EncodeStyle) -> Vec<String> {
    match style {
        EncodeStyle::Claude => vec![encode_claude_project_path(path)],
        EncodeStyle::Pi => vec![encode_pi_project_path(path)],
        EncodeStyle::Omp => encode_omp_project_paths(path),
    }
}

/// True when `dir_name` is exactly a scope prefix or a nested-path extension
/// (`prefix-…` boundary, matching Orca / Claude worktree dirs).
#[must_use]
pub fn dir_matches_project_scope(dir_name: &str, prefixes: &[String]) -> bool {
    prefixes.iter().any(|prefix| {
        if prefix.is_empty() {
            return false;
        }
        dir_name == prefix.as_str() || dir_name.starts_with(&format!("{prefix}-"))
    })
}

/// List immediate child directories under `session_root` whose names match the
/// project encode for `style`.
///
/// Returns absolute paths to matching project dirs. Missing root → empty vec.
#[must_use]
pub fn resolve_encoded_project_dirs(
    session_root: &Path,
    project_path: &str,
    style: EncodeStyle,
) -> Vec<PathBuf> {
    if !session_root.is_dir() {
        return Vec::new();
    }
    let prefixes = encode_prefixes(project_path, style);
    if prefixes.is_empty() {
        return Vec::new();
    }

    // Fast path: exact encoded names exist — avoid readdir when possible.
    let mut found = Vec::new();
    let mut exact_hit = false;
    for prefix in &prefixes {
        let candidate = session_root.join(prefix);
        if candidate.is_dir() {
            found.push(candidate);
            exact_hit = true;
        }
    }

    // Also pick prefix-extended dirs (worktrees / nested encodes) via readdir.
    let Ok(entries) = std::fs::read_dir(session_root) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if exact_hit && prefixes.iter().any(|p| p == name) {
            continue; // already added
        }
        if dir_matches_project_scope(name, &prefixes) && !found.iter().any(|p| p == &path) {
            found.push(path);
        }
    }
    found
}

/// Convenience: build discovery roots for path-encoded agents.
///
/// - `None` → `None` (caller should full-walk)
/// - `Some(roots)` → `Some(dirs)` for **every** root of the project (possibly empty =
///   early stop). The order of `roots` does not matter; identical encodings are
///   collapsed so the same directory is never walked twice.
///
/// 输入是项目的**注册根集合**（主 checkout + 全部 linked worktree，见
/// [`crate::common::git::ProjectScope::roots`]）而不是一个路径：CLI 的目录编码是**逐根**的，
/// 只在项目根上编码会让落在外部工作树里的会话一个都扫不到（本任务修复的缺陷形态）。
#[must_use]
pub fn discovery_roots_for(
    session_root: PathBuf,
    project_roots: Option<&[PathBuf]>,
    style: EncodeStyle,
) -> Option<Vec<PathBuf>> {
    let project_roots = project_roots?;
    let mut found: Vec<PathBuf> = Vec::new();
    for root in project_roots {
        let root = root.to_string_lossy();
        if root.trim().is_empty() {
            continue;
        }
        for dir in resolve_encoded_project_dirs(&session_root, &root, style) {
            if !found.contains(&dir) {
                found.push(dir);
            }
        }
    }
    Some(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn encode_claude_matches_real_layout() {
        assert_eq!(
            encode_claude_project_path("/Users/tomgs/RustroverProjects/neeko"),
            "-Users-tomgs-RustroverProjects-neeko"
        );
    }

    #[test]
    fn encode_pi_matches_real_layout() {
        assert_eq!(
            encode_pi_project_path("/Users/tomgs/RustroverProjects/neeko"),
            "--Users-tomgs-RustroverProjects-neeko--"
        );
    }

    #[test]
    fn encode_omp_prefers_home_relative() {
        let home = dirs::home_dir().expect("home");
        let project = home.join("RustroverProjects/neeko");
        let prefixes = encode_omp_project_paths(&project.to_string_lossy());
        assert!(
            prefixes.iter().any(|p| p == "-RustroverProjects-neeko"),
            "expected home-relative encode, got {prefixes:?}"
        );
    }

    #[test]
    fn dir_scope_allows_prefix_extension_not_sibling() {
        let prefixes = vec!["-Users-tomgs-proj".to_string()];
        assert!(dir_matches_project_scope("-Users-tomgs-proj", &prefixes));
        assert!(dir_matches_project_scope(
            "-Users-tomgs-proj-worktree",
            &prefixes
        ));
        // sibling that only shares a string prefix without '-' boundary after full encode
        // "-Users-tomgs-proj-other" IS allowed by startsWith(prefix + "-") — same as Orca.
        assert!(dir_matches_project_scope(
            "-Users-tomgs-proj-other",
            &prefixes
        ));
        assert!(!dir_matches_project_scope(
            "-Users-tomgs-project-x",
            &prefixes
        ));
        assert!(!dir_matches_project_scope("-Users-tomgs-other", &prefixes));
    }

    #[test]
    fn resolve_only_matching_project_dirs() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("-Users-tomgs-proj")).unwrap();
        std::fs::create_dir_all(root.join("-Users-tomgs-proj-wt")).unwrap();
        std::fs::create_dir_all(root.join("-Users-tomgs-other")).unwrap();

        let found = resolve_encoded_project_dirs(root, "/Users/tomgs/proj", EncodeStyle::Claude);
        let names: Vec<String> = found
            .iter()
            .filter_map(|p| p.file_name()?.to_str().map(|s| s.to_string()))
            .collect();
        assert!(names.contains(&"-Users-tomgs-proj".to_string()));
        assert!(names.contains(&"-Users-tomgs-proj-wt".to_string()));
        assert!(!names.contains(&"-Users-tomgs-other".to_string()));
    }

    #[test]
    fn discovery_roots_none_project_means_full_walk() {
        assert!(discovery_roots_for(PathBuf::from("/tmp"), None, EncodeStyle::Claude).is_none());
    }

    #[test]
    fn discovery_roots_empty_when_root_missing() {
        let roots = discovery_roots_for(
            PathBuf::from("/definitely/missing/neeko-scope-test"),
            Some(&[PathBuf::from("/Users/tomgs/proj")]),
            EncodeStyle::Claude,
        );
        assert_eq!(roots, Some(vec![]));
    }

    /// 空根集合（`Some(&[])`）= 早停，不是全量：项目级扫描的根一定来自登记表，
    /// 一个都没有意味着「这个项目没有任何已知工作区」。
    #[test]
    fn discovery_roots_empty_set_stops_early() {
        assert_eq!(
            discovery_roots_for(PathBuf::from("/tmp"), Some(&[]), EncodeStyle::Claude),
            Some(vec![])
        );
        // 空白根同样不参与编码（工程里没有「空白目录」这种工作区）。
        assert_eq!(
            discovery_roots_for(
                PathBuf::from("/tmp"),
                Some(&[PathBuf::from("   ")]),
                EncodeStyle::Claude
            ),
            Some(vec![])
        );
    }

    /// 项目的**每一个**根都要编码：只拿第一个会让工作树的会话永远扫不到。
    ///
    /// 夹具路径由 `tempdir()` 推导（红线 13）；两套编码目录预先建出来。
    #[test]
    fn discovery_roots_cover_every_root_of_the_project() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let project = root.join("proj");
        // 工作树刻意**不是**项目根的前缀扩展（`proj-wt` 会命中 `proj-` 前缀规则，那样即使
        // 只编码第一个根也能"碰巧"找到它 —— 用例就证明不了「每个根都编码」）。Neeko 的默认
        // 布局正是这种形态：`~/.neeko/worktrees/<name>`。
        let worktree = root.join("neeko-worktrees").join("wt");
        let project_dir = root.join(encode_claude_project_path(&project.to_string_lossy()));
        let worktree_dir = root.join(encode_claude_project_path(&worktree.to_string_lossy()));
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::create_dir_all(&worktree_dir).unwrap();

        let found = discovery_roots_for(
            root.to_path_buf(),
            Some(&[project.clone(), worktree.clone()]),
            EncodeStyle::Claude,
        )
        .expect("scoped discovery");

        assert!(found.contains(&project_dir), "项目根编码目录：{found:?}");
        assert!(found.contains(&worktree_dir), "工作树编码目录：{found:?}");
        assert_eq!(found.len(), 2, "每个根恰好一套目录：{found:?}");
    }

    /// 同一个目录出现两次（项目根与工作树是同一个路径 / 尾部斜杠不同）⇒ 只走一次。
    #[test]
    fn discovery_roots_dedupe_identical_encodings() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        let project = root.join("proj");
        let encoded = root.join(encode_claude_project_path(&project.to_string_lossy()));
        std::fs::create_dir_all(&encoded).unwrap();
        let trailing = PathBuf::from(format!("{}/", project.to_string_lossy()));

        let found = discovery_roots_for(
            root.to_path_buf(),
            Some(&[project, trailing]),
            EncodeStyle::Claude,
        )
        .expect("scoped discovery");

        assert_eq!(found, vec![encoded], "同一个编码目录只能出现一次");
    }
}
