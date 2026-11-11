use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::common::agent::descriptor;
use crate::conversation::adapter::{
    AgentSessionAdapter, ParsedMessage, ParsedMeta, SessionDeleteSupport,
};
use crate::conversation::adapters::{parse_timestamp, read_jsonl, unsanitize_project_dir};
use crate::conversation::normalize::{is_harness_injected_user_turn, recent_messages_from};
use crate::conversation::text::strip_ansi;

/// CodeBuddy 会话适配器。
///
/// 会话格式：`~/.codebuddy/projects/<sanitized-cwd>/<uuid>.jsonl`（单文件可达 10MB+），
/// 行形态（2026-11-10 实测）：
///
/// ```text
/// {"type":"message","role":"user","content":[{"type":"input_text","text":"…"}],"timestamp":1791696153382}
/// {"type":"ai-title","aiTitle":"Fix CI clippy warnings","sessionId":"…"}
/// {"type":"reasoning"|"function_call"|"function_call_result"|"session-meta"|…}
/// ```
///
/// **与前版实现的差异**（前版读 `~/.codebuddy/sessions/*.json` 的 `{messages:[…]}` 形态，
/// 在本机扫到 0 条 / 仅 2 条兜底标题）：CodeBuddy 是 Claude Code 的 fork，但**不共用行形态** ——
/// `role` / `content` 在顶层，没有 `message` 包装，因此不能直接复用 Claude 解析器；
/// 内容块仍走同一张方言表（`content_blocks`，`input_text` 已在其中）。
///
/// 支持原生恢复：`codebuddy --resume <SESSION_ID>`。删除按存储单元（单个 jsonl）。
pub struct CodeBuddyAdapter;

impl AgentSessionAdapter for CodeBuddyAdapter {
    fn agent_id(&self) -> &str {
        "codebuddy"
    }

    fn session_root(&self) -> PathBuf {
        // 路径事实的唯一来源：`common::agent::descriptor`（同一行里也声明着 hook 配置根，
        // 两处无法互相漂移）。
        descriptor::transcript_root(self.agent_id())
    }

    fn file_pattern(&self) -> &str {
        descriptor::file_pattern(self.agent_id())
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        let entries = read_jsonl(file_path)?;
        anyhow::ensure!(!entries.is_empty(), "CodeBuddy session file is empty");

        // 会话 id：`sessionId` 字段（ai-title / session-meta 行都带）优先，
        // 退化为文件名（`<uuid>.jsonl`）。
        let native_session_id = entries
            .iter()
            .find_map(|e| e.get("sessionId").and_then(|v| v.as_str()))
            .map(str::to_string)
            .or_else(|| {
                file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "unknown".to_string());

        // 标题：CLI 自己的 AI 标题 > summary 行 > 首条真实 user 消息（阶梯在 manager 侧）。
        let title = entries
            .iter()
            .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("ai-title"))
            .and_then(|e| e.get("aiTitle").and_then(|v| v.as_str()))
            .or_else(|| {
                entries
                    .iter()
                    .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("summary"))
                    .and_then(|e| {
                        e.get("summary")
                            .or_else(|| e.get("title"))
                            .and_then(|v| v.as_str())
                    })
            })
            .map(str::to_string);

        // 首条真实用户发言：harness 注入的伪回合顺延（与 Claude / Qoder 同一条规则）。
        // 顺序就是成本：先按 role 过滤（零分配），只对用户行抽取文本，且每行只抽一次
        // （`entry_text` 会把 content 重新包一层再解块 —— 10MB 转录上不能对每行都做）。
        let first_user_raw = entries
            .iter()
            .filter(|e| is_user_turn(e))
            .map(entry_text)
            .find(|text| !text.is_empty() && !is_harness_injected_user_turn(text));

        let timestamps: Vec<i64> = entries
            .iter()
            .filter(|e| e.get("type").and_then(|v| v.as_str()) == Some("message"))
            .filter_map(|e| e.get("timestamp").and_then(parse_timestamp))
            .collect();
        let started_at = timestamps.first().copied().unwrap_or(0);
        let updated_at = timestamps.last().copied().unwrap_or(started_at);

        // 计数与正文同源：同一条过滤规则（角色白名单 + 有可见文本）。
        let recent_pairs: Vec<(String, String)> = entries
            .iter()
            .filter(|e| e.get("type").and_then(|v| v.as_str()) == Some("message"))
            .filter_map(|e| {
                let role = e.get("role").and_then(|v| v.as_str())?.to_string();
                if !crate::conversation::adapters::CONVERSATION_ROLES.contains(&role.as_str()) {
                    return None;
                }
                let text = strip_ansi(&entry_text(e)).trim().to_string();
                (!text.is_empty()).then_some((role, text))
            })
            .collect();
        let message_count = u32::try_from(recent_pairs.len()).unwrap_or(u32::MAX);
        let recent_messages = recent_messages_from(recent_pairs);

        // 项目路径：行内 `cwd`（真实路径），退化为父目录名反解。
        let project_path = entries
            .iter()
            .find_map(|e| e.get("cwd").and_then(|v| v.as_str()))
            .map(str::to_string)
            .or_else(|| {
                file_path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|s| s.to_str())
                    .map(unsanitize_project_dir)
            });

        let model = entries.iter().find_map(|e| {
            e.get("providerData")
                .and_then(|p| p.get("model"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
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
            if entry.get("type").and_then(|v| v.as_str()) != Some("message") {
                continue;
            }
            let Some(role) = entry.get("role").and_then(|v| v.as_str()) else {
                continue;
            };
            if !crate::conversation::adapters::CONVERSATION_ROLES.contains(&role) {
                continue;
            }
            let cleaned = strip_ansi(&entry_text(entry));
            if cleaned.trim().is_empty() {
                continue;
            }
            messages.push(ParsedMessage {
                role: role.to_string(),
                blocks: entry_blocks(entry),
                content: cleaned,
                model: None,
                timestamp: entry
                    .get("timestamp")
                    .and_then(parse_timestamp)
                    .unwrap_or(0),
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
            .map(str::to_string)
    }

    fn resume_command(&self, native_session_id: &str, _project_path: &str) -> Option<Vec<String>> {
        Some(vec!["--resume".into(), native_session_id.into()])
    }

    fn delete_support(&self) -> SessionDeleteSupport {
        SessionDeleteSupport::Storage
    }
}

/// 一条 `message` 行是否用户发言（CodeBuddy 的 role 在顶层）。
fn is_user_turn(entry: &serde_json::Value) -> bool {
    entry.get("type").and_then(|v| v.as_str()) == Some("message")
        && entry.get("role").and_then(|v| v.as_str()) == Some("user")
}

/// 取一条记录的纯文本。CodeBuddy 的 content 在顶层（数组或字符串），
/// 与 Anthropic 方言的区别只是**少一层 `message` 包装** —— 所以这里把记录喂给同一张
/// 块方言表（`content_blocks` 认 `input_text` / `output_text` / `text`）。
fn entry_text(entry: &serde_json::Value) -> String {
    let wrapped = match entry.get("content") {
        Some(content) => serde_json::json!({ "message": { "content": content } }),
        None => return String::new(),
    };
    crate::conversation::adapters::content_blocks::extract_message_content(&wrapped).text
}

/// 结构化块（前端按块渲染）：同样的包装技巧，避免复制一份块映射。
fn entry_blocks(entry: &serde_json::Value) -> Vec<crate::conversation::types::MessageBlock> {
    let wrapped = match entry.get("content") {
        Some(content) => serde_json::json!({ "message": { "content": content } }),
        None => return Vec::new(),
    };
    crate::conversation::adapters::content_blocks::extract_message_content(&wrapped).blocks
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// 与真实 CodeBuddy 落盘同形（2026-11-10 取自
    /// `~/.codebuddy/projects/<proj>/<uuid>.jsonl`）。
    fn create_codebuddy_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let content = concat!(
            r#"{"id":"01a1","timestamp":1791696153382,"type":"message","role":"user","content":[{"type":"input_text","text":"跑一下 CI 的 clippy，Linux 和 Windows 都红了"}]}"#,
            "\n",
            r#"{"id":"01a2","timestamp":1791696155029,"type":"ai-title","aiTitle":"Fix CI clippy warnings on Linux and Windows","sessionId":"01a12968-a199-7876-a422-120e1a891699","cwd":"/Users/tomgs/RustroverProjects/neeko"}"#,
            "\n",
            r#"{"id":"01a3","parentId":"01a1","timestamp":1791696156147,"type":"reasoning","providerData":{"model":"deepseek-v4.1-flash","agent":"cli"},"content":[]}"#,
            "\n",
            r#"{"id":"01a4","timestamp":1791696156220,"type":"function_call_result","name":"Read","callId":"c1","output":{"type":"text","text":"…文件内容…"}}"#,
            "\n",
            r#"{"id":"01a5","timestamp":1791696159000,"type":"message","role":"assistant","content":[{"type":"output_text","text":"我把 unused variable 的警告修掉了"}]}"#,
            "\n",
        );
        std::fs::write(&path, content).expect("Failed to write fixture");
        path
    }

    #[test]
    fn should_read_the_real_codebuddy_layout() {
        let root = CodeBuddyAdapter.session_root();
        assert!(
            root.ends_with(".codebuddy/projects"),
            "CodeBuddy 实际写在 <config>/projects/<sanitized>/<uuid>.jsonl：{root:?}"
        );
        assert_eq!(CodeBuddyAdapter.file_pattern(), "**/*.jsonl");
    }

    #[test]
    fn should_parse_meta_with_the_ai_title() {
        let dir = TempDir::new().unwrap();
        let path = create_codebuddy_fixture(&dir, "01a12968-a199-7876-a422-120e1a891699.jsonl");
        let meta = CodeBuddyAdapter.parse_meta(&path).unwrap();

        assert_eq!(
            meta.native_session_id,
            "01a12968-a199-7876-a422-120e1a891699"
        );
        assert_eq!(
            meta.title.as_deref(),
            Some("Fix CI clippy warnings on Linux and Windows")
        );
        assert_eq!(meta.message_count, 2, "只有 message 行算回合");
        assert_eq!(meta.started_at, 1_791_696_153_382);
        assert_eq!(
            meta.project_path.as_deref(),
            Some("/Users/tomgs/RustroverProjects/neeko")
        );
    }

    #[test]
    fn should_parse_messages_and_skip_tool_rows() {
        let dir = TempDir::new().unwrap();
        let path = create_codebuddy_fixture(&dir, "s.jsonl");
        let messages = CodeBuddyAdapter.parse_messages(&path).unwrap();

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert!(messages[0].content.contains("clippy"));
        assert_eq!(messages[1].role, "assistant");
        assert!(messages[1].content.contains("unused variable"));
    }

    /// 计数与正文必须同源（`message_count == parse_messages().len()`，spec §4.6.3）。
    #[test]
    fn message_count_matches_the_transcript() {
        let dir = TempDir::new().unwrap();
        let path = create_codebuddy_fixture(&dir, "s.jsonl");
        let meta = CodeBuddyAdapter.parse_meta(&path).unwrap();
        let messages = CodeBuddyAdapter.parse_messages(&path).unwrap();
        assert_eq!(meta.message_count, u32::try_from(messages.len()).unwrap());
    }

    #[test]
    fn should_resume_with_the_native_id() {
        assert_eq!(
            CodeBuddyAdapter.resume_command("abc", "/proj"),
            Some(vec!["--resume".to_string(), "abc".to_string()])
        );
    }

    #[test]
    fn should_reject_an_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.jsonl");
        std::fs::write(&path, "").unwrap();
        assert!(CodeBuddyAdapter.parse_meta(&path).is_err());
    }
}
