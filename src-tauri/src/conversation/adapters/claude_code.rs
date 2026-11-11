#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::common::agent::descriptor;
use crate::conversation::adapter::{
    AgentSessionAdapter, ParsedMessage, ParsedMeta, SessionDeleteSupport,
};
use crate::conversation::adapters::content_blocks::extract_message_content;
use crate::conversation::adapters::{parse_timestamp, read_jsonl};
use crate::conversation::normalize::is_harness_injected_user_turn;
use crate::conversation::normalize::recent_messages_from;
use crate::conversation::text::strip_ansi;

/// Claude Code 会话适配器
///
/// 会话格式：`~/.claude/projects/<sanitized-path>/*.jsonl`
/// - 首行 type="mode" 包含 sessionId
/// - 消息行 type="user" / type="assistant" / type="system"
/// - user 消息的 message 字段是字符串，assistant 的 message 是 object（含 content 数组）
/// - 不支持原生 CLI 恢复（仅 TUI 内的 /resume 命令）
pub struct ClaudeCodeAdapter;

fn is_message_type(t: &str) -> bool {
    t == "user" || t == "assistant" || t == "system"
}

impl AgentSessionAdapter for ClaudeCodeAdapter {
    fn agent_id(&self) -> &str {
        "claude-code"
    }

    fn session_root(&self) -> PathBuf {
        // 路径事实的唯一来源：`common::agent::descriptor`（同一行里也声明着 hook 配置根，
        // 两处无法互相漂移）。
        descriptor::transcript_root(self.agent_id())
    }

    fn discovery_roots(&self, project_path: Option<&str>) -> Option<Vec<std::path::PathBuf>> {
        crate::conversation::scope::discovery_roots_for(
            self.session_root(),
            project_path,
            crate::conversation::scope::EncodeStyle::Claude,
        )
    }

    fn file_pattern(&self) -> &str {
        descriptor::file_pattern(self.agent_id())
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        let entries = read_jsonl(file_path)?;
        if entries.is_empty() {
            anyhow::bail!("Claude Code session file is empty");
        }

        // 从 mode 行或 filename 获取原生 session_id
        let mode_entry = entries
            .iter()
            .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("mode"));

        let native_session_id = mode_entry
            .and_then(|e| e.get("sessionId").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .or_else(|| {
                file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "unknown".to_string());

        // 从首条有 message.model 的消息记录提取模型名（Claude CLI v2 格式）
        let model = entries
            .iter()
            .find(|e| {
                e.get("message")
                    .and_then(|m| m.get("model"))
                    .and_then(|v| v.as_str())
                    .is_some()
            })
            .and_then(|e| {
                e.get("message")
                    .and_then(|m| m.get("model").and_then(|v| v.as_str()))
            })
            .or_else(|| {
                // 回退：mode 记录顶层的 model 字段（旧格式）
                mode_entry.and_then(|e| e.get("model").and_then(|v| v.as_str()))
            })
            .map(|s| s.to_string());

        // 首条**真实** user 消息：harness 注入的伪用户回合（`<local-command-caveat>`、
        // `<command-name>`、`<system-reminder>`…）不是用户意图，跳过顺延到下一条。
        //
        // 为什么必须在这里过滤（而不是只在展示层）：这条记录同时喂 P3 标题与
        // `project_path`。注入行带着 CLI 自己的 `cwd`，把它当首条消息会让标题变成
        // 一串注入文本（真实索引里 161 条 claude 会话有 11 条长这样）。
        // 判负词表复用 `normalize::is_harness_injected_user_turn` —— 单一实现。
        let first_user_msg = entries.iter().find(|e| {
            e.get("type").and_then(|v| v.as_str()) == Some("user")
                && !is_harness_injected_user_turn(&extract_message_content(e).text)
        });

        // 标题优先级（对齐 orca primary-parsers.ts）：
        // P1: custom-title/customTitle（用户自定义）
        let custom_title = entries
            .iter()
            .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("custom-title"))
            .and_then(|e| e.get("customTitle").and_then(|v| v.as_str()))
            .map(|s| s.to_string());
        // P2: ai-title/aiTitle（AI 生成，更高优先级）或 summary/conversationTitle（旧格式）
        let ai_title = entries
            .iter()
            .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("ai-title"))
            .and_then(|e| e.get("aiTitle").and_then(|v| v.as_str()))
            .or_else(|| {
                entries
                    .iter()
                    .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("summary"))
                    .and_then(|e| {
                        e.get("conversationTitle")
                            .and_then(|v| v.as_str())
                            .or_else(|| e.get("title").and_then(|v| v.as_str()))
                    })
            })
            .map(|s| s.to_string());
        // P3: agent-name/agentName（会话上下文名称）
        let agent_name_title = entries
            .iter()
            .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("agent-name"))
            .and_then(|e| e.get("agentName").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        // P4 / 预览来源：首条 user 消息原文
        let first_user_raw = first_user_msg.map(|e| extract_message_content(e).text);

        let title = custom_title.or(ai_title).or(agent_name_title);

        let started_at = first_user_msg
            .and_then(|msg| msg.get("timestamp").and_then(parse_timestamp))
            .unwrap_or(0);

        let updated_at = entries
            .iter()
            .rev()
            .find(|e| {
                e.get("type")
                    .and_then(|v| v.as_str())
                    .is_some_and(is_message_type)
            })
            .and_then(|e| e.get("timestamp").and_then(parse_timestamp))
            .unwrap_or(started_at);

        // 最近消息缓冲（剔除 harness 注入噪声），供 manager 构建预览
        let recent_pairs: Vec<(String, String)> = entries
            .iter()
            .filter_map(|e| {
                let role = e.get("type").and_then(|v| v.as_str())?;
                if !matches!(role, "user" | "assistant" | "system") {
                    return None;
                }
                let text = extract_message_content(e).text;
                let t = text.trim().to_string();
                if t.is_empty() {
                    return None;
                }
                Some((role.to_string(), t))
            })
            .collect();
        // 计数口径 = 正文视图能看到的条数（与 parse_messages 同一过滤规则），
        // 否则 tool_result-only 的 user 记录会让徽标比正文多出几百条
        let message_count = u32::try_from(recent_pairs.len()).unwrap_or(u32::MAX);
        let recent_messages = recent_messages_from(recent_pairs);

        // project_path：优先从 user 消息的 cwd 字段获取（真实路径）
        let project_path = first_user_msg
            .and_then(|msg| msg.get("cwd").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .or_else(|| {
                // 回退：从父目录名反推（Claude Code 把 / 替换为 -）
                file_path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|s| s.to_str())
                    .map(crate::conversation::adapters::unsanitize_project_dir)
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

        let mut messages = Vec::new();
        let mut seq: u32 = 0;

        for entry in &entries {
            let entry_type = entry.get("type").and_then(|v| v.as_str()).unwrap_or("");

            if !is_message_type(entry_type) {
                continue;
            }

            let content = extract_message_content(entry);
            let cleaned = strip_ansi(&content.text);
            if cleaned.trim().is_empty() {
                continue;
            }

            // 结构化内容块（与正文同源，一次抽取得出）
            let blocks = content.blocks;

            // 提取消息级别的模型名称（Claude CLI v2 格式）
            let model = entry
                .get("message")
                .and_then(|m| m.get("model"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let timestamp = entry
                .get("timestamp")
                .and_then(parse_timestamp)
                .unwrap_or(0);

            messages.push(ParsedMessage {
                role: entry_type.to_string(),
                content: cleaned,
                blocks,
                model,
                timestamp,
                seq,
            });
            seq += 1;
        }

        Ok(messages)
    }

    fn extract_session_id(&self, file_path: &Path) -> Option<String> {
        file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    }

    fn resume_command(&self, native_session_id: &str, _project_path: &str) -> Option<Vec<String>> {
        Some(vec!["--resume".into(), native_session_id.into()])
    }

    /// `claude rm` 只删 background session、`claude purge` 是全清，都不匹配「删这一条」；
    /// 会话本身是 `~/.claude/projects/**/<uuid>.jsonl` 单文件 ⇒ adapter 删存储单元。
    fn delete_support(&self) -> SessionDeleteSupport {
        SessionDeleteSupport::Storage
    }
}

/// 反向 Claude Code 路径编码：`-Users-tomgs-proj` → `/Users/tomgs/proj`
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// 创建模拟新格式的 fixture（与真实 Claude Code 格式一致）
    fn create_real_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let mut content = String::new();

        // line 1: mode
        content.push_str(
            r#"{"type":"mode","mode":"normal","sessionId":"30314800-3c5e-49be-a72a-75100ee499dd"}"#,
        );
        content.push('\n');

        // line 2: system
        content.push_str(
            r#"{"type":"system","uuid":"sys1","parentUuid":"root","timestamp":"2025-01-15T09:59:00Z","message":"<system>The project is a Tauri app. Use TypeScript.</system>"}"#,
        );
        content.push('\n');

        // line 3: user (message 是字符串 — 新格式)
        content.push_str(
            r#"{"type":"user","uuid":"msg1","parentUuid":"root","timestamp":"2025-01-15T10:00:01Z","message":"Can you help me fix the auth middleware?","cwd":"/Users/tomgs/rust-project"}"#,
        );
        content.push('\n');

        // line 4: assistant (message 是 object + content 数组)
        content.push_str(
            r#"{"type":"assistant","uuid":"msg2","parentUuid":"msg1","timestamp":"2025-01-15T10:00:02Z","message":{"id":"r1","type":"message","role":"assistant","content":[{"type":"text","text":"Sure! Let me look at the auth module."}]}}"#,
        );
        content.push('\n');

        // line 5: user reply
        content.push_str(
            r#"{"type":"user","uuid":"msg3","parentUuid":"msg2","timestamp":"2025-01-15T10:00:03Z","message":"It's in src/auth/middleware.ts","cwd":"/Users/tomgs/rust-project"}"#,
        );
        content.push('\n');

        std::fs::write(&path, content).expect("Failed to write fixture");
        path
    }

    /// 创建模拟 ai-title 格式的 fixture
    fn create_ai_title_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let mut content = String::new();
        content.push_str(
            r#"{"type":"ai-title","aiTitle":"Fix auth middleware","createdAt":"2025-01-15T10:00:00Z"}"#,
        );
        content.push('\n');
        content.push_str(
            r#"{"type":"user","uuid":"msg1","parentUuid":"root","timestamp":"2025-01-15T10:00:01Z","message": "Can you help me fix the auth middleware?"}"#,
        );
        content.push('\n');
        content.push_str(
            r#"{"type":"assistant","uuid":"msg2","parentUuid":"msg1","timestamp":"2025-01-15T10:00:02Z","message":{"content":[{"type":"text","text":"Sure!"}]}}"#,
        );
        content.push('\n');
        std::fs::write(&path, content).expect("Failed to write fixture");
        path
    }

    /// 创建模拟旧格式的 fixture（message 字段为 object + content 数组格式）
    fn create_legacy_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let mut content = String::new();
        content.push_str(
            r#"{"type":"summary","conversationTitle":"Fix auth middleware","createdAt":"2025-01-15T10:00:00Z"}"#,
        );
        content.push('\n');
        content.push_str(
            r#"{"type":"user","uuid":"msg1","parentUuid":"root","timestamp":"2025-01-15T10:00:01Z","message":{"content":[{"type":"text","text":"Can you help?"}]}}"#,
        );
        content.push('\n');
        content.push_str(
            r#"{"type":"assistant","uuid":"msg2","parentUuid":"msg1","timestamp":"2025-01-15T10:00:02Z","message":{"content":[{"type":"text","text":"Sure!"}]}}"#,
        );
        content.push('\n');
        std::fs::write(&path, content).expect("Failed to write fixture");
        path
    }

    #[test]
    fn should_parse_meta_real_format() {
        let dir = TempDir::new().unwrap();
        let path = create_real_fixture(&dir, "session-real.jsonl");
        let meta = ClaudeCodeAdapter.parse_meta(&path).unwrap();
        assert_eq!(
            meta.native_session_id,
            "30314800-3c5e-49be-a72a-75100ee499dd"
        );
        assert_eq!(meta.message_count, 4); // system + user + assistant + user
        assert!(meta
            .recent_messages
            .iter()
            .any(|(_, t)| t.contains("auth middleware")));
        assert_eq!(
            meta.project_path.as_deref(),
            Some("/Users/tomgs/rust-project")
        );
    }

    #[test]
    fn should_parse_messages_real_format() {
        let dir = TempDir::new().unwrap();
        let path = create_real_fixture(&dir, "session-msgs.jsonl");
        let messages = ClaudeCodeAdapter.parse_messages(&path).unwrap();
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[1].role, "user");
        assert_eq!(
            messages[1].content,
            "Can you help me fix the auth middleware?"
        );
        assert_eq!(messages[2].role, "assistant");
        assert_eq!(messages[2].content, "Sure! Let me look at the auth module.");
        assert_eq!(messages[3].role, "user");
        assert_eq!(messages[3].content, "It's in src/auth/middleware.ts");
    }

    #[test]
    fn should_parse_meta_legacy_format() {
        let dir = TempDir::new().unwrap();
        let path = create_legacy_fixture(&dir, "session-legacy.jsonl");
        let meta = ClaudeCodeAdapter.parse_meta(&path).unwrap();
        assert_eq!(meta.title.as_deref(), Some("Fix auth middleware"));
        assert_eq!(meta.message_count, 2);
        assert!(meta
            .recent_messages
            .iter()
            .any(|(_, t)| t.contains("Can you help?")));
    }

    #[test]
    fn should_parse_messages_legacy_format() {
        let dir = TempDir::new().unwrap();
        let path = create_legacy_fixture(&dir, "session-legacy-msgs.jsonl");
        let messages = ClaudeCodeAdapter.parse_messages(&path).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "Can you help?");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].content, "Sure!");
    }

    #[test]
    fn should_parse_meta_ai_title_format() {
        let dir = TempDir::new().unwrap();
        let path = create_ai_title_fixture(&dir, "session-ai-title.jsonl");
        let meta = ClaudeCodeAdapter.parse_meta(&path).unwrap();
        assert_eq!(meta.title.as_deref(), Some("Fix auth middleware"));
        assert_eq!(meta.message_count, 2);
    }

    #[test]
    fn should_extract_model_from_message() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("session-model.jsonl");
        let mut content = String::new();
        content.push_str(r#"{"type":"mode","sessionId":"test-model-001"}"#);
        content.push('\n');
        content.push_str(
            r#"{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","message":"Hello","cwd":"/tmp"}"#,
        );
        content.push('\n');
        content.push_str(
            r#"{"type":"assistant","uuid":"a1","timestamp":"2026-01-01T00:00:01Z","message":{"id":"r1","type":"message","role":"assistant","model":"deepseek-v4-pro","content":[{"type":"text","text":"Hi!"}]}}"#,
        );
        content.push('\n');
        std::fs::write(&path, content).expect("Failed to write");
        let meta = ClaudeCodeAdapter.parse_meta(&path).unwrap();
        assert_eq!(meta.model.as_deref(), Some("deepseek-v4-pro"));
    }

    #[test]
    fn should_extract_model_from_user_message() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("session-model-user.jsonl");
        let mut content = String::new();
        content.push_str(r#"{"type":"mode","sessionId":"test-model-002"}"#);
        content.push('\n');
        content.push_str(
            r#"{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","message":{"id":"r1","type":"message","role":"user","model":"claude-sonnet-4-20250514","content":[{"type":"text","text":"Hello"}]},"cwd":"/tmp"}"#,
        );
        content.push('\n');
        std::fs::write(&path, content).expect("Failed to write");
        let meta = ClaudeCodeAdapter.parse_meta(&path).unwrap();
        assert_eq!(meta.model.as_deref(), Some("claude-sonnet-4-20250514"));
    }

    #[test]
    fn should_not_extract_model_when_missing() {
        let dir = TempDir::new().unwrap();
        let path = create_real_fixture(&dir, "session-no-model.jsonl");
        let meta = ClaudeCodeAdapter.parse_meta(&path).unwrap();
        assert!(meta.model.is_none());
    }

    #[test]
    fn should_resume_command_return_args() {
        let cmd = ClaudeCodeAdapter.resume_command("test-id", "/projects/test");
        assert!(cmd.is_some());
        let args = cmd.unwrap();
        assert_eq!(args, vec!["--resume", "test-id"]);
    }

    #[test]
    fn should_handle_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.jsonl");
        std::fs::write(&path, "").expect("Failed to write");
        let result = ClaudeCodeAdapter.parse_meta(&path);
        assert!(result.is_err());
    }

    #[test]
    fn should_unsanitize_the_project_dir() {
        assert_eq!(
            crate::conversation::adapters::unsanitize_project_dir(
                "-Users-tomgs-RustroverProjects-neeko"
            ),
            "/Users/tomgs/RustroverProjects/neeko"
        );
        assert_eq!(
            crate::conversation::adapters::unsanitize_project_dir("simple-path"),
            "/simple/path"
        );
    }
}
