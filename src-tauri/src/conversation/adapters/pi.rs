use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::conversation::adapter::{
    AgentSessionAdapter, ParsedMessage, ParsedMeta, SessionDeleteSupport,
};
use crate::conversation::adapters::content_blocks::{extract_message_content, has_visible_text};
use crate::conversation::adapters::{
    linearize_tree_entries, message_role, parse_timestamp, read_jsonl, CONVERSATION_ROLES,
};
use crate::conversation::normalize::recent_messages_from_rev;
use crate::conversation::text::{strip_ansi, strip_image_references};

/// Pi CLI 会话适配器
///
/// 会话格式：`~/.pi/agent/sessions/<sanitized-path>/*.jsonl`
/// - 首行 type="session" 包含版本、ID、时间戳（**从不写 name/title**，标题只能靠 P3 首条用户消息）
/// - 后续行为 type="message" 含 id/parentId 树结构；`message.content` 恒为**块数组**
///   （text / thinking / toolCall），工具结果单独成 `role: "toolResult"` 记录
/// - 不支持原生 CLI 恢复（仅 TUI 内的 /resume 命令）
pub struct PiAdapter;

impl AgentSessionAdapter for PiAdapter {
    fn agent_id(&self) -> &str {
        "pi"
    }

    fn session_root(&self) -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("~"))
            .join(".pi")
            .join("agent")
            .join("sessions")
    }

    fn discovery_roots(&self, project_path: Option<&str>) -> Option<Vec<std::path::PathBuf>> {
        crate::conversation::scope::discovery_roots_for(
            self.session_root(),
            project_path,
            crate::conversation::scope::EncodeStyle::Pi,
        )
    }

    fn file_pattern(&self) -> &str {
        "*.jsonl"
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        let entries = read_jsonl(file_path)?;
        let first = entries.first().context("Pi session file is empty")?;

        // 从 session 行提取 session ID
        let native_session_id = first
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string()
            });

        let title = first
            .get("name")
            .or_else(|| first.get("title"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let started_at = first
            .get("timestamp")
            .and_then(parse_timestamp)
            .unwrap_or(0);

        let updated_at = entries
            .last()
            .and_then(|e| e.get("timestamp"))
            .and_then(parse_timestamp)
            .unwrap_or(started_at);

        // 对话回合 = 正文视图口径（角色白名单）。后续三个量都基于它，避免逐条抽取整段正文：
        // 计数走轻量判定，标题只抽 user 回合，预览由新到旧惰性抽取凑满 5 条即停。
        let conversation_entries: Vec<&serde_json::Value> = entries
            .iter()
            .filter(|e| {
                e.get("type").and_then(|v| v.as_str()) == Some("message")
                    && message_role(e).is_some_and(|r| CONVERSATION_ROLES.contains(&r))
            })
            .collect();
        let message_count = conversation_entries
            .iter()
            .filter(|e| has_visible_text(e))
            .count() as u32;

        // 首条用户消息（P3 标题候选）：纯图片回合不是标题素材，继续往下找
        let first_user_raw = conversation_entries
            .iter()
            .filter(|e| message_role(e) == Some("user"))
            .map(|e| extract_message_content(e).text)
            .find(|text| !strip_image_references(text).trim().is_empty());

        let recent_messages =
            recent_messages_from_rev(conversation_entries.iter().rev().filter_map(|e| {
                Some((
                    message_role(e)?.to_string(),
                    extract_message_content(e).text,
                ))
            }));

        // 会话模型：pi 在 `model_change` 行写 `modelId`，助手消息再写一份 `message.model`
        let model = entries
            .iter()
            .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("model_change"))
            .and_then(|e| e.get("modelId").or_else(|| e.get("model")))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                conversation_entries
                    .iter()
                    .find_map(|e| e.pointer("/message/model").and_then(|v| v.as_str()))
                    .map(|s| s.to_string())
            });

        // 项目路径：从 session 行或文件路径
        let project_path = first
            .get("cwd")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                file_path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            });

        Ok(ParsedMeta {
            native_session_id,
            title,
            first_user_message: first_user_raw,
            recent_messages,
            model,
            started_at,
            updated_at,
            message_count,
            project_path,
        })
    }

    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
        let entries = read_jsonl(file_path)?;

        // 线性化树形结构
        let linearized = linearize_tree_entries(&entries, "id", "parentId", "type", None);

        let mut messages = Vec::new();
        for (idx, seq) in &linearized {
            let entry = &entries[*idx];
            let entry_type = entry.get("type").and_then(|v| v.as_str()).unwrap_or("");

            if entry_type != "message" {
                continue;
            }

            let role = message_role(entry).unwrap_or("user");
            // 工具结果以整条 `toolResult` 记录形式落盘，不进正文视图（体量不可控，红线 4）
            if !CONVERSATION_ROLES.contains(&role) {
                continue;
            }

            // 正文与结构化块同源抽取（块数组 → text / thinking / toolCall）
            let content = extract_message_content(entry);
            let cleaned = strip_ansi(&content.text);
            if cleaned.trim().is_empty() {
                continue;
            }

            let timestamp = entry
                .get("timestamp")
                .and_then(parse_timestamp)
                .unwrap_or(0);

            messages.push(ParsedMessage {
                role: role.to_string(),
                content: cleaned,
                blocks: content.blocks,
                // pi 在每条助手消息上记录当时的模型（会话中途可能切换）
                model: entry
                    .pointer("/message/model")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                timestamp,
                seq: *seq,
            });
        }

        Ok(messages)
    }

    fn extract_session_id(&self, file_path: &Path) -> Option<String> {
        // Pi 的 session ID 在文件内容中
        // 对于扫描快速过滤，通过读取首行提取
        let content = std::fs::read_to_string(file_path).ok()?;
        let first_line = content.lines().next()?;
        let trimmed = first_line.trim();
        if trimmed.is_empty() {
            return None;
        }
        let val: serde_json::Value = serde_json::from_str(trimmed).ok()?;
        val.get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }

    fn resume_command(&self, native_session_id: &str, _project_path: &str) -> Option<Vec<String>> {
        Some(vec!["--session".into(), native_session_id.into()])
    }

    /// Pi 无官方删除命令 ⇒ 删会话 jsonl 本身（默认 `delete_targets`）。
    ///
    /// **共享资产不删**：`~/.pi/agent/blobs/<sha>.png` 是内容寻址、跨会话共享的
    /// 图片存储，删它会让其它会话的图片一起消失，因此不在删除单元内。
    fn delete_support(&self) -> SessionDeleteSupport {
        SessionDeleteSupport::Storage
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation::types::MessageBlock;
    use tempfile::TempDir;

    const SESSION_ID: &str = "01a1876f-0cba-7518-a2bb-a1453b806c78";

    /// 真实 pi 会话格式（version 3）：`message.content` 恒为**块数组**
    /// （text / thinking / toolCall），工具结果作为独立的 `role: "toolResult"` 记录。
    fn create_pi_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let mut content = String::new();

        // session header（pi 从不写 name/title）
        content.push_str(
            r#"{"type":"session","version":3,"id":"01a1876f-0cba-7518-a2bb-a1453b806c78","timestamp":"2025-01-15T10:00:00Z","cwd":"/projects/test"}"#,
        );
        content.push('\n');

        // model_change / custom 行不承载消息
        content.push_str(
            r#"{"type":"model_change","id":"mc1","parentId":null,"timestamp":"2025-01-15T10:00:00.500Z","provider":"magpie","modelId":"workbuddy/deepseek-v4.1-flash"}"#,
        );
        content.push('\n');

        // message 1 (user) — text 块
        content.push_str(
            r#"{"type":"message","id":"msg1","parentId":null,"timestamp":"2025-01-15T10:00:01Z","message":{"role":"user","content":[{"type":"text","text":"How do I implement authentication?"},{"type":"image","data":"iVBORw0KGgo=","mimeType":"image/png"}]}}"#,
        );
        content.push('\n');

        // message 2 (assistant) — thinking + text + toolCall（arguments 是 JSON 字符串）
        content.push_str(
            r#"{"type":"message","id":"msg2","parentId":"msg1","timestamp":"2025-01-15T10:00:02Z","message":{"role":"assistant","model":"workbuddy/deepseek-v4.1-flash","content":[{"type":"thinking","thinking":"先确认认证中间件位置"},{"type":"text","text":"You should use JWT tokens. Here's a basic setup..."},{"type":"toolCall","id":"call_1","name":"bash","arguments":"{\"command\":\"ls src\"}"}]}}"#,
        );
        content.push('\n');

        // message 3 (toolResult) — 独立记录，不属于会话正文
        content.push_str(
            r#"{"type":"message","id":"msg3","parentId":"msg2","timestamp":"2025-01-15T10:00:03Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"bash","isError":false,"content":[{"type":"text","text":"action-menu/\nagent/"}]}}"#,
        );
        content.push('\n');

        // message 4 (user follow-up)
        content.push_str(
            r#"{"type":"message","id":"msg4","parentId":"msg3","timestamp":"2025-01-15T10:00:04Z","message":{"role":"user","content":[{"type":"text","text":"Can you show me the code?"}]}}"#,
        );
        content.push('\n');

        std::fs::write(&path, content).expect("Failed to write fixture");
        path
    }

    #[test]
    fn should_parse_meta() {
        let dir = TempDir::new().unwrap();
        let path = create_pi_fixture(&dir, "session-pi.jsonl");
        let adapter = PiAdapter;

        let meta = adapter.parse_meta(&path).unwrap();
        assert_eq!(meta.native_session_id, SESSION_ID);
        // 计数口径 = 正文视图能看到的对话消息（user/assistant），toolResult 不计
        assert_eq!(meta.message_count, 3);
        assert_eq!(meta.model.as_deref(), Some("workbuddy/deepseek-v4.1-flash"));
        assert_eq!(meta.project_path.as_deref(), Some("/projects/test"));
        // pi 不写标题，P2 恒为 None；P3 必须是首条用户消息的正文
        assert_eq!(meta.title, None);
        assert_eq!(
            meta.first_user_message.as_deref(),
            Some("How do I implement authentication?")
        );
    }

    /// 回归：标题不再退化成 `pi <session-id 前 8 位>`。
    #[test]
    fn should_resolve_readable_title_from_first_user_message() {
        let dir = TempDir::new().unwrap();
        let path = create_pi_fixture(&dir, "session-pi.jsonl");
        let adapter = PiAdapter;

        let meta = adapter.parse_meta(&path).unwrap();
        let title = crate::conversation::manager::resolve_title(
            meta.title.as_deref(),
            meta.first_user_message.as_deref(),
            adapter.agent_id(),
            &meta.native_session_id,
        );
        assert_eq!(title, "How do I implement authentication?");
    }

    /// 回归：首条用户消息只有图片引用时，P3 候选必须继续往下找。
    #[test]
    fn should_skip_image_only_turn_when_picking_title_candidate() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("session-image-first.jsonl");
        let content = [
            r#"{"type":"session","version":3,"id":"01a18800-0000-7000-8000-000000000001","timestamp":"2025-01-15T10:00:00Z","cwd":"/projects/test"}"#,
            r#"{"type":"message","id":"msg1","parentId":null,"timestamp":"2025-01-15T10:00:01Z","message":{"role":"user","content":[{"type":"text","text":"[Image #1]\n\n"},{"type":"image","data":"iVBORw0KGgo=","mimeType":"image/png"}]}}"#,
            r#"{"type":"message","id":"msg2","parentId":"msg1","timestamp":"2025-01-15T10:00:02Z","message":{"role":"user","content":[{"type":"text","text":"历史会话里显示的是 ID，不是标题"}]}}"#,
        ]
        .join("\n");
        // 尾行补换行：正在写入的半行会被 read_jsonl 跳过
        std::fs::write(&path, format!("{content}\n")).expect("Failed to write fixture");

        let meta = PiAdapter.parse_meta(&path).unwrap();
        assert_eq!(
            meta.first_user_message.as_deref(),
            Some("历史会话里显示的是 ID，不是标题")
        );
    }

    #[test]
    fn should_build_preview_from_user_and_assistant_turns_only() {
        let dir = TempDir::new().unwrap();
        let path = create_pi_fixture(&dir, "session-pi.jsonl");
        let adapter = PiAdapter;

        let meta = adapter.parse_meta(&path).unwrap();
        assert!(
            meta.recent_messages
                .iter()
                .any(|(_, t)| t.contains("authentication")),
            "preview must contain the user turn: {:?}",
            meta.recent_messages
        );
        assert!(
            meta.recent_messages
                .iter()
                .any(|(_, t)| t.contains("show me the code")),
            "preview must contain the follow-up turn: {:?}",
            meta.recent_messages
        );
        // 工具输出不参与预览（体量不可控，见红线 4）
        assert!(
            meta.recent_messages
                .iter()
                .all(|(_, t)| !t.contains("action-menu")),
            "tool results must stay out of the preview: {:?}",
            meta.recent_messages
        );
    }

    #[test]
    fn should_parse_messages() {
        let dir = TempDir::new().unwrap();
        let path = create_pi_fixture(&dir, "session-pi.jsonl");
        let adapter = PiAdapter;

        let messages = adapter.parse_messages(&path).unwrap();
        // toolResult 记录不进入正文视图（与 Claude Code 适配器一致）
        assert_eq!(messages.len(), 3);

        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "How do I implement authentication?");
        assert!(matches!(
            messages[0].blocks.as_slice(),
            [MessageBlock::Text { text }] if text == "How do I implement authentication?"
        ));

        assert_eq!(messages[1].role, "assistant");
        assert_eq!(
            messages[1].model.as_deref(),
            Some("workbuddy/deepseek-v4.1-flash")
        );
        assert_eq!(messages[0].model, None);
        assert!(messages[1].content.contains("You should use JWT tokens"));
        assert!(messages[1].content.contains("先确认认证中间件位置"));
        assert!(messages[1].content.contains("🔧 `bash`"));
        assert_eq!(messages[1].blocks.len(), 3);
        assert!(matches!(
            &messages[1].blocks[1],
            MessageBlock::Text { text } if text.contains("JWT tokens")
        ));
        assert!(matches!(
            &messages[1].blocks[2],
            MessageBlock::ToolUse { name, input, .. }
                if name == "bash" && input["command"] == "ls src"
        ));

        assert_eq!(messages[2].role, "user");
        assert_eq!(messages[2].content, "Can you show me the code?");
    }

    #[test]
    fn should_extract_session_id() {
        let dir = TempDir::new().unwrap();
        let path = create_pi_fixture(&dir, "session-pi.jsonl");

        let id = PiAdapter.extract_session_id(&path);
        assert_eq!(id, Some(SESSION_ID.to_string()));
    }

    /// 删除单元 = 会话 jsonl 本身，且真实 pi 路径形态（`sessions/--<sanitized-cwd>--/…`）
    /// 必须通过 `session_root` 的所有权判定 —— 那个 `--` 前缀目录是最容易被词法判定搞错的一层。
    ///
    /// 变异验证：把 `delete_support()` 改回默认 `Unsupported` → 第一条断言红。
    #[test]
    fn delete_unit_is_the_session_file_inside_the_session_root() {
        use crate::conversation::adapter::{is_owned_path, SessionDeleteSupport};

        let adapter = PiAdapter;
        assert_eq!(adapter.delete_support(), SessionDeleteSupport::Storage);

        let file = adapter
            .session_root()
            .join("--Users-tomgs-proj--")
            .join("2026-10-30T01-58-39-172Z_01a18a87-d144-7518-a2bb-a149376aec48.jsonl");
        assert_eq!(
            adapter.delete_targets(&file, "01a18a87"),
            vec![file.clone()]
        );
        assert!(is_owned_path(&file, &adapter.session_root()));
        // 共享 blob 目录**不在** sessions 之下，因此永远过不了所有权判定（不会被删）。
        let blob = adapter
            .session_root()
            .parent()
            .expect("sessions has a parent")
            .join("blobs")
            .join("abc.png");
        assert!(!is_owned_path(&blob, &adapter.session_root()));
    }

    #[test]
    fn should_return_resume_command() {
        let cmd = PiAdapter.resume_command("test-session-id", "/projects/test");
        assert_eq!(
            cmd,
            Some(vec!["--session".to_string(), "test-session-id".to_string()])
        );
    }

    #[test]
    fn should_handle_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.jsonl");
        std::fs::write(&path, "").expect("Failed to write");

        let result = PiAdapter.parse_meta(&path);
        assert!(result.is_err());
    }
}
