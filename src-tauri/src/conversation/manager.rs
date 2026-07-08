use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::{Context, Result};
use chrono::DateTime;
use regex::Regex;
use walkdir::WalkDir;

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage};
use crate::conversation::types::{ConversationMessage, ConversationMeta, ScanReport};

/// 内存缓存 + 扫描编排
///
/// 职责：
/// - 持有所有 AgentSessionAdapter 实例
/// - 扫描 Agent 原生会话文件，提取元数据存入内存缓存
/// - 提供查询、搜索、消息查看、恢复上下文构建、Markdown 导出等功能
pub struct ConversationManager {
    adapters: HashMap<String, Box<dyn AgentSessionAdapter>>,
    cache: Mutex<HashMap<String, ConversationMeta>>,
}

impl ConversationManager {
    /// 创建 ConversationManager，注入适配器列表
    pub fn new(adapters: Vec<Box<dyn AgentSessionAdapter>>) -> Self {
        let mut adapter_map = HashMap::new();
        for adapter in adapters {
            adapter_map.insert(adapter.agent_id().to_string(), adapter);
        }
        Self {
            adapters: adapter_map,
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// 扫描所有已注册 Agent 的会话文件，更新内存缓存
    pub fn scan_all(&self) -> Result<Vec<ScanReport>> {
        let mut reports = Vec::new();
        for (agent_id, adapter) in &self.adapters {
            let report = self.scan_agent_inner(agent_id, adapter.as_ref())?;
            reports.push(report);
        }
        Ok(reports)
    }

    /// 扫描指定 Agent 的会话文件，更新内存缓存
    pub fn scan_agent(&self, agent_id: &str) -> Result<ScanReport> {
        let adapter = self
            .adapters
            .get(agent_id)
            .with_context(|| format!("Adapter not found for agent: {agent_id}"))?;
        self.scan_agent_inner(agent_id, adapter.as_ref())
    }

    fn scan_agent_inner(
        &self,
        agent_id: &str,
        adapter: &dyn AgentSessionAdapter,
    ) -> Result<ScanReport> {
        let root = adapter.session_root();
        if !root.exists() {
            return Ok(ScanReport {
                agent_id: agent_id.to_string(),
                sessions_found: 0,
                errors: Vec::new(),
            });
        }

        let pattern_regex = pattern_to_regex(adapter.file_pattern());

        let mut sessions_found: u32 = 0;
        let mut errors: Vec<String> = Vec::new();

        for entry in WalkDir::new(&root)
            .min_depth(1)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            // 使用相对于 session_root 的路径匹配 pattern（支持 **/*.jsonl 等）
            let rel_path = match path.strip_prefix(&root) {
                Ok(rp) => rp,
                Err(_) => continue,
            };
            let rel_str = rel_path.to_string_lossy();

            if !pattern_regex.is_match(&rel_str) {
                continue;
            }

            match adapter.parse_meta(path) {
                Ok(meta) => {
                    let native_session_id = meta.native_session_id;
                    let id = format!("{agent_id}:{native_session_id}");

                    let conversation = ConversationMeta {
                        id,
                        native_session_id,
                        agent_id: agent_id.to_string(),
                        title: meta.title.unwrap_or_else(|| "Untitled".to_string()),
                        started_at: meta.started_at,
                        updated_at: meta.updated_at,
                        message_count: meta.message_count,
                        preview: meta.preview,
                        file_path: path.to_path_buf(),
                        project_path: meta.project_path,
                        user_title: None,
                        tags: Vec::new(),
                    };

                    let mut cache = self
                        .cache
                        .lock()
                        .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;
                    cache.insert(conversation.id.clone(), conversation);
                    sessions_found += 1;
                }
                Err(e) => {
                    errors.push(format!("Failed to parse {}: {e}", path.display()));
                }
            }
        }

        Ok(ScanReport {
            agent_id: agent_id.to_string(),
            sessions_found,
            errors,
        })
    }

    /// 列出缓存的会话
    ///
    /// - `project_path`: 按项目路径精确过滤（为 None 时不过滤）
    /// - `agent_id`: 按 agent 过滤（为 None 时不过滤）
    /// - 结果按 started_at 倒序排列
    pub fn list(
        &self,
        project_path: Option<&str>,
        agent_id: Option<&str>,
    ) -> Result<Vec<ConversationMeta>> {
        let cache = self
            .cache
            .lock()
            .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;

        let mut results: Vec<ConversationMeta> = cache
            .values()
            .filter(|m| {
                // 项目路径过滤：会话的 project_path 以给定路径开头（子路径匹配）
                // 无 project_path 的会话也纳入（agent 可能未记录 project_path）
                let matches_project = match project_path {
                    Some(pp) => m
                        .project_path
                        .as_deref()
                        .is_none_or(|p| p.starts_with(pp)),
                    None => true,
                };
                let matches_agent = match agent_id {
                    Some(aid) => m.agent_id == aid,
                    None => true,
                };
                matches_project && matches_agent
            })
            .cloned()
            .collect();

        results.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(results)
    }

    /// 获取会话的完整消息列表
    pub fn get_messages(&self, conversation_id: &str) -> Result<Vec<ConversationMessage>> {
        let (agent_id, _native_id) =
            parse_conversation_id(conversation_id).context("Invalid conversation ID format")?;

        let adapter = self
            .adapters
            .get(agent_id)
            .with_context(|| format!("Adapter not found for agent: {agent_id}"))?;

        let file_path = {
            let cache = self
                .cache
                .lock()
                .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;
            cache
                .get(conversation_id)
                .map(|m| m.file_path.clone())
                .context("Conversation not found in cache")?
        };

        let parsed: Vec<ParsedMessage> = adapter.parse_messages(&file_path)?;
        Ok(parsed
            .into_iter()
            .map(|p| ConversationMessage {
                role: p.role,
                content: p.content,
                timestamp: p.timestamp,
                seq: p.seq,
            })
            .collect())
    }

    /// 更新会话元数据（仅内存）
    pub fn update_meta(
        &self,
        id: &str,
        user_title: Option<String>,
        tags: Option<Vec<String>>,
    ) -> Result<()> {
        let mut cache = self
            .cache
            .lock()
            .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;
        let meta = cache.get_mut(id).context("Conversation not found")?;
        if let Some(title) = user_title {
            meta.user_title = Some(title);
        }
        if let Some(t) = tags {
            meta.tags = t;
        }
        Ok(())
    }

    /// 搜索会话
    ///
    /// - `query`: 搜索关键词，为空时返回空列表
    /// - `project_path`: 按项目路径过滤
    /// - 匹配字段：title（含 user_title）和 preview
    pub fn search(
        &self,
        query: &str,
        project_path: Option<&str>,
    ) -> Result<Vec<ConversationMeta>> {
        if query.is_empty() {
            return Ok(Vec::new());
        }

        let cache = self
            .cache
            .lock()
            .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;

        let query_lower = query.to_lowercase();
        let mut results: Vec<ConversationMeta> = cache
            .values()
            .filter(|m| {
                // project_path 子路径匹配
                if let Some(pp) = project_path {
                    if m.project_path
                        .as_deref()
                        .is_some_and(|p| !p.starts_with(pp))
                    {
                        return false;
                    }
                }
                // 模糊匹配：title（含 user_title）和 preview
                let title = m.user_title.as_deref().unwrap_or(&m.title);
                title.to_lowercase().contains(&query_lower)
                    || m.preview.to_lowercase().contains(&query_lower)
            })
            .cloned()
            .collect();

        results.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(results)
    }

    /// 获取会话的原生恢复命令
    ///
    /// 调用对应 adapter 的 resume_command。仅当 adapter 支持原生恢复时返回 Some。
    pub fn get_resume_command(&self, conversation_id: &str) -> Result<Option<Vec<String>>> {
        let (agent_id, _native_id) =
            parse_conversation_id(conversation_id).context("Invalid conversation ID format")?;

        let adapter = self
            .adapters
            .get(agent_id)
            .with_context(|| format!("Adapter not found for agent: {agent_id}"))?;

        let (native_session_id, project_path) = {
            let cache = self
                .cache
                .lock()
                .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;
            let meta = cache
                .get(conversation_id)
                .context("Conversation not found in cache")?;
            (meta.native_session_id.clone(), meta.project_path.clone())
        };

        match project_path {
            Some(pp) => Ok(adapter.resume_command(&native_session_id, &pp)),
            None => Ok(None),
        }
    }

    /// 构建恢复上下文字符串
    ///
    /// 从最近 max_messages 条消息构建，用于不支持原生恢复的 Agent 的兜底方案。
    pub fn build_resume_context(&self, conversation_id: &str, max_messages: u32) -> Result<String> {
        let messages = self.get_messages(conversation_id)?;
        // 取最后 max_messages 条消息（按 seq 正序排列）
        let window: Vec<&ConversationMessage> = messages
            .iter()
            .rev()
            .take(max_messages as usize)
            .collect::<Vec<_>>();
        let window: Vec<&ConversationMessage> = window.into_iter().rev().collect();

        let mut context = String::from(
            "Below is the previous conversation. \
             Please continue based on this context:\n\n---\n",
        );
        for msg in &window {
            let role_upper = msg.role.to_uppercase();
            context.push_str(&format!("[{}]: {}\n", role_upper, msg.content));
        }
        context.push_str("---\n\nContinue:");
        Ok(context)
    }

    /// 导出会话为 Markdown 格式
    pub fn export_markdown(&self, conversation_id: &str) -> Result<String> {
        let meta = {
            let cache = self
                .cache
                .lock()
                .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;
            cache
                .get(conversation_id)
                .cloned()
                .context("Conversation not found")?
        };
        let messages = self.get_messages(conversation_id)?;

        let title = meta.user_title.as_deref().unwrap_or(&meta.title);
        let mut md = format!("# {}\n\n", title);
        md.push_str(&format!("- **Agent**: {}\n", meta.agent_id));
        md.push_str(&format!("- **Started**: {}\n", format_timestamp(meta.started_at)));
        md.push_str(&format!("- **Messages**: {}\n\n---\n\n", meta.message_count));

        for msg in &messages {
            let timestamp = format_timestamp(msg.timestamp);
            md.push_str(&format!("### {} ({})\n\n", msg.role, timestamp));
            md.push_str(&format!("{}\n\n", msg.content));
        }

        Ok(md)
    }
}

/// 解析会话 ID 为 (agent_id, native_session_id)
fn parse_conversation_id(id: &str) -> Option<(&str, &str)> {
    let colon_pos = id.find(':')?;
    Some((&id[..colon_pos], &id[colon_pos + 1..]))
}

/// 将简单的 glob 模式（如 `*.jsonl`、`**/*.json`）转换为正则表达式
fn pattern_to_regex(pattern: &str) -> Regex {
    let mut regex_str = String::new();
    let chars: Vec<char> = pattern.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '*' => {
                // `**` = globstar: 匹配任意深度
                if i + 1 < chars.len() && chars[i + 1] == '*' {
                    regex_str.push_str(".*");
                    i += 1; // skip second *
                } else {
                    // `*` = 匹配单层文件名（不含 /）
                    regex_str.push_str("[^/]*");
                }
            }
            '?' => regex_str.push_str("[^/]"),
            '.' => regex_str.push_str("\\."),
            c if c.is_ascii_alphanumeric() || c == '/' || c == '-' || c == '_' => {
                regex_str.push(c);
            }
            c => {
                // 转义其他特殊字符
                regex_str.push_str(&regex::escape(&c.to_string()));
            }
        }
        i += 1;
    }
    Regex::new(&format!("^{regex_str}$")).unwrap_or_else(|_| {
        Regex::new(".*").expect("infallible: .* is always a valid regex")
    })
}

/// 格式化 Unix 时间戳为可读字符串
///
/// 自动检测毫秒/秒精度。
fn format_timestamp(ts: i64) -> String {
    let secs = if ts > 1_000_000_000_000 {
        ts / 1000
    } else {
        ts
    };
    match DateTime::from_timestamp(secs, 0) {
        Some(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        None => "Unknown".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation::adapter::{ParsedMeta, ParsedMessage};
    use std::path::{Path, PathBuf};
    use tempfile::TempDir;

    /// 用于测试的内存适配器，从 JSONL fixture 文件中读取数据
    struct TestAdapter {
        agent_id: String,
        root: PathBuf,
        file_pattern: String,
    }

    impl TestAdapter {
        fn new(agent_id: &str, root: PathBuf) -> Self {
            Self {
                agent_id: agent_id.to_string(),
                root,
                file_pattern: "*.jsonl".to_string(),
            }
        }

        fn read_jsonl_entries(&self, path: &Path) -> Result<Vec<serde_json::Value>> {
            let content = std::fs::read_to_string(path)?;
            let mut entries = Vec::new();
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let value: serde_json::Value =
                    serde_json::from_str(trimmed).context("Failed to parse JSONL line")?;
                entries.push(value);
            }
            Ok(entries)
        }
    }

    impl AgentSessionAdapter for TestAdapter {
        fn agent_id(&self) -> &str {
            &self.agent_id
        }

        fn session_root(&self) -> PathBuf {
            self.root.clone()
        }

        fn file_pattern(&self) -> &str {
            &self.file_pattern
        }

        fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
            let entries = self.read_jsonl_entries(file_path)?;
            let first = entries.first().context("Empty file")?;

            let native_session_id = file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();

            let title = first
                .get("content")
                .and_then(|c| c.as_str())
                .map(|s| {
                    let truncated: String = s.chars().take(80).collect();
                    truncated
                });

            let started_at = first
                .get("timestamp")
                .and_then(|t| t.as_i64())
                .unwrap_or(0);

            let updated_at = entries
                .last()
                .and_then(|e| e.get("timestamp"))
                .and_then(|t| t.as_i64())
                .unwrap_or(started_at);

            let message_count = entries.len() as u32;

            let preview = first
                .get("content")
                .and_then(|c| c.as_str())
                .map(|s| {
                    let truncated: String = s.chars().take(200).collect();
                    truncated
                })
                .unwrap_or_default();

            let project_path = first
                .get("project_path")
                .and_then(|p| p.as_str())
                .map(|s| s.to_string());

            Ok(ParsedMeta {
                native_session_id,
                title,
                started_at,
                updated_at,
                message_count,
                preview,
                project_path,
            })
        }

        fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
            let entries = self.read_jsonl_entries(file_path)?;
            let mut messages = Vec::new();
            for (seq, entry) in entries.iter().enumerate() {
                let role = entry
                    .get("role")
                    .and_then(|r| r.as_str())
                    .unwrap_or("user")
                    .to_string();
                let content = entry
                    .get("content")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();
                let timestamp = entry
                    .get("timestamp")
                    .and_then(|t| t.as_i64())
                    .unwrap_or(0);
                let seq_value = entry
                    .get("seq")
                    .and_then(|s| s.as_u64())
                    .unwrap_or(seq as u64) as u32;
                messages.push(ParsedMessage {
                    role,
                    content,
                    timestamp,
                    seq: seq_value,
                });
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
            Some(vec![
                "test-agent".to_string(),
                "resume".to_string(),
                native_session_id.to_string(),
            ])
        }
    }

    fn create_fixture(dir: &TempDir, name: &str, project_path: Option<&str>) -> PathBuf {
        let path = dir.path().join(name);
        let mut content = String::new();

        let pp_json = match project_path {
            Some(pp) => format!(r#","project_path":"{}""#, pp),
            None => String::new(),
        };

        content.push_str(&format!(
            r#"{{"role":"user","content":"Hello, I need help with login","timestamp":1700000000000,"seq":1{pp_json}}}"#,
        ));
        content.push('\n');
        content.push_str(
            r#"{"role":"assistant","content":"Sure, let me look at the login flow. The issue might be in the auth middleware.","timestamp":1700000001000,"seq":2}"#,
        );
        content.push('\n');
        content.push_str(
            r#"{"role":"user","content":"I tried your suggestion but it still fails","timestamp":1700000002000,"seq":3}"#,
        );
        content.push('\n');

        std::fs::write(&path, content).expect("Failed to write fixture file");
        path
    }

    #[test]
    fn should_scan_single_agent() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", Some("/projects/test"));

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);

        let reports = manager.scan_all().unwrap();
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].agent_id, "test-agent");
        assert_eq!(reports[0].sessions_found, 1);
        assert!(reports[0].errors.is_empty());
    }

    #[test]
    fn should_scan_all_agents() {
        let dir1 = TempDir::new().unwrap();
        let dir2 = TempDir::new().unwrap();
        create_fixture(&dir1, "session-1.jsonl", Some("/projects/test"));
        create_fixture(&dir2, "session-2.jsonl", Some("/projects/test"));

        let adapter1 = TestAdapter::new("agent-a", dir1.path().to_path_buf());
        let adapter2 = TestAdapter::new("agent-b", dir2.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter1), Box::new(adapter2)]);

        let reports = manager.scan_all().unwrap();
        assert_eq!(reports.len(), 2);
    }

    #[test]
    fn should_list_conversations_filtered_by_project_path() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", Some("/projects/alpha"));
        create_fixture(&dir, "session-2.jsonl", Some("/projects/beta"));

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all().unwrap();

        let results = manager.list(Some("/projects/alpha"), None).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].project_path.as_deref(), Some("/projects/alpha"));
    }

    #[test]
    fn should_list_conversations_filtered_by_agent_id() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", Some("/projects/test"));

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all().unwrap();

        let results = manager.list(None, Some("test-agent")).unwrap();
        assert_eq!(results.len(), 1);

        let results = manager.list(None, Some("nonexistent")).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn should_list_return_empty_when_cache_empty() {
        let manager = ConversationManager::new(Vec::new());
        let results = manager.list(None, None).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn should_get_messages_for_conversation() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", Some("/projects/test"));

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all().unwrap();

        let list = manager.list(None, None).unwrap();
        let conv_id = &list[0].id;

        let messages = manager.get_messages(conv_id).unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[2].role, "user");
        assert_eq!(messages[0].seq, 1);
    }

    #[test]
    fn should_get_messages_fails_for_unknown_conversation() {
        let manager = ConversationManager::new(Vec::new());
        let result = manager.get_messages("unknown:session");
        assert!(result.is_err());
    }

    #[test]
    fn should_search_by_title() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", Some("/projects/test"));

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all().unwrap();

        let results = manager.search("login", None).unwrap();
        assert_eq!(results.len(), 1);

        let results = manager.search("nonexistent", None).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn should_search_return_empty_for_empty_query() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", Some("/projects/test"));

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all().unwrap();

        let results = manager.search("", None).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn should_update_meta() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", Some("/projects/test"));

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all().unwrap();

        let list = manager.list(None, None).unwrap();
        let conv_id = &list[0].id;

        manager
            .update_meta(conv_id, Some("Custom Title".to_string()), Some(vec!["bug".to_string()]))
            .unwrap();

        let updated = manager.list(None, None).unwrap();
        assert_eq!(updated[0].user_title.as_deref(), Some("Custom Title"));
        assert_eq!(updated[0].tags, vec!["bug"]);
    }

    #[test]
    fn should_get_resume_command() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", Some("/projects/test"));

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all().unwrap();

        let list = manager.list(None, None).unwrap();
        let conv_id = &list[0].id;

        let cmd = manager.get_resume_command(conv_id).unwrap();
        assert!(cmd.is_some());
        assert_eq!(cmd.unwrap(), vec!["test-agent", "resume", "session-1"]);
    }

    #[test]
    fn should_build_resume_context() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", Some("/projects/test"));

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all().unwrap();

        let list = manager.list(None, None).unwrap();
        let conv_id = &list[0].id;

        let context = manager.build_resume_context(conv_id, 2).unwrap();
        assert!(context.contains("[USER]"));
        assert!(context.contains("[ASSISTANT]"));
        assert!(context.contains("Continue:"));
    }

    #[test]
    fn should_export_markdown() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", Some("/projects/test"));

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all().unwrap();

        let list = manager.list(None, None).unwrap();
        let conv_id = &list[0].id;

        let md = manager.export_markdown(conv_id).unwrap();
        assert!(md.starts_with("# "));
        assert!(md.contains("**Agent**: test-agent"));
        assert!(md.contains("### user"));
        assert!(md.contains("### assistant"));
    }

    #[test]
    fn should_scan_nonexistent_directory() {
        let dir = TempDir::new().unwrap();
        // Use a subdirectory that doesn't exist
        let nonexistent = dir.path().join("nonexistent");

        let adapter = TestAdapter::new("test-agent", nonexistent);
        let manager = ConversationManager::new(vec![Box::new(adapter)]);

        let reports = manager.scan_all().unwrap();
        assert_eq!(reports[0].sessions_found, 0);
        assert!(reports[0].errors.is_empty());
    }

    #[test]
    fn should_get_resume_command_return_none_without_project_path() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", None);

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all().unwrap();

        let list = manager.list(None, None).unwrap();
        let conv_id = &list[0].id;

        let cmd = manager.get_resume_command(conv_id).unwrap();
        assert!(cmd.is_none());
    }

    #[test]
    fn should_return_error_for_invalid_conversation_id() {
        let manager = ConversationManager::new(Vec::new());
        let result = manager.get_messages("no-colon");
        assert!(result.is_err());
    }

    #[test]
    fn should_parse_conversation_id_format() {
        let (agent, native) = parse_conversation_id("agent:session-1").unwrap();
        assert_eq!(agent, "agent");
        assert_eq!(native, "session-1");
    }

    #[test]
    fn should_parse_conversation_id_with_multiple_colons() {
        let (agent, native) = parse_conversation_id("codex:2025/01/01/session-uuid").unwrap();
        assert_eq!(agent, "codex");
        assert_eq!(native, "2025/01/01/session-uuid");
    }

    #[test]
    fn should_return_none_for_empty_id() {
        assert!(parse_conversation_id("").is_none());
    }

    // ─── 集成测试：模拟真实 Claude Code 目录结构 ───

    /// 在指定目录下创建模拟的 Claude Code 会话文件（真实格式）
    fn create_claude_session_file(dir: &std::path::Path, subdir: &str, filename: &str) {
        let session_dir = dir.join(subdir);
        std::fs::create_dir_all(&session_dir).unwrap();
        let file_path = session_dir.join(filename);
        let mut content = String::new();
        // mode line
        content.push_str(r#"{"type":"mode","mode":"normal","sessionId":"fake-session-1"}"#);
        content.push('\n');
        // user message (new format: message is a string)
        content.push_str(
            r#"{"type":"user","uuid":"u1","parentUuid":"root","timestamp":"2025-01-15T10:00:01Z","message":"Can you help with the login bug?","cwd":"/Users/tomgs/my-project"}"#,
        );
        content.push('\n');
        // assistant message
        content.push_str(
            r#"{"type":"assistant","uuid":"a1","parentUuid":"u1","timestamp":"2025-01-15T10:00:30Z","message":{"content":[{"type":"text","text":"Sure, checking the login flow."}]}}"#,
        );
        content.push('\n');
        std::fs::write(&file_path, content).unwrap();
    }

    #[test]
    fn should_scan_real_claude_code_structure() {
        use crate::conversation::adapters::ClaudeCodeAdapter;

        let dir = TempDir::new().unwrap();
        let root = dir.path();

        // 模拟 ~/.claude/projects/-Users-tomgs-my-project/session.jsonl
        create_claude_session_file(
            root,
            "-Users-tomgs-my-project",
            "fake-session-1.jsonl",
        );

        // 创建一个指向该 root 的适配器（覆盖默认 ~/.claude/projects 路径）
        struct TestClaudeAdapter {
            root: PathBuf,
        }
        impl AgentSessionAdapter for TestClaudeAdapter {
            fn agent_id(&self) -> &str {
                "claude-code"
            }
            fn session_root(&self) -> PathBuf {
                self.root.clone()
            }
            fn file_pattern(&self) -> &str {
                "**/*.jsonl"
            }
            fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
                ClaudeCodeAdapter.parse_meta(file_path)
            }
            fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
                ClaudeCodeAdapter.parse_messages(file_path)
            }
            fn extract_session_id(&self, file_path: &Path) -> Option<String> {
                ClaudeCodeAdapter.extract_session_id(file_path)
            }
            fn resume_command(
                &self,
                sid: &str,
                pp: &str,
            ) -> Option<Vec<String>> {
                ClaudeCodeAdapter.resume_command(sid, pp)
            }
        }

        let adapter = TestClaudeAdapter {
            root: root.to_path_buf(),
        };
        let manager = ConversationManager::new(vec![Box::new(adapter)]);

        // 扫描
        let reports = manager.scan_all().unwrap();
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].sessions_found, 1);
        assert!(reports[0].errors.is_empty());

        // 列表：按 project_path 过滤
        let results = manager
            .list(Some("/Users/tomgs/my-project"), None)
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].agent_id, "claude-code");
        assert_eq!(results[0].message_count, 2);
        assert!(results[0].preview.contains("login bug"));
        assert_eq!(
            results[0].project_path.as_deref(),
            Some("/Users/tomgs/my-project")
        );

        // 列表：无过滤
        let all = manager.list(None, None).unwrap();
        assert_eq!(all.len(), 1);
    }

    // ─── Resume 命令构造测试（验证每个 Agent 的正确 resume 命令）───

    #[test]
    fn claude_code_resume_command() {
        use crate::conversation::adapters::ClaudeCodeAdapter;
        let cmd = ClaudeCodeAdapter
            .resume_command("40fb5179-2c80-45a9-8ac0-56ce8ab4178e", "/test")
            .expect("Claude Code should support resume");
        assert_eq!(cmd, vec!["--resume", "40fb5179-2c80-45a9-8ac0-56ce8ab4178e"]);
    }

    #[test]
    fn codex_resume_command() {
        use crate::conversation::adapters::CodexAdapter;
        let cmd = CodexAdapter
            .resume_command("session-uuid-123", "/test")
            .expect("Codex should support resume");
        assert_eq!(cmd, vec!["resume", "session-uuid-123"]);
    }

    #[test]
    fn codebuddy_resume_command() {
        use crate::conversation::adapters::CodeBuddyAdapter;
        let cmd = CodeBuddyAdapter
            .resume_command("session-abc", "/test")
            .expect("CodeBuddy should support resume");
        assert_eq!(cmd, vec!["--resume", "session-abc"]);
    }

    #[test]
    fn pi_resume_command() {
        use crate::conversation::adapters::PiAdapter;
        let cmd = PiAdapter
            .resume_command("pi-session-1", "/test")
            .expect("Pi should support resume via --session");
        assert_eq!(cmd, vec!["--session", "pi-session-1"]);
    }

    #[test]
    fn gemini_resume_command_returns_none() {
        use crate::conversation::adapters::GeminiAdapter;
        let cmd = GeminiAdapter.resume_command("test", "/test");
        assert!(cmd.is_none(), "Gemini should not support native CLI resume");
    }

    #[test]
    fn qoder_resume_command_returns_none() {
        use crate::conversation::adapters::QoderAdapter;
        let cmd = QoderAdapter.resume_command("test", "/test");
        assert!(cmd.is_none(), "Qoder should not support native CLI resume");
    }

    #[test]
    fn opencode_resume_command() {
        use crate::conversation::adapters::OpenCodeAdapter;
        let cmd = OpenCodeAdapter
            .resume_command("ses-abc", "/test")
            .expect("OpenCode should support resume via --session");
        assert_eq!(cmd, vec!["--session", "ses-abc"]);
    }

    /// 验证通过 Manager.get_resume_command 的完整路径（使用封装适配器避免扫描真实目录）
    #[test]
    fn manager_get_resume_command_claude_code() {
        use crate::conversation::adapters::ClaudeCodeAdapter;

        let dir = TempDir::new().unwrap();
        create_claude_session_file(dir.path(), "-Users-tomgs-test", "session.jsonl");

        // 封装适配器：复用 ClaudeCodeAdapter 的解析逻辑，但指向测试目录
        struct TestAdapter { root: PathBuf }
        impl AgentSessionAdapter for TestAdapter {
            fn agent_id(&self) -> &str { "claude-code" }
            fn session_root(&self) -> PathBuf { self.root.clone() }
            fn file_pattern(&self) -> &str { "**/*.jsonl" }
            fn parse_meta(&self, p: &Path) -> Result<ParsedMeta> { ClaudeCodeAdapter.parse_meta(p) }
            fn parse_messages(&self, p: &Path) -> Result<Vec<ParsedMessage>> { ClaudeCodeAdapter.parse_messages(p) }
            fn extract_session_id(&self, p: &Path) -> Option<String> { ClaudeCodeAdapter.extract_session_id(p) }
            fn resume_command(&self, sid: &str, pp: &str) -> Option<Vec<String>> { ClaudeCodeAdapter.resume_command(sid, pp) }
        }

        let manager = ConversationManager::new(vec![Box::new(TestAdapter { root: dir.path().to_path_buf() })]);
        manager.scan_all().unwrap();

        let list = manager.list(None, None).unwrap();
        assert!(!list.is_empty(), "should find at least one conversation");
        let conv_id = &list[0].id;

        let cmd = manager
            .get_resume_command(conv_id)
            .expect("should get resume command")
            .expect("should have resume args");
        assert_eq!(cmd.len(), 2, "resume command should have 2 args");
        assert_eq!(cmd[0], "--resume", "first arg should be --resume");
    }
}
