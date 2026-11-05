//! 启动期工作区恢复：把持久化会话投影回内存（项目列表 + 激活项目）。
//!
//! 本模块拥有「会话 → 内存」的规则，调用方（组合根）只负责调用时机：
//!
//! - **项目列表** = 会话里的项目逐条装载；单条失败（路径已不存在等）不阻断其余，
//!   只记警告 —— 一个失效项目不该让整次启动降级；
//! - **激活项目**必须指向本次装载成功的项目之一，悬空 id 一律降级为 `None`
//!   （旧会话可能引用已被删除的项目）；
//! - 启动期**不**预挂 watcher 单元：挂载的唯一发起点是前端 `useVisibleWorkspaces`
//!   （它把「热集合」声明成 `set_visible_workspaces`，后端按声明 reconcile）。旧实现
//!   在此按会话的激活项目先挂主仓，于是每次启动都出现「先挂主仓、1 秒后改挂
//!   worktree」的两发起点时序差（实测日志报 already watched）；
//! - 会话文件缺失 / 损坏**不**视为启动失败：返回空结果，应用以空工作区启动。

use std::sync::Mutex;

use crate::project::ProjectManager;
use crate::session::StorageManager;

/// 从持久化会话恢复项目列表，并返回**校验后**的激活项目 id。
///
/// 会话文件缺失 / 损坏、项目路径失效都**不**视为启动失败：降级为空工作区。
/// 装载计数只进日志 —— 调用方唯一需要动作的是「激活哪个项目」，故不造返回值结构
/// （将来确有消费方再加字段，不一上来就预留）。
#[must_use]
pub fn restore_workspace(
    storage: &StorageManager,
    projects: &Mutex<ProjectManager>,
) -> Option<String> {
    let Ok(session) = storage.load_session() else {
        log::warn!("[boot] session unavailable; starting with an empty workspace");
        return None;
    };
    let Ok(mut manager) = projects.lock() else {
        log::error!("[boot] project manager lock poisoned; workspace not restored");
        return None;
    };

    let mut loaded_ids: Vec<String> = Vec::with_capacity(session.projects.len());
    for project in &session.projects {
        match manager.add_project_from_session(project) {
            Ok(restored) => loaded_ids.push(restored.id),
            Err(e) => log::warn!(
                "[boot] failed to restore project '{}' ({}): {e}",
                project.id,
                project.path.display()
            ),
        }
    }

    let active_project_id = session
        .active_project_id
        .filter(|id| loaded_ids.contains(id));
    log::info!(
        "[boot] restored {} of {} project(s); active project: {:?}",
        loaded_ids.len(),
        session.projects.len(),
        active_project_id
    );
    active_project_id
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::{Path, PathBuf};

    use crate::session::{ProjectSession, SessionStore};

    /// 在隔离状态里造 `count` 个真实存在的项目目录，并写入一份会话快照。
    ///
    /// 路径一律由 `tempfile` 推导（红线 13）；会话经 serde 构造，避免测试耦合
    /// 非 serde 的字段顺序。
    fn seed_session(
        tmp: &tempfile::TempDir,
        storage: &StorageManager,
        count: usize,
        active: Option<&str>,
    ) -> Vec<ProjectSession> {
        let dirs: Vec<PathBuf> = (0..count)
            .map(|i| tmp.path().join(format!("proj-{i}")))
            .collect();
        for dir in &dirs {
            std::fs::create_dir_all(dir).expect("fixture: project dir");
        }
        let projects: Vec<ProjectSession> = dirs
            .iter()
            .enumerate()
            .map(|(i, dir)| ProjectSession {
                id: format!("p{i}"),
                name: format!("p{i}"),
                path: dir.clone(),
                environment: crate::core::ProjectEnvironment::Local,
                selected_agents: Vec::new(),
                selected_ide: None,
                terminal_history: Vec::new(),
                last_status: crate::common::terminal::types::TerminalStatus::Idle,
                collapsed: false,
                avatar_color: None,
                primary_language: None,
            })
            .collect();
        let session = SessionStore {
            projects: projects.clone(),
            active_project_id: active.map(str::to_string),
            last_updated: String::new(),
            wsl_entries: Vec::new(),
            remote_entries: Vec::new(),
            sidebar_width: None,
            worktree_state: std::collections::HashMap::new(),
        };
        storage
            .save_session(&session)
            .expect("fixture: save session");
        projects
    }

    /// 正常路径：项目全部装载，激活 id 原样返回。
    #[test]
    fn restores_projects_and_keeps_live_active_id() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = crate::common::testing::isolated_state(&tmp);
        seed_session(&tmp, &state.storage_manager, 2, Some("p1"));

        let restored = restore_workspace(&state.storage_manager, &state.project_manager);

        assert_eq!(restored.as_deref(), Some("p1"));
        assert_eq!(
            state
                .project_manager
                .lock()
                .expect("lock")
                .list_projects()
                .len(),
            2,
            "装载结果必须落进 ProjectManager"
        );
    }

    /// 悬空激活 id（旧会话引用已删除项目）→ 降级为 None，不阻断启动。
    #[test]
    fn dangling_active_id_downgrades_to_none() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = crate::common::testing::isolated_state(&tmp);
        seed_session(&tmp, &state.storage_manager, 1, Some("deleted-project"));

        let restored = restore_workspace(&state.storage_manager, &state.project_manager);

        assert_eq!(restored, None);
        assert_eq!(
            state
                .project_manager
                .lock()
                .expect("lock")
                .list_projects()
                .len(),
            1,
            "悬空 id 只影响激活项，不影响装载"
        );
    }

    /// 单体失败不阻断其余：失效路径的项目被跳过，其余照常装载。
    #[test]
    fn missing_project_path_skips_only_that_project() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = crate::common::testing::isolated_state(&tmp);
        let mut projects = seed_session(&tmp, &state.storage_manager, 2, Some("p1"));
        projects[0].path = tmp.path().join("no-such-dir");
        state
            .storage_manager
            .save_session(&SessionStore {
                projects,
                active_project_id: Some("p1".to_string()),
                last_updated: String::new(),
                wsl_entries: Vec::new(),
                remote_entries: Vec::new(),
                sidebar_width: None,
                worktree_state: std::collections::HashMap::new(),
            })
            .expect("fixture: save session");

        let restored = restore_workspace(&state.storage_manager, &state.project_manager);

        assert_eq!(restored.as_deref(), Some("p1"));
        assert_eq!(
            state
                .project_manager
                .lock()
                .expect("lock")
                .list_projects()
                .len(),
            1,
            "无效项目必须被跳过，其余照常装载"
        );
    }

    /// 会话文件损坏（不可解析）→ 空工作区启动，绝不 panic / 绝不阻断启动。
    #[test]
    fn corrupt_session_file_starts_empty() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = crate::common::testing::isolated_state(&tmp);
        std::fs::create_dir_all(tmp.path().join(".neeko")).expect("fixture: config dir");
        std::fs::write(tmp.path().join(".neeko/sessions.json"), "{not json").expect("fixture");
        assert!(Path::new(&tmp.path().join(".neeko/sessions.json")).exists());

        let restored = restore_workspace(&state.storage_manager, &state.project_manager);

        assert_eq!(restored, None);
    }
}
