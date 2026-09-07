//! ignored_cache：远程 ignored 路径缓存与获取测试。

use super::super::ignored_cache::{
    apply_ignored_to_tree, build_git_ignored_command, get_or_fetch_remote_ignored_paths,
    invalidate_remote_ignored_cache, is_remote_ignored_cache_fresh, parse_remote_ignored_output,
    remote_ignored_cache, remote_target_id, CachedRemoteIgnoredPaths, RemoteIgnoredCacheKey,
    MAX_IGNORED_PATHS, REMOTE_IGNORED_PATHS_TTL,
};
use crate::common::connection::types::AuthMethod;
use crate::common::executor::factory::ExecTarget;
use crate::common::utils::command::local::safe_path;
use crate::project::types::FileNode;
use std::collections::HashSet;

/// 远程 ignored 输出必须逐行归一化、去重，并受容量上限保护。
#[test]
fn parse_remote_ignored_output_normalizes_deduplicates_and_caps() {
    let output = "node_modules/\nnode_modules\nsrc/target/generated.rs\n\ndist/\n";

    let parsed = parse_remote_ignored_output(output);

    assert_eq!(
        parsed,
        HashSet::from([
            "node_modules".to_string(),
            "src/target/generated.rs".to_string(),
            "dist".to_string(),
        ])
    );
}

#[test]
fn parse_remote_ignored_output_rejects_paths_beyond_capacity() {
    let output = (0..MAX_IGNORED_PATHS + 1)
        .map(|i| format!("generated/{i}/\n"))
        .collect::<String>();

    let parsed = parse_remote_ignored_output(&output);

    assert_eq!(parsed.len(), MAX_IGNORED_PATHS);
    assert!(!parsed.contains("generated/100000"));
}

/// 缓存 key 必须区分 WSL / Remote 环境，且只包含稳定非敏感信息。
#[test]
fn remote_target_id_distinguishes_targets_without_credentials() {
    let wsl = ExecTarget::Wsl {
        distro: "Ubuntu-22.04".to_string(),
    };
    let remote = ExecTarget::Remote {
        host: "example.com".to_string(),
        port: 22,
        username: "dev".to_string(),
        auth: AuthMethod::Password("secret".to_string()),
    };

    assert_eq!(remote_target_id(&wsl).as_deref(), Some("wsl:Ubuntu-22.04"));
    assert_eq!(
        remote_target_id(&remote).as_deref(),
        Some("remote:dev@example.com:22")
    );
    assert_eq!(remote_target_id(&ExecTarget::Local), None);
}

/// ignored 查询在同一 project / target / root 内必须命中缓存；
/// 显式失效后允许重新查询，供 watcher 规则变化与 unwatch 使用。
#[tokio::test]
async fn cached_remote_ignored_paths_hits_until_project_cache_invalidated() {
    let project_id = "cache-invalidation-test";
    let target = ExecTarget::Wsl {
        distro: "Ubuntu-22.04".to_string(),
    };
    let root = "/repo/cache-test";
    let expected = HashSet::from(["node_modules".to_string()]);
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    invalidate_remote_ignored_cache(project_id);

    let fetch_calls = calls.clone();
    let first = get_or_fetch_remote_ignored_paths(project_id, &target, root, || {
        fetch_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        std::future::ready(expected.clone())
    })
    .await;
    let second = get_or_fetch_remote_ignored_paths(project_id, &target, root, || {
        fetch_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        std::future::ready(HashSet::new())
    })
    .await;
    assert_eq!(first, expected);
    assert_eq!(second, expected);
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);

    invalidate_remote_ignored_cache(project_id);
    let third = get_or_fetch_remote_ignored_paths(project_id, &target, root, || {
        fetch_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        std::future::ready(HashSet::new())
    })
    .await;
    assert!(third.is_empty());
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
    invalidate_remote_ignored_cache(project_id);
}

/// fetch 过程中规则失效时，返回结果仍不能把 stale 数据重新写入缓存。
#[tokio::test]
async fn invalidated_inflight_fetch_does_not_reinsert_stale_paths() {
    let project_id = "cache-inflight-invalidate-test";
    let target = ExecTarget::Wsl {
        distro: "Ubuntu-22.04".to_string(),
    };
    let root = "/repo/inflight-test";
    let key = RemoteIgnoredCacheKey {
        project_id: project_id.to_string(),
        target_id: remote_target_id(&target).unwrap(),
        root_path: root.to_string(),
    };
    invalidate_remote_ignored_cache(project_id);

    let paths = get_or_fetch_remote_ignored_paths(project_id, &target, root, || {
        // 模拟远程查询窗口内 watcher 检测到 .gitignore 变化并先失效缓存。
        invalidate_remote_ignored_cache(project_id);
        std::future::ready(HashSet::from(["stale".to_string()]))
    })
    .await;

    assert_eq!(paths, HashSet::from(["stale".to_string()]));
    assert!(
        !remote_ignored_cache().lock().unwrap().contains_key(&key),
        "失效后完成的 fetch 不得重新插入 stale 缓存"
    );
}

/// 同 key 并发 cache miss 必须合并为一次 remote fetch（single-flight）。
#[tokio::test]
async fn concurrent_cache_misses_use_single_flight_remote_fetch() {
    let project_id = "cache-single-flight-test";
    let target = ExecTarget::Wsl {
        distro: "Ubuntu-22.04".to_string(),
    };
    let root = "/repo/single-flight-test";
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    invalidate_remote_ignored_cache(project_id);

    let mut handles = Vec::new();
    for _ in 0..8 {
        let calls = calls.clone();
        let target = target.clone();
        handles.push(tokio::spawn(async move {
            get_or_fetch_remote_ignored_paths(project_id, &target, root, || {
                calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                async {
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                    HashSet::from(["node_modules".to_string()])
                }
            })
            .await
        }));
    }
    for handle in handles {
        assert_eq!(
            handle.await.unwrap(),
            HashSet::from(["node_modules".to_string()])
        );
    }

    assert_eq!(
        calls.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "同 key 并发 miss 只能触发一次 fetch"
    );
    invalidate_remote_ignored_cache(project_id);
}

/// TTL 是 watcher 失效不可用时的兜底，不允许长期 stale。
#[test]
fn remote_ignored_cache_expires_after_ttl() {
    let now = std::time::Instant::now();
    assert!(is_remote_ignored_cache_fresh(now, now));
    assert!(!is_remote_ignored_cache_fresh(
        now - REMOTE_IGNORED_PATHS_TTL - std::time::Duration::from_millis(1),
        now
    ));
}

/// 缓存过期后必须重新查询，不能仅依赖显式失效。
#[tokio::test]
async fn cached_remote_ignored_paths_refetches_after_ttl_expires() {
    let project_id = "cache-ttl-expiry-test";
    let target = ExecTarget::Wsl {
        distro: "Ubuntu-22.04".to_string(),
    };
    let root = "/repo/ttl-test";
    let key = RemoteIgnoredCacheKey {
        project_id: project_id.to_string(),
        target_id: remote_target_id(&target).unwrap(),
        root_path: root.to_string(),
    };
    let stale = HashSet::from(["stale".to_string()]);
    remote_ignored_cache().lock().unwrap().insert(
        key,
        CachedRemoteIgnoredPaths {
            paths: stale,
            fetched_at: std::time::Instant::now()
                - REMOTE_IGNORED_PATHS_TTL
                - std::time::Duration::from_millis(1),
        },
    );
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let fetch_calls = calls.clone();
    let paths = get_or_fetch_remote_ignored_paths(project_id, &target, root, || {
        fetch_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        std::future::ready(HashSet::from(["fresh".to_string()]))
    })
    .await;

    assert_eq!(paths, HashSet::from(["fresh".to_string()]));
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    invalidate_remote_ignored_cache(project_id);
}

#[test]
fn build_git_ignored_command_escapes_and_uses_ls_files() {
    let cmd = build_git_ignored_command("/home/user/project");
    assert!(
        cmd.contains("git ls-files --others --ignored --exclude-standard --directory"),
        "应使用 git ls-files 获取被忽略路径: {cmd}"
    );
    assert!(
        cmd.starts_with("cd '/home/user/project'"),
        "应 cd 到项目根: {cmd}"
    );
}

#[test]
fn build_git_ignored_command_escapes_single_quotes() {
    // safe_path 将 ' 替换为 '\''，避免 shell 单引号提前闭合
    let safe = safe_path("/home/user/it's dir");
    let cmd = build_git_ignored_command(&safe);
    assert!(
        cmd.contains("it'\\''s dir"),
        "单引号应被 safe_path 转义: {cmd}"
    );
}

#[test]
fn apply_ignored_to_tree_marks_dirs_and_clears_children() {
    let mut tree = vec![
        FileNode {
            name: "src".into(),
            path: "src".into(),
            is_dir: true,
            children: vec![FileNode {
                name: "main.rs".into(),
                path: "src/main.rs".into(),
                is_dir: false,
                children: vec![],
                ignored: false,
            }],
            ignored: false,
        },
        FileNode {
            name: "node_modules".into(),
            path: "node_modules".into(),
            is_dir: true,
            children: vec![FileNode {
                name: "react".into(),
                path: "node_modules/react".into(),
                is_dir: true,
                children: vec![],
                ignored: false,
            }],
            ignored: false,
        },
        FileNode {
            name: "README.md".into(),
            path: "README.md".into(),
            is_dir: false,
            children: vec![],
            ignored: false,
        },
    ];
    let mut set = HashSet::new();
    set.insert("node_modules".to_string());

    apply_ignored_to_tree(&mut tree, &set);

    let nm = tree.iter().find(|n| n.path == "node_modules").unwrap();
    assert!(nm.ignored, "node_modules 应被标记为 ignored");
    assert!(nm.children.is_empty(), "ignored 目录 children 应被清空");
    let src = tree.iter().find(|n| n.path == "src").unwrap();
    assert!(!src.ignored, "src 不应被标记");
    assert!(!src.children.is_empty(), "非 ignored 目录 children 应保留");
    let readme = tree.iter().find(|n| n.path == "README.md").unwrap();
    assert!(!readme.ignored, "README.md 不应被标记");
}

#[test]
fn apply_ignored_to_tree_handles_nested_paths() {
    let mut tree = vec![FileNode {
        name: "packages".into(),
        path: "packages".into(),
        is_dir: true,
        children: vec![FileNode {
            name: "app".into(),
            path: "packages/app".into(),
            is_dir: true,
            children: vec![FileNode {
                name: "dist".into(),
                path: "packages/app/dist".into(),
                is_dir: true,
                children: vec![],
                ignored: false,
            }],
            ignored: false,
        }],
        ignored: false,
    }];
    let mut set = HashSet::new();
    set.insert("packages/app/dist".to_string());

    apply_ignored_to_tree(&mut tree, &set);

    let dist = tree[0].children[0].children[0].clone();
    assert!(dist.ignored, "嵌套路径 packages/app/dist 应被标记");
    assert!(dist.children.is_empty());
}
