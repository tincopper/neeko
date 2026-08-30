//! Pre-authorized external file reads for go-to-definition targets.
//!
//! 跳转目标可能位于项目根之外（monorepo 依赖、系统安装的源码等），`read_file_content`
//! 的路径安全校验会拒绝项目外路径——跳转因此静默失败。definition 响应中的 uri 是
//! LSP server 实际解析出的目标文件，以此作为读取授权凭据：后端在 definition 响应
//! 返回前记录目标 uri，前端凭 uri 调用 `lsp_read_preauthorized_file` 读取。
//!
//! 安全模型（路径安全红线的白名单式扩展）：
//! - 授权表按 (project, language) 分桶，前端无法跨会话伪造；
//! - 只有 LSP 响应中出现过的 uri 可读，任意路径探测直接拒绝；
//! - FIFO 容量淘汰 + 已授权 uri 提前（近似 LRU），防止无界增长。

use std::collections::{HashMap, VecDeque};

/// Per-session授权 uri 容量上限。
pub const MAX_URIS_PER_SESSION: usize = 64;

/// Pre-authorized definition-target uris, bucketed per (project, language).
#[derive(Debug, Default)]
pub struct PreauthorizedTargets {
    by_session: HashMap<(String, String), VecDeque<String>>,
}

impl PreauthorizedTargets {
    /// Creates an empty authorization table.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Record definition-target URIs for a (project, language) session.
    /// Empty input is a no-op; duplicates are refreshed to the queue tail.
    pub fn record(&mut self, project: &str, language: &str, uris: &[String]) {
        if uris.is_empty() {
            return;
        }
        let entry = self
            .by_session
            .entry((project.to_string(), language.to_string()))
            .or_default();
        for uri in uris {
            entry.retain(|u| u != uri);
            entry.push_back(uri.clone());
        }
        while entry.len() > MAX_URIS_PER_SESSION {
            entry.pop_front();
        }
    }

    /// Whether `uri` was returned as a definition target for this session.
    #[must_use]
    pub fn is_authorized(&self, project: &str, language: &str, uri: &str) -> bool {
        self.by_session
            .get(&(project.to_string(), language.to_string()))
            .is_some_and(|entry| entry.iter().any(|u| u == uri))
    }
}

/// 上限对齐前端 `canEdit` 阈值（FileEditor 512KB），防止预授权读取大文件。
pub const MAX_PREAUTH_READ_BYTES: u64 = 512 * 1024;

#[cfg(test)]
mod tests {
    use super::*;

    fn uris(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn recorded_uri_is_authorized_for_its_session() {
        let mut preauth = PreauthorizedTargets::new();
        preauth.record("proj", "rust", &uris(&["file:///out/x.rs"]));

        assert!(preauth.is_authorized("proj", "rust", "file:///out/x.rs"));
    }

    #[test]
    fn unrecorded_or_cross_session_uri_is_denied() {
        let mut preauth = PreauthorizedTargets::new();
        preauth.record("proj", "rust", &uris(&["file:///out/x.rs"]));

        // 未记录 / 换语言 / 换项目 均拒绝
        assert!(!preauth.is_authorized("proj", "rust", "file:///out/y.rs"));
        assert!(!preauth.is_authorized("proj", "go", "file:///out/x.rs"));
        assert!(!preauth.is_authorized("proj2", "rust", "file:///out/x.rs"));
    }

    #[test]
    fn capacity_is_fifo_capped_per_session() {
        let mut preauth = PreauthorizedTargets::new();
        let items: Vec<String> = (0..MAX_URIS_PER_SESSION + 8)
            .map(|i| format!("file:///out/{i}.rs"))
            .collect();
        preauth.record("proj", "rust", &items);

        // 最早 8 个被淘汰，容量不超上限
        assert!(!preauth.is_authorized("proj", "rust", "file:///out/0.rs"));
        assert!(preauth.is_authorized(
            "proj",
            "rust",
            &format!("file:///out/{}.rs", MAX_URIS_PER_SESSION + 7)
        ));
    }

    #[test]
    fn re_recording_refreshes_uri_to_queue_tail() {
        let mut preauth = PreauthorizedTargets::new();
        preauth.record("proj", "rust", &uris(&["file:///a.rs", "file:///b.rs"]));
        preauth.record("proj", "rust", &uris(&["file:///a.rs"]));

        // 溢出淘汰应先淘汰更久未见的 b，而非刚刷新的 a：
        // [b, a] + 63 个 fill = 65 项 → 恰好淘汰队首的 b
        let overflow: Vec<String> = (0..MAX_URIS_PER_SESSION - 1)
            .map(|i| format!("file:///fill/{i}.rs"))
            .collect();
        preauth.record("proj", "rust", &overflow);

        assert!(preauth.is_authorized("proj", "rust", "file:///a.rs"));
        assert!(!preauth.is_authorized("proj", "rust", "file:///b.rs"));
    }

    #[test]
    fn empty_record_is_noop() {
        let mut preauth = PreauthorizedTargets::new();
        preauth.record("proj", "rust", &[]);
        assert!(!preauth.is_authorized("proj", "rust", "file:///x.rs"));
    }
}
