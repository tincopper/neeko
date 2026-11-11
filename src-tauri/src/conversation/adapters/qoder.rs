use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::common::agent::descriptor;
use crate::conversation::adapter::{
    AgentSessionAdapter, ParsedMessage, ParsedMeta, SessionDeleteSupport,
};
use crate::conversation::adapters::claude_code::ClaudeCodeAdapter;

/// Qoder CLI 会话适配器。
///
/// 会话格式：`~/.qoder/projects/<sanitized-cwd>/<uuid>.jsonl`
///
/// **它就是 Claude Code 格式的 fork**（2026-11-10 实测）：行形态是
/// `{"type":"user"|"assistant","message":{…},"timestamp":…,"sessionId":…,"cwd":…}`，
/// 另有 `ai-title`（`aiTitle` 字段，与 Claude 同名）、`workspace-directories`、
/// `runtime-config`、`worktree-state`、`active-leaf` 等元数据行。
///
/// 所以这里**不复制一份解析**，而是委派给 [`ClaudeCodeAdapter`] —— 与 hooks 域
/// 「claude / codebuddy / qoder 共用 `CLAUDE_COMPAT_ENTRIES` 一张表」同一个判断：
/// 同一种格式只允许有一份实现，否则两边会各自漂移（本 adapter 的历史缺陷正是如此：
/// 它指向 `~/.qodercli/projects`，而 CLI 早就在写 `~/.qoder/projects`，于是 qoder
/// 在 History 里**一条会话都没有**，标题自然也就无从谈起）。
///
/// 不支持原生 CLI 恢复（仅 TUI 内的 `/resume`），删除按存储单元（单个 jsonl）。
pub struct QoderAdapter;

impl AgentSessionAdapter for QoderAdapter {
    fn agent_id(&self) -> &str {
        "qoder"
    }

    fn session_root(&self) -> PathBuf {
        // 路径事实的唯一来源：`common::agent::descriptor`（同一行里也声明着 hook 配置根，
        // 两处无法互相漂移）。
        descriptor::transcript_root(self.agent_id())
    }

    /// 与 Claude 同形：`projects/<sanitized>/<uuid>.jsonl`，嵌套仍需 `**/`。
    fn file_pattern(&self) -> &str {
        descriptor::file_pattern(self.agent_id())
    }

    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        let meta = ClaudeCodeAdapter.parse_meta(file_path)?;
        // 会话 id 必须是 uuid 文件名（会话恢复 / hook 归因 / 删除都靠它），
        // 而 Claude 侧允许从 `mode` 行取 id —— Qoder 不写 `mode`，这里统一用文件名的
        // 语义由 Claude 侧的文件名兜底分支保证；显式断言避免「取到别的字段」的静默错配。
        anyhow::ensure!(
            !meta.native_session_id.is_empty(),
            "Qoder session file has no session id"
        );
        Ok(meta)
    }

    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
        ClaudeCodeAdapter.parse_messages(file_path)
    }

    fn extract_session_id(&self, file_path: &Path) -> Option<String> {
        ClaudeCodeAdapter.extract_session_id(file_path)
    }

    fn resume_command(&self, _native_session_id: &str, _project_path: &str) -> Option<Vec<String>> {
        None
    }

    /// **不委派** `qoder --delete-session <index>`：它按索引寻址（删除后索引漂移），
    /// 且目标库与 Neeko 读取的不是同一处。删 Neeko 实际读取的那个 jsonl。
    fn delete_support(&self) -> SessionDeleteSupport {
        SessionDeleteSupport::Storage
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// 与真实 Qoder 落盘同形（2026-11-10 取自 `~/.qoder/projects/<proj>/<uuid>.jsonl`）：
    /// 头部是元数据行（无 message），随后是 Claude 同形的 user / assistant 行，
    /// 主题来自 `ai-title` 行的 `aiTitle`。
    fn create_qoder_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let content = concat!(
            r#"{"type":"workspace-directories","sessionId":"029cf86c-2e3e-4c07-a469-b447d411bc2e","directories":["/Users/tomgs/RustroverProjects/neeko"]}"#,
            "\n",
            r#"{"type":"runtime-config","sessionId":"029cf86c-2e3e-4c07-a469-b447d411bc2e","model":"qfmodel","timestamp":1790692897349}"#,
            "\n",
            r#"{"type":"worktree-state","sessionId":"029cf86c-2e3e-4c07-a469-b447d411bc2e","worktreeSession":null}"#,
            "\n",
            r#"{"type":"user","uuid":"u1","timestamp":"2026-09-29T14:41:42.319Z","message":{"role":"user","content":"帮我修一下登录跳转的竞态"},"cwd":"/Users/tomgs/RustroverProjects/neeko","sessionId":"029cf86c-2e3e-4c07-a469-b447d411bc2e"}"#,
            "\n",
            r#"{"type":"assistant","uuid":"a1","timestamp":"2026-09-29T14:42:25.952Z","message":{"role":"assistant","model":"qmodel_38max","content":[{"type":"text","text":"先看 SessionStore 的写入点"}]},"cwd":"/Users/tomgs/RustroverProjects/neeko"}"#,
            "\n",
            r#"{"type":"ai-title","sessionId":"029cf86c-2e3e-4c07-a469-b447d411bc2e","aiTitle":"修复登录跳转竞态"}"#,
            "\n",
        );
        std::fs::write(&path, content).expect("Failed to write fixture");
        path
    }

    #[test]
    fn should_read_the_real_qoder_layout() {
        let root = QoderAdapter.session_root();
        assert!(
            root.ends_with(".qoder/projects"),
            "Qoder CLI 实际写在 ~/.qoder/projects（旧实现指向 ~/.qodercli/projects，扫到 0 条）：{root:?}"
        );
        assert_eq!(QoderAdapter.file_pattern(), "**/*.jsonl");
    }

    /// 标题优先取 CLI 自己的 `aiTitle`，退化为首条用户消息 —— 与 Claude 同一条阶梯。
    #[test]
    fn should_parse_meta_with_the_cli_title() {
        let dir = TempDir::new().unwrap();
        let path = create_qoder_fixture(&dir, "029cf86c-2e3e-4c07-a469-b447d411bc2e.jsonl");
        let meta = QoderAdapter.parse_meta(&path).unwrap();

        assert_eq!(
            meta.native_session_id,
            "029cf86c-2e3e-4c07-a469-b447d411bc2e"
        );
        assert_eq!(meta.title.as_deref(), Some("修复登录跳转竞态"));
        assert_eq!(meta.message_count, 2);
        assert_eq!(
            meta.project_path.as_deref(),
            Some("/Users/tomgs/RustroverProjects/neeko")
        );
        assert_eq!(meta.started_at, 1_790_692_902_319);
    }

    #[test]
    fn should_parse_messages_and_skip_metadata_rows() {
        let dir = TempDir::new().unwrap();
        let path = create_qoder_fixture(&dir, "029cf86c-2e3e-4c07-a469-b447d411bc2e.jsonl");
        let messages = QoderAdapter.parse_messages(&path).unwrap();

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert!(messages[0].content.contains("登录跳转"));
        assert_eq!(messages[1].role, "assistant");
    }

    /// 首条 user 若是 harness 注入（`<local-command-caveat>` 等），标题必须顺延到
    /// 下一条真实发言 —— 否则侧栏会显示一串注入文本（实测 Claude 侧出现过 11 条）。
    #[test]
    fn should_skip_harness_injected_first_turn() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("s.jsonl");
        std::fs::write(
            &path,
            concat!(
                r#"{"type":"user","timestamp":"2026-09-29T14:41:42.319Z","message":{"role":"user","content":"<local-command-caveat>Caveat: The messages below were generated by the user…</local-command-caveat>"}}"#,
                "\n",
                r#"{"type":"user","timestamp":"2026-09-29T14:41:50.000Z","message":{"role":"user","content":"真实的问题：登录页跳转偶发 404"}}"#,
                "\n",
            ),
        )
        .unwrap();

        let meta = QoderAdapter.parse_meta(&path).unwrap();
        assert_eq!(
            meta.first_user_message.as_deref(),
            Some("真实的问题：登录页跳转偶发 404")
        );
    }

    #[test]
    fn should_resume_command_return_none() {
        assert!(QoderAdapter
            .resume_command("test-id", "/projects/test")
            .is_none());
    }

    #[test]
    fn should_handle_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.jsonl");
        std::fs::write(&path, "").expect("Failed to write");
        assert!(QoderAdapter.parse_meta(&path).is_err());
    }
}
