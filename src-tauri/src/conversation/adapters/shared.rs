//! Adapter-facing shared plumbing: session-file reading, timestamp parsing,
//! tree linearisation and the conversation-view role policy.
//!
//! 这里只放「所有 JSONL 适配器都需要、且与具体 agent 格式无关」的东西。
//! 文本原语在 [`crate::conversation::text`]，预览策略在
//! [`crate::conversation::normalize`] —— 依赖因此保持单向：
//! `adapters::* → {normalize, text, types}`。

use std::collections::{HashMap, VecDeque};

use anyhow::Result;

/// 正文视图只收对话双方。
///
/// 工具结果 / 系统注入记录不是人类发言，且输出体量不可控（红线 4）；它们在各自的
/// 适配器里以独立记录落盘，由这里统一挡在视图与预览之外。
pub(crate) const CONVERSATION_ROLES: [&str; 2] = ["user", "assistant"];

/// `message.role`（树形 JSONL 适配器的共同形态：`{"message":{"role":…}}`）
pub(crate) fn message_role(entry: &serde_json::Value) -> Option<&str> {
    entry.pointer("/message/role").and_then(|v| v.as_str())
}

/// 条数 → u32（会话条数不可能接近 `u32::MAX`；显式饱和胜过 `as` 强转）。
pub(crate) fn saturating_count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
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

/// 从树形 JSONL 中线性化消息（Claude Code / Pi / OMP 公用）
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
            role_filter.is_none_or(|rf| e.get(type_field).and_then(|v| v.as_str()) == Some(rf))
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

/// 读取 JSONL 文件，返回所有非空行。
///
/// Uses the process-local scan cache so unchanged files and append-only growth
/// avoid full re-reads during history rescans.
pub(crate) fn read_jsonl(path: &std::path::Path) -> Result<Vec<serde_json::Value>> {
    crate::conversation::scan_cache::read_jsonl_cached(path)
}
