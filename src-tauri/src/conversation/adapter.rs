use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

use crate::conversation::types::MessageBlock;

/// 删除能力三态（不是 bool）。
///
/// 为什么必须是三态（详见任务 `10-30-conversation-delete/design.md` §0）：
/// - `Native` 只在「CLI 删的就是 Neeko 列出的那一条」时成立（codex / opencode）；
/// - `Storage` 覆盖没有官方命令的 agent（pi / grok / clippy …），删除单元由 adapter 定义；
/// - 压成 bool 会隐藏实际可行的删除（pi 明明能删文件），或把 qoder 当 `Native` 删错库
///   （CLI 用 `~/.qoder/`，Neeko 读 `~/.qodercli/projects/`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionDeleteSupport {
    /// 委派 agent 自己的 CLI（它维护索引 / SQLite / 级联子会话）。
    Native,
    /// Adapter 删除这条会话独占的存储单元（单文件 / 目录 / 文件对）。
    Storage,
    /// 无安全删除路径 —— UI 不提供入口。
    #[default]
    Unsupported,
}

/// `path` 是否落在 `root` **之内**（删除前的硬防线）。
///
/// 只做词法判定（不 `canonicalize`：目标可能已被删掉，canonicalize 会失败），因此额外
/// 拒绝任何 `..` 分量 —— `Path::starts_with` 本身是词法的，`/a/../b` 会骗过纯前缀比较。
/// 严格包含：`path == root` 不算（删到 `session_root` 本身 = 删掉该 agent 全部会话）。
#[must_use]
pub(crate) fn is_owned_path(path: &Path, root: &Path) -> bool {
    let has_parent = |p: &Path| p.components().any(|c| matches!(c, Component::ParentDir));
    if has_parent(path) || has_parent(root) {
        return false;
    }
    path != root && path.starts_with(root)
}

/// 解析后的元数据（parse_meta 返回值）
#[derive(Debug, Clone)]
pub struct ParsedMeta {
    /// Native session identifier from the agent's storage.
    pub native_session_id: String,
    /// P2 候选：适配器提供的 AI 生成标题（无则 None）
    pub title: Option<String>,
    /// P3 候选：首条用户消息原文（净化后作为兜底标题）
    pub first_user_message: Option<String>,
    /// 预览来源：最近消息环形缓冲（role, 原文），已剔除 harness 注入噪声
    pub recent_messages: Vec<(String, String)>,
    /// 模型名称（如 "claude-sonnet-4-20250514"）
    pub model: Option<String>,
    /// Unix timestamp (ms) when the conversation started.
    pub started_at: i64,
    /// Unix timestamp (ms) when the conversation was last updated.
    pub updated_at: i64,
    /// Number of messages in the conversation.
    pub message_count: u32,
    /// Optional project path for this session.
    pub project_path: Option<String>,
}

/// 解析后的单条消息（parse_messages 返回值）
#[derive(Debug, Clone)]
pub struct ParsedMessage {
    /// Message author role (e.g. "user", "assistant").
    pub role: String,
    /// Raw text content of the message.
    pub content: String,
    /// 结构化内容块
    pub blocks: Vec<MessageBlock>,
    /// 消息级别的模型名称（可能中途切换）
    pub model: Option<String>,
    /// Unix timestamp (ms) when the message was created.
    pub timestamp: i64,
    /// Sequential message index within the conversation.
    pub seq: u32,
}

/// Agent 会话文件适配器 trait
///
/// 每个 Agent 实现此 trait 以支持从 Agent 原生存储格式中解析会话元数据和消息。
pub trait AgentSessionAdapter: Send + Sync {
    /// Agent identifier string.
    fn agent_id(&self) -> &str;
    /// Root directory for scanning session files.
    fn session_root(&self) -> PathBuf;
    /// Glob pattern to match session files.
    fn file_pattern(&self) -> &str;

    /// 快速解析元数据（只读文件头部，列表展示用）
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta>;

    /// 完整解析消息（查看详情时按需调用）
    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>>;

    /// Extract a native session ID from a file path.
    fn extract_session_id(&self, file_path: &Path) -> Option<String>;

    /// 构建恢复命令。None = 不支持原生恢复。
    fn resume_command(&self, native_session_id: &str, project_path: &str) -> Option<Vec<String>>;

    /// Build resume CLI args with access to the session file path.
    ///
    /// Default: delegate to [`Self::resume_command`]. Override when the CLI needs an
    /// absolute transcript path (e.g. Reasonix `run --resume <PATH>`).
    fn resume_command_for_file(
        &self,
        native_session_id: &str,
        project_path: &str,
        _file_path: &Path,
    ) -> Option<Vec<String>> {
        self.resume_command(native_session_id, project_path)
    }

    /// 这条会话的删除能力（扫描期写入 `ConversationMeta.delete_support`）。
    ///
    /// 默认 `Unsupported`（fail-closed）：新增 adapter 忘表态时宁可不提供入口。
    fn delete_support(&self) -> SessionDeleteSupport {
        SessionDeleteSupport::Unsupported
    }

    /// `Native` 专用：交给 CLI 的完整 argv（`argv[0]` 是可执行文件名）。
    ///
    /// 默认 `None` —— 与 `delete_support() == Unsupported` 自洽；契约测试要求
    /// `delete_support() == Native` 时这里必须给出非空 argv（红线 14：声明必须实现）。
    fn delete_command(
        &self,
        _native_session_id: &str,
        _project_path: Option<&str>,
        _file_path: &Path,
    ) -> Option<Vec<String>> {
        None
    }

    /// `Storage` 专用：本次删除要移除的路径集合（含兄弟文件 / 目录）。
    ///
    /// 默认 = 会话文件本身。删除单元由存储形态决定，因此属于 adapter 的知识，
    /// 不进命令层（红线 10：不写 `agent_id == "…"` 分支）。
    fn delete_targets(&self, file_path: &Path, _native_session_id: &str) -> Vec<PathBuf> {
        vec![file_path.to_path_buf()]
    }

    /// 批量解析全部元数据（用于单文件多会话场景，如 SQLite 数据库）。
    ///
    /// 返回 `None` 表示使用默认的逐文件扫描（现有行为）。
    /// 返回 `Some(Ok(vec))` 替代 WalkDir 循环，每条记录包含 `(ParsedMeta, synthetic_path)`。
    /// `synthetic_path` 会存入 `ConversationMeta.file_path`，供 `parse_messages` 后续使用。
    fn parse_all_metas(&self) -> Option<Result<Vec<(ParsedMeta, PathBuf)>>> {
        None
    }

    /// Project-scoped bulk parse. Default: full bulk then no extra filter (manager filters).
    ///
    /// Adapters that can cheaply restrict discovery (e.g. OpenCode SQL `directory`)
    /// should override this so scan work stays proportional to the active project.
    fn parse_all_metas_for_project(
        &self,
        project_path: Option<&str>,
    ) -> Option<Result<Vec<(ParsedMeta, PathBuf)>>> {
        let _ = project_path;
        self.parse_all_metas()
    }

    /// Optional project-scoped discovery roots for WalkDir-based adapters.
    ///
    /// - `None` → manager walks the full `session_root()` (default / unscoped).
    /// - `Some(roots)` → manager only walks those directories.
    /// - `Some(empty)` → early stop: no sessions for this project without a full walk.
    ///
    /// Bulk adapters (`parse_all_metas*`) ignore this; they scope inside SQL / bulk parse.
    fn discovery_roots(&self, project_path: Option<&str>) -> Option<Vec<PathBuf>> {
        let _ = project_path;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation::adapter::{AgentSessionAdapter, ParsedMeta};

    /// 最小 adapter：只实现必需方法，删除能力全部走 trait 默认值。
    struct DefaultsOnly;

    impl AgentSessionAdapter for DefaultsOnly {
        fn agent_id(&self) -> &str {
            "defaults-only"
        }
        fn session_root(&self) -> PathBuf {
            PathBuf::from("/tmp/neeko-adapter-defaults")
        }
        fn file_pattern(&self) -> &str {
            "*.jsonl"
        }
        fn parse_meta(&self, _file_path: &Path) -> Result<ParsedMeta> {
            anyhow::bail!("not used")
        }
        fn parse_messages(
            &self,
            _file_path: &Path,
        ) -> Result<Vec<crate::conversation::adapter::ParsedMessage>> {
            anyhow::bail!("not used")
        }
        fn extract_session_id(&self, _file_path: &Path) -> Option<String> {
            None
        }
        fn resume_command(
            &self,
            _native_session_id: &str,
            _project_path: &str,
        ) -> Option<Vec<String>> {
            None
        }
    }

    /// fail-closed 默认值：新增 adapter 不表态时**必须**是 `Unsupported`，
    /// 而不是「恰好可用」的 `Storage`（那会让未实测的 agent 拿到删除入口）。
    ///
    /// 变异验证：把 `delete_support()` 默认值改成 `Storage` → 本用例红。
    #[test]
    fn should_default_to_unsupported_delete_support() {
        let adapter = DefaultsOnly;
        assert_eq!(adapter.delete_support(), SessionDeleteSupport::Unsupported);
        assert!(adapter
            .delete_command(
                "sid",
                None,
                Path::new("/tmp/neeko-adapter-defaults/a.jsonl")
            )
            .is_none());
    }

    /// `delete_targets` 默认 = 会话文件本身（单文件存储的 agent 不需要写 override）。
    ///
    /// 变异验证：默认实现改成返回空 Vec → 本用例红，且 `Storage` 契约用例也会红。
    #[test]
    fn should_default_delete_targets_to_the_session_file() {
        let adapter = DefaultsOnly;
        let file = Path::new("/tmp/neeko-adapter-defaults/a.jsonl");
        assert_eq!(
            adapter.delete_targets(file, "sid"),
            vec![file.to_path_buf()]
        );
    }

    /// 三态序列化成前端读的 snake_case 字面量（红线 5 的同一动机：单一事实源，
    /// 前端 `deleteSupport` 的字面量与本处必须同形）。
    #[test]
    fn should_serialize_delete_support_as_snake_case() {
        let cases = [
            (SessionDeleteSupport::Native, "\"native\""),
            (SessionDeleteSupport::Storage, "\"storage\""),
            (SessionDeleteSupport::Unsupported, "\"unsupported\""),
        ];
        for (value, expected) in cases {
            let json = serde_json::to_string(&value).expect("serialize");
            assert_eq!(json, expected);
            let back: SessionDeleteSupport = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(back, value);
        }
    }

    /// 旧磁盘索引（无 `deleteSupport` 字段）反序列化时必须落 `Unsupported`，
    /// 而不是整体解析失败（缓存被污染 = 列表消失）。
    #[test]
    fn should_fall_back_to_unsupported_when_field_is_missing() {
        let meta: crate::conversation::types::ConversationMeta =
            serde_json::from_value(serde_json::json!({
                "id": "pi:abc",
                "nativeSessionId": "abc",
                "agentId": "pi",
                "title": "t",
                "startedAt": 1,
                "updatedAt": 2,
                "messageCount": 0,
                "preview": "",
                "filePath": "/tmp/x.jsonl",
                "projectPath": null,
                "userTitle": null,
                "tags": [],
            }))
            .expect("legacy index row must still deserialize");
        assert_eq!(meta.delete_support, SessionDeleteSupport::Unsupported);
    }

    /// 越界判定：`..` 会骗过纯词法前缀比较，必须被拒；`session_root` 本身也不算。
    #[test]
    fn should_reject_parent_dir_escape_in_owned_path() {
        let root = Path::new("/root/projects");
        assert!(is_owned_path(Path::new("/root/projects/a/s.jsonl"), root));
        assert!(!is_owned_path(root, root));
        assert!(!is_owned_path(Path::new("/root/projects/../secret"), root));
        assert!(!is_owned_path(Path::new("/root/projects-other/a"), root));
        assert!(!is_owned_path(Path::new("/etc/passwd"), root));
    }
}
