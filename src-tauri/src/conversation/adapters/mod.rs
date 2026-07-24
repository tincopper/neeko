//! Shared helpers for agent session adapters.

use std::collections::{HashMap, VecDeque};

use anyhow::Result;
use regex::Regex;

use crate::conversation::adapter::AgentSessionAdapter;

/// Adapter for Claude Code session files.
pub mod claude_code;
/// Adapter for CodeBuddy session files.
pub mod codebuddy;
/// Adapter for Codex session files.
pub mod codex;
/// Adapter for Gemini session files.
pub mod gemini;
/// Adapter for Grok session files.
pub mod grok;
/// Adapter for OMP session files.
pub mod omp;
/// Adapter for OpenCode session files.
pub mod opencode;
/// Adapter for Pi session files.
pub mod pi;
/// Adapter for Qoder session files.
pub mod qoder;
/// Adapter for Reasonix session files.
pub mod reasonix;

pub use claude_code::ClaudeCodeAdapter;
pub use codebuddy::CodeBuddyAdapter;
pub use codex::CodexAdapter;
pub use gemini::GeminiAdapter;
pub use grok::GrokAdapter;
pub use omp::OmpAdapter;
pub use opencode::OpenCodeAdapter;
pub use pi::PiAdapter;
pub use qoder::QoderAdapter;
pub use reasonix::ReasonixAdapter;

/// 返回所有已注册的 AgentSessionAdapter 实例
#[must_use]
pub fn all_adapters() -> Vec<Box<dyn AgentSessionAdapter>> {
    vec![
        Box::new(CodexAdapter),
        Box::new(ClaudeCodeAdapter),
        Box::new(PiAdapter),
        Box::new(GeminiAdapter),
        Box::new(QoderAdapter),
        Box::new(CodeBuddyAdapter),
        Box::new(OpenCodeAdapter),
        Box::new(OmpAdapter::new()),
        Box::new(GrokAdapter),
        Box::new(ReasonixAdapter),
    ]
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/// 剥离 ANSI 转义序列
pub(crate) fn strip_ansi(s: &str) -> String {
    let re = Regex::new(r"\x1B\[[0-9;]*[a-zA-Z]").expect("infallible: static regex pattern");
    re.replace_all(s, "").to_string()
}

/// 解析常见时间戳格式为 Unix 毫秒时间戳
///
/// 支持：
/// - RFC 3339 / ISO 8601 字符串（含毫秒）
/// - 数值毫秒时间戳（13 位）
/// - 数值秒时间戳（10 位）
pub(crate) fn parse_timestamp(value: &serde_json::Value) -> Option<i64> {
    match value {
        serde_json::Value::String(s) => {
            // Try RFC 3339
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
                return Some(dt.timestamp_millis());
            }
            // Try ISO 8601 with Z suffix
            if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.fZ") {
                return Some(ndt.and_utc().timestamp_millis());
            }
            None
        }
        serde_json::Value::Number(n) => {
            if let Some(ms) = n.as_i64() {
                if ms > 1_000_000_000_000 {
                    Some(ms) // already ms
                } else {
                    Some(ms * 1000) // seconds to ms
                }
            } else {
                None
            }
        }
        _ => None,
    }
}

/// 从树形 JSONL 中线性化消息（Claude Code / Pi 公用）
///
/// 输入是所有 JSON 行的解析结果，返回在 BFS 顺序下浅析得到的 (原始索引, seq) 列表。
/// 只处理 `type_field` 值为 `role_filter`（如 "user"/"assistant"）或为 `None`（不过滤）的条目。
pub(crate) fn linearize_tree_entries(
    entries: &[serde_json::Value],
    id_field: &str,
    parent_field: &str,
    type_field: &str,
    role_filter: Option<&str>,
) -> Vec<(usize, u32)> {
    // 先过滤需要的条目
    let filtered_indices: Vec<usize> = entries
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            role_filter.map_or(true, |rf| {
                e.get(type_field).and_then(|v| v.as_str()) == Some(rf)
            })
        })
        .map(|(i, _)| i)
        .collect();

    // 建立 id → index 映射
    let mut id_to_idx: HashMap<&str, usize> = HashMap::new();
    for &idx in &filtered_indices {
        if let Some(id) = entries[idx].get(id_field).and_then(|v| v.as_str()) {
            id_to_idx.insert(id, idx);
        }
    }

    // 建立 parentId → children 映射
    let mut children: HashMap<&str, Vec<usize>> = HashMap::new();
    for &idx in &filtered_indices {
        let parent = entries[idx]
            .get(parent_field)
            .and_then(|v| v.as_str())
            .unwrap_or("root");
        children.entry(parent).or_default().push(idx);
    }

    // BFS 遍历
    let mut result = Vec::new();
    let mut seq = 0u32;
    let mut queue: VecDeque<&str> = VecDeque::new();
    queue.push_back("root");

    while let Some(current) = queue.pop_front() {
        if current != "root" {
            if let Some(&idx) = id_to_idx.get(current) {
                result.push((idx, seq));
                seq += 1;
            }
        }
        if let Some(child_indices) = children.remove(current) {
            for child_idx in child_indices {
                if let Some(id) = entries[child_idx].get(id_field).and_then(|v| v.as_str()) {
                    queue.push_back(id);
                }
            }
        }
    }

    result
}

/// 由（role, 原文）消息对构建预览环形缓冲。
///
/// - 剔除 harness 注入噪声（is_harness_injected_user_turn）
/// - 剔除空白消息
/// - 保留最近 `PREVIEW_MESSAGE_LIMIT` 条（按出现顺序）
pub(crate) fn recent_messages_from(mut pairs: Vec<(String, String)>) -> Vec<(String, String)> {
    use crate::conversation::normalize::{is_harness_injected_user_turn, PREVIEW_MESSAGE_LIMIT};
    pairs.retain(|(_, text)| !is_harness_injected_user_turn(text) && !text.trim().is_empty());
    let len = pairs.len();
    if len > PREVIEW_MESSAGE_LIMIT {
        pairs.drain(..len - PREVIEW_MESSAGE_LIMIT);
    }
    pairs
}

/// 读取 JSONL 文件，返回所有非空行。
///
/// Uses the process-local scan cache so unchanged files and append-only growth
/// avoid full re-reads during history rescans.
pub(crate) fn read_jsonl(path: &std::path::Path) -> Result<Vec<serde_json::Value>> {
    crate::conversation::scan_cache::read_jsonl_cached(path)
}

/// 对字符串截断到指定长度（在字符边界），附加省略号
pub(crate) fn truncate(s: &str, max_chars: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        format!("{}...", s.chars().take(max_chars).collect::<String>())
    }
}

#[cfg(test)]
mod registry_tests {
    use super::all_adapters;
    use crate::agent::AgentManager;

    /// L2: every history adapter agent_id must exist in default AgentConfig ids.
    #[test]
    fn should_align_history_adapter_ids_with_default_agents() {
        let manager = AgentManager::new();
        let agent_ids: std::collections::HashSet<&str> = manager
            .get_agents()
            .iter()
            .map(|a| a.id.as_str())
            .collect();

        for adapter in all_adapters() {
            let id = adapter.agent_id();
            assert!(
                agent_ids.contains(id),
                "history adapter `{id}` has no matching AgentConfig in default_agents"
            );
        }
    }

    #[test]
    fn should_register_omp_grok_reasonix_adapters() {
        let adapters = all_adapters();
        let ids: Vec<&str> = adapters.iter().map(|a| a.agent_id()).collect();
        for expected in ["omp", "grok", "reasonix", "codex", "pi", "claude-code", "opencode"] {
            assert!(
                ids.contains(&expected),
                "missing adapter {expected} in all_adapters: {ids:?}"
            );
        }
    }
}
