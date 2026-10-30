//! 列表 / 项目过滤 / 扫描缓存 / 恢复命令 / 合成路径（v1 行为回归）。

use super::super::common::split_synthetic_path;
use super::super::{OpenCodeAdapter, SQLITE_SIDECARS};
use super::fixture::*;
use crate::conversation::adapter::AgentSessionAdapter;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

#[test]
fn should_reuse_parse_all_metas_when_db_unchanged() {
    crate::conversation::scan_cache::reset_scan_parse_cache_for_tests();
    let dir = TempDir::new().unwrap();
    // Point adapter root at temp dir with one fixture DB.
    let db_path = create_opencode_fixture(&dir);
    // parse_opencode_db is used by parse_all_metas via session_root walk —
    // exercise fingerprint via direct parse + cache helpers first.
    // 与生产同源：批量元数据缓存的指纹必须带上 `-wal`（见 SQLITE_SIDECARS）
    let sig =
        crate::conversation::scan_cache::source_signature_with_sidecars(&db_path, SQLITE_SIDECARS)
            .unwrap();
    let first = parse_v1(&db_path, None).unwrap();
    crate::conversation::scan_cache::put_cached_bulk_metas(db_path.clone(), sig, first.clone());
    let hit = crate::conversation::scan_cache::get_cached_bulk_metas(&db_path, &sig).unwrap();
    assert_eq!(hit.len(), first.len());
    assert_eq!(hit[0].0.native_session_id, first[0].0.native_session_id);
}

/// 扫描指纹必须带上 SQLite 的 `-wal` 侧文件：adapter 用的就是这个常量入口，
/// 常量里漏掉 `-wal` 时本用例红（WAL 下新提交只动侧文件，主文件 checkpoint 前不变）。
#[test]
fn bulk_cache_signature_tracks_wal_sidecar() {
    let dir = TempDir::new().unwrap();
    let db_path = create_opencode_fixture(&dir);
    let wal = std::path::PathBuf::from(format!("{}-wal", db_path.display()));

    let before =
        crate::conversation::scan_cache::source_signature_with_sidecars(&db_path, SQLITE_SIDECARS)
            .unwrap();
    std::fs::write(&wal, b"uncheckpointed pages").unwrap();
    let after =
        crate::conversation::scan_cache::source_signature_with_sidecars(&db_path, SQLITE_SIDECARS)
            .unwrap();

    assert_ne!(before, after, "WAL 增长必须让扫描缓存失效");
}

#[test]
fn should_filter_opencode_db_by_project_path() {
    let dir = TempDir::new().unwrap();
    let db_path = create_opencode_fixture(&dir);
    let only_alpha = parse_v1(&db_path, Some("/projects/test")).unwrap();
    assert_eq!(only_alpha.len(), 1);
    assert_eq!(
        only_alpha[0].0.project_path.as_deref(),
        Some("/projects/test")
    );

    let other = parse_v1(&db_path, Some("/projects/other")).unwrap();
    assert!(other.is_empty());
}

#[test]
fn should_parse_all_metas() {
    let dir = TempDir::new().unwrap();
    let db_path = create_opencode_fixture(&dir);

    let metas = parse_v1(&db_path, None).expect("should succeed");

    // Should have 1 session (archived and child are excluded)
    assert_eq!(metas.len(), 1);
    let (meta, syn_path) = &metas[0];
    assert_eq!(meta.native_session_id, "ses-001");
    assert_eq!(meta.title.as_deref(), Some("Fix UI bug"));
    assert_eq!(meta.model.as_deref(), Some("claude-sonnet-4-5"));
    // 徽标必须等于正文视图条数（无 part 的消息不会渲染，也不该计数）
    assert_eq!(
        meta.message_count as usize,
        OpenCodeAdapter.parse_messages(syn_path).unwrap().len()
    );
    assert_eq!(meta.project_path.as_deref(), Some("/projects/test"));
    assert_eq!(meta.started_at, 1736935200000);
    assert_eq!(meta.updated_at, 1736938800000);

    // Synthetic path should contain the DB path and session ID
    let syn_str = syn_path.to_string_lossy();
    assert!(syn_str.contains("#ses-001"));
    assert!(syn_str.contains("opencode.db"));

    // Preview messages should include recent messages
    assert!(meta
        .recent_messages
        .iter()
        .any(|(_, t)| t.contains("button")));
}

#[test]
fn should_handle_archived_sessions() {
    let dir = TempDir::new().unwrap();
    let db_path = create_opencode_fixture(&dir);

    let metas = parse_v1(&db_path, None).expect("should succeed");

    // Archived and child sessions should be excluded
    let ids: Vec<&str> = metas
        .iter()
        .map(|(m, _)| m.native_session_id.as_str())
        .collect();
    assert!(!ids.contains(&"ses-archived"));
    assert!(!ids.contains(&"ses-child"));
    assert!(ids.contains(&"ses-001"));
}

#[test]
fn should_extract_session_id() {
    let path = Path::new("/tmp/opencode.db");
    let id = OpenCodeAdapter.extract_session_id(path);
    assert_eq!(id, Some("opencode".to_string()));

    // Synthetic path
    let syn_path = Path::new("/tmp/opencode.db#ses-001");
    let id = OpenCodeAdapter.extract_session_id(syn_path);
    assert_eq!(id, Some("ses-001".to_string()));
}

#[test]
fn should_split_synthetic_path() {
    let path = Path::new("/tmp/opencode.db#ses-abc123");
    let (db, sid) = split_synthetic_path(path).unwrap();
    assert_eq!(db, Path::new("/tmp/opencode.db"));
    assert_eq!(sid, "ses-abc123");
}

#[test]
fn should_handle_nonexistent_db() {
    let path = Path::new("/nonexistent/opencode.db");
    let result = OpenCodeAdapter.parse_messages(&PathBuf::from(format!("{}#s1", path.display())));
    assert!(result.is_err());
}

#[test]
fn should_return_resume_command() {
    let cmd = OpenCodeAdapter.resume_command("ses-abc123", "/projects/test");
    assert_eq!(
        cmd,
        Some(vec!["--session".to_string(), "ses-abc123".to_string()])
    );
}
