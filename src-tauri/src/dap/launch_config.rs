//! `.neeko/launch.json` 的门面：读取、自动发现、保存。
//!
//! 职责边界（单一职责）：只做"配置从哪来、到哪去"。会话编排在 `manager`，
//! 入口点扫描在 `discover`，磁盘格式在 `config`。
//!
//! 这些函数此前是 `DapManager` 上**不使用 `self`** 的关联函数（且"读 → 空则发现 →
//! 尽力落盘"这段逻辑在 `list_or_discover_configs` 与 `DapSession::start_session` 里
//! **各写了一遍、错误处理还不一样**）。现在收敛到 [`load_or_discover`] 一处。

use std::path::Path;

use super::config::{load_launch_file, save_launch_file};
use super::discover::{discover_entries, entry_to_launch_config, EntryPoint};
use super::project_context::project_path;
use super::types::{LaunchConfig, LaunchFile};
use crate::AppError;
use crate::AppStateWrapper;

/// 当前 launch 文件格式版本（写出时使用）。
const LAUNCH_FILE_VERSION: &str = "0.1.0";

/// 读 launch.json；为空则发现入口点并**尽力**落盘（下次打开即保留）。
///
/// `Err` 只表示**读取失败**（文件存在但坏了）——发现结果落盘失败不算错：
/// 本次会话仍然可用，落盘只是缓存（与 `DapManager::set_breakpoints` 的
/// "UI 是离线真相"取舍一致）。失败必须留日志，否则"下次打开又变空"无从排查。
pub(super) fn load_or_discover(path: &Path) -> Result<Vec<LaunchConfig>, AppError> {
    let existing = load_launch_file(path)?.configurations;
    if !existing.is_empty() {
        return Ok(existing);
    }
    let entries = discover_entries(path);
    if entries.is_empty() {
        return Ok(Vec::new());
    }
    let configurations: Vec<LaunchConfig> = entries.iter().map(entry_to_launch_config).collect();
    let file = LaunchFile {
        version: LAUNCH_FILE_VERSION.to_string(),
        configurations: configurations.clone(),
    };
    if let Err(e) = save_launch_file(path, &file) {
        log::warn!("[DAP] failed to persist discovered launch.json: {e}");
    }
    Ok(configurations)
}

/// List configs; if empty, discover entry points and auto-write launch.json.
///
/// 这是前端 `dap_list_configs` 的唯一实现（磁盘读取 + 空则发现）。曾经还有一个
/// 只读磁盘的 `list_configs`，因没有任何调用方（`pub` 在公开模块里掩盖了
/// dead_code）随本模块抽取一并删除。
pub fn list_or_discover_configs(
    state: &AppStateWrapper,
    project_id: &str,
) -> Result<Vec<LaunchConfig>, AppError> {
    let path = project_path(state, project_id)?;
    load_or_discover(&path)
}

/// Persist launch configs to disk for a project.
pub fn save_configs(
    state: &AppStateWrapper,
    project_id: &str,
    configurations: Vec<LaunchConfig>,
) -> Result<(), AppError> {
    let path = project_path(state, project_id)?;
    let file = LaunchFile {
        version: LAUNCH_FILE_VERSION.to_string(),
        configurations,
    };
    save_launch_file(&path, &file)
}

/// Discover entry points (main packages) for a project.
pub fn discover_entry_points(
    state: &AppStateWrapper,
    project_id: &str,
) -> Result<Vec<EntryPoint>, AppError> {
    let path = project_path(state, project_id)?;
    // 既有行为：扫描是尽力而为，找不到就返回空列表（不是错误）。
    Ok(discover_entries(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dap::testing::{isolated_state, plain_project_state};

    /// 手工写一份 launch.json（模拟用户已配置过）。
    fn write_launch_file(project_dir: &Path, configurations: Vec<LaunchConfig>) {
        let file = LaunchFile {
            version: LAUNCH_FILE_VERSION.to_string(),
            configurations,
        };
        save_launch_file(project_dir, &file).expect("write launch.json");
    }

    fn go_entry_config() -> LaunchConfig {
        LaunchConfig {
            name: "Hand written".into(),
            type_: "go".into(),
            request: "launch".into(),
            ..LaunchConfig::default()
        }
    }

    /// 已有 launch.json → 原样返回，**不得**用发现结果覆盖用户配置。
    #[test]
    fn load_or_discover_keeps_existing_configs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let project_dir = tmp.path();
        // 同时放一个可发现的入口，确保"不覆盖"不是因为没得发现。
        std::fs::write(project_dir.join("main.go"), "package main\n").expect("main.go");
        write_launch_file(project_dir, vec![go_entry_config()]);

        let configs = load_or_discover(project_dir).expect("load");
        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].name, "Hand written");
    }

    /// launch.json 不存在 + 有入口点 → 发现结果返回**并落盘**（下次打开即保留）。
    #[test]
    fn load_or_discover_discovers_and_persists() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let project_dir = tmp.path();
        std::fs::write(project_dir.join("main.go"), "package main\n").expect("main.go");

        let configs = load_or_discover(project_dir).expect("discover");
        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].name, "Debug main");

        // 落盘生效：再读一次走的是磁盘路径，而不是重新发现。
        let reloaded = load_launch_file(project_dir).expect("reload");
        assert_eq!(reloaded.configurations.len(), 1);
        assert_eq!(reloaded.configurations[0].name, "Debug main");
    }

    /// 无 launch.json 且无入口点 → 空列表，不创建文件（"没有配置"不是错误）。
    #[test]
    fn load_or_discover_returns_empty_without_entries() {
        let tmp = tempfile::tempdir().expect("tempdir");

        let configs = load_or_discover(tmp.path()).expect("load");
        assert!(configs.is_empty());
        assert!(
            !super::super::config::launch_json_path(tmp.path()).exists(),
            "无内容时不应凭空创建 launch.json"
        );
    }

    /// 命令层两条路径共用 state 门面：发现即返回，保存后读回一致。
    #[test]
    fn state_facade_discovers_then_roundtrips_saved_configs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = plain_project_state(&tmp);
        let project_dir = tmp.path().join("proj");
        std::fs::write(project_dir.join("main.go"), "package main\n").expect("main.go");

        let discovered = list_or_discover_configs(&state, &project_id).expect("list");
        assert_eq!(discovered.len(), 1);

        let custom = vec![LaunchConfig {
            name: "Only mine".into(),
            type_: "go".into(),
            request: "launch".into(),
            ..LaunchConfig::default()
        }];
        save_configs(&state, &project_id, custom).expect("save");
        let reloaded = list_or_discover_configs(&state, &project_id).expect("list");
        assert_eq!(reloaded.len(), 1);
        assert_eq!(reloaded[0].name, "Only mine");

        // 入口点扫描门面：与发现结果同源。
        let entries = discover_entry_points(&state, &project_id).expect("entries");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].adapter_type, "go");

        // 未知项目 → `NotFound`（不静默返回空列表）。
        assert!(matches!(
            list_or_discover_configs(&state, "missing"),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            discover_entry_points(&state, "missing"),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            save_configs(&state, "missing", Vec::new()),
            Err(AppError::NotFound(_))
        ));
    }

    /// 项目未注册时 `isolated_state` 不带项目 —— 保证上面那条 NotFound 断言不是假绿。
    #[test]
    fn isolated_state_has_no_projects() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);
        assert!(project_path(&state, "proj").is_err());
    }
}
