//! 归属降级链（design D8）——纯函数，红线 13 合规（测试夹具全部 tempdir 推导）。
//!
//! 三级降级：①Neeko 自有终端注入的 env 提示（精确命中会话实例，与源 A 同 id 天然去重）
//! ②cwd 对 ProjectStore 项目根做前缀反查（最长根胜出，兼容 worktree 嵌套）
//! ③cwd basename 兜底 —— 宁多归属不丢事件（与 orca 的丢弃策略相反的显式产品决策）。

use std::path::{Path, PathBuf};

/// hook 上报携带的环境提示（Neeko 自有 PTY/会话注入的 env，被上报代码原样回传）。
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(default)]
pub struct EnvHints {
    /// `NEEKO_SESSION_ID`：命中即精确归属到既有会话实例。
    pub neeko_session_id: Option<String>,
    /// `NEEKO_PROJECT_ID`：辅助提示（项目身份）。
    pub project_id: Option<String>,
    /// `NEEKO_TEAM_ID`：团队上下文（成员 PTY 注入，见 `agent::team::identity`）。
    ///
    /// **本字段不参与 [`attribute`]** —— 既有降级链的行为必须逐字不变（通知链路回归面）。
    /// 团队归因裁决在 `agent::team::identity::attribution_verdict`，那里缺身份是**拒绝**
    /// 而不是回退 cwd（design §5.4：同 cwd 会串台）。
    pub team_id: Option<String>,
    /// `NEEKO_TEAM_MEMBER_ID`：成员身份；语义同 [`EnvHints::team_id`]。
    pub team_member_id: Option<String>,
}

/// 归属所需的项目视图（从既有 ProjectManager 取的只读快照 —— 复用，不新建索引）。
#[derive(Clone, Debug)]
pub struct ProjectRef {
    /// 项目身份 id。
    pub project_id: String,
    /// 项目展示名（进 group_label）。
    pub project_name: String,
    /// 项目根（含 worktree 单元时由调用方逐根展开）。
    pub roots: Vec<PathBuf>,
}

/// 归属产物：核心域 `SourceRef` 所需的实例与分组身份 + 回流辅助。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Attribution {
    /// 精确归属时 = neeko session id；否则 `cli:{agent_session_id}`。
    pub instance_id: String,
    /// 分组展示名（项目名或 basename 兜底），进通知标题。
    pub group_label: String,
}

/// 归属降级链（纯函数）。无任何 IO / 时钟依赖，100% 可单测。
#[must_use]
pub fn attribute(
    agent_session_id: &str,
    cwd: Option<&str>,
    hints: &EnvHints,
    projects: &[ProjectRef],
) -> Attribution {
    // 1) env 注入命中：instance = neeko session id（源 A/B 同键 → 跨源节流/去重自动生效）。
    if let (Some(sid), Some(pid)) = (&hints.neeko_session_id, &hints.project_id) {
        let name = projects
            .iter()
            .find(|p| &p.project_id == pid)
            .map(|p| p.project_name.clone())
            .unwrap_or_else(|| "Neeko".to_string());
        return Attribution {
            instance_id: sid.clone(),
            group_label: name,
        };
    }

    // 2) cwd 反查：对项目每个 root 做路径前缀匹配，最长命中胜出（worktree 嵌套更精确）。
    if let Some(cwd) = cwd.map(str::trim).filter(|c| !c.is_empty()) {
        let cwd_path = Path::new(cwd);
        let mut best: Option<(usize, &ProjectRef)> = None;
        for project in projects {
            for root in &project.roots {
                if cwd_path.starts_with(root) {
                    let depth = root.components().count();
                    if best.is_none_or(|(d, _)| depth > d) {
                        best = Some((depth, project));
                    }
                }
            }
        }
        if let Some((_, project)) = best {
            return Attribution {
                instance_id: format!("cli:{agent_session_id}"),
                group_label: project.project_name.clone(),
            };
        }
        // 3) basename 兜底（仍通知，group 用目录名）。
        let base = cwd_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| cwd.to_string());
        return Attribution {
            instance_id: format!("cli:{agent_session_id}"),
            group_label: base,
        };
    }

    // 无 cwd 无 hints：最弱兜底，不丢事件。
    Attribution {
        instance_id: format!("cli:{agent_session_id}"),
        group_label: "终端会话".into(),
    }
}

// ── TDD：降级链三级 + 边界（夹具全部 tempdir 推导，红线 13）─────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// 以 tempdir 基底构造两项目夹具（p2 带嵌套 worktree 单元根）。
    fn fixture(tmp: &Path) -> (Vec<ProjectRef>, String, String) {
        let p1_root = tmp.join("workspaces").join("neeko");
        let p2_root = tmp.join("workspaces").join("orca");
        let p2_wt = tmp.join("workspaces").join("orca-wt").join("feature-x");
        let projects = vec![
            ProjectRef {
                project_id: "p1".into(),
                project_name: "neeko".into(),
                roots: vec![p1_root.clone()],
            },
            ProjectRef {
                project_id: "p2".into(),
                project_name: "orca-study".into(),
                roots: vec![p2_root, p2_wt.clone()],
            },
        ];
        (
            projects,
            p1_root.to_string_lossy().into_owned(),
            p2_wt.to_string_lossy().into_owned(),
        )
    }

    /// 降级链第 1 级：env 注入命中 → 精确归属（instance = neeko session，跨源去重前提）。
    #[test]
    fn env_hint_wins_over_cwd() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (projects, p1, _) = fixture(tmp.path());
        let hints = EnvHints {
            neeko_session_id: Some("s42".into()),
            project_id: Some("p1".into()),
            ..EnvHints::default()
        };
        let a = attribute("agent-xyz", Some(&p1), &hints, &projects);
        assert_eq!(a.instance_id, "s42");
        assert_eq!(a.group_label, "neeko");
    }

    /// env 提示了未知 project_id → 不 panic，group 落通用名。
    #[test]
    fn env_hint_with_unknown_project_degrades_gracefully() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (projects, _, _) = fixture(tmp.path());
        let hints = EnvHints {
            neeko_session_id: Some("s42".into()),
            project_id: Some("ghost".into()),
            ..EnvHints::default()
        };
        let a = attribute("agent-xyz", None, &hints, &projects);
        assert_eq!(a.group_label, "Neeko");
    }

    /// 降级链第 2 级：cwd 前缀反查项目。
    #[test]
    fn cwd_maps_to_project() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (projects, p1, _) = fixture(tmp.path());
        let cwd = Path::new(&p1)
            .join("src-tauri")
            .to_string_lossy()
            .into_owned();
        let a = attribute("agent-1", Some(&cwd), &EnvHints::default(), &projects);
        assert_eq!(a.instance_id, "cli:agent-1");
        assert_eq!(a.group_label, "neeko");
    }

    /// worktree 单元根命中优先于项目主根（最长前缀胜出）。
    #[test]
    fn longest_prefix_wins_for_worktrees() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (projects, _, p2_wt) = fixture(tmp.path());
        let cwd = Path::new(&p2_wt).join("src").to_string_lossy().into_owned();
        let a = attribute("agent-2", Some(&cwd), &EnvHints::default(), &projects);
        assert_eq!(a.group_label, "orca-study");
    }

    /// 降级链第 3 级：无匹配项目 → basename 兜底，仍产生归属（D8 不丢事件）。
    #[test]
    fn unknown_cwd_falls_back_to_basename() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (projects, _, _) = fixture(tmp.path());
        let cwd = tmp
            .path()
            .join("scratch-project")
            .to_string_lossy()
            .into_owned();
        let a = attribute("agent-3", Some(&cwd), &EnvHints::default(), &projects);
        assert_eq!(a.group_label, "scratch-project");
        assert_eq!(a.instance_id, "cli:agent-3");
    }

    /// 无 cwd 无 hints：最弱兜底，不 panic、不丢事件。
    #[test]
    fn missing_everything_still_attributes() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (projects, _, _) = fixture(tmp.path());
        let a = attribute("agent-4", None, &EnvHints::default(), &projects);
        assert_eq!(a.instance_id, "cli:agent-4");
        assert_eq!(a.group_label, "终端会话");
    }

    /// 空白 cwd 视同缺失（防止前端把 "" 当合法路径传到兜底）。
    #[test]
    fn blank_cwd_treated_as_missing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (projects, _, _) = fixture(tmp.path());
        let a = attribute("agent-5", Some("   "), &EnvHints::default(), &projects);
        assert_eq!(a.group_label, "终端会话");
    }

    /// 团队 env **不参与**既有降级链：成员的上报仍按原三级归（通知链路逐字不变）。
    ///
    /// 团队归因是**另一条路**（`agent::team::identity::attribution_verdict`），
    /// 两条路共用同一份 `EnvHints` 但裁决相反：通知侧宁可多归，团队侧宁可拒归
    /// （design §5.4：串台的代价不可见）。改这里 = 动通知回归面。
    #[test]
    fn team_env_does_not_change_the_notification_attribution() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (projects, p1, _) = fixture(tmp.path());
        let with_team = EnvHints {
            team_id: Some("tm_1".into()),
            team_member_id: Some("w1@tm_1".into()),
            ..EnvHints::default()
        };
        let without_team = EnvHints::default();
        let cwd = Path::new(&p1).join("src").to_string_lossy().into_owned();
        assert_eq!(
            attribute("agent-6", Some(&cwd), &with_team, &projects),
            attribute("agent-6", Some(&cwd), &without_team, &projects),
        );
    }

    /// `hints` 的 wire 形式：缺字段全 None（旧模板），出现时读入（新模板）。
    #[test]
    fn hints_deserialize_with_and_without_team_fields() {
        let old: EnvHints = serde_json::from_str(r#"{"neeko_session_id":"s1","project_id":"p1"}"#)
            .expect("old hints");
        assert_eq!(old.team_id, None);
        assert_eq!(old.team_member_id, None);

        let new: EnvHints = serde_json::from_str(
            r#"{"neeko_session_id":null,"project_id":null,"team_id":"tm_1","team_member_id":"w1@tm_1"}"#,
        )
        .expect("new hints");
        assert_eq!(new.team_id.as_deref(), Some("tm_1"));
        assert_eq!(new.team_member_id.as_deref(), Some("w1@tm_1"));
    }
}
