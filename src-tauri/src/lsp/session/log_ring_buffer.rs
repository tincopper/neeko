//! Byte-bounded ring buffer of recent stderr lines for View Logs.

use std::collections::VecDeque;

use crate::lsp::types::LspServerLogEntry;

/// Max total size (bytes) of retained stderr logs per session for View Logs.
const LOG_RING_MAX_BYTES: usize = 10 * 1024 * 1024; // 10 MB

/// Size of one log entry's heap content (the three `String` fields).
const fn entry_size(e: &LspServerLogEntry) -> usize {
    e.timestamp.len() + e.level.len() + e.message.len()
}

/// Evicts the oldest entries once the total stored size exceeds [`LOG_RING_MAX_BYTES`] (10 MB).
pub(crate) struct LogRingBuffer {
    entries: VecDeque<LspServerLogEntry>,
    total_bytes: usize,
}

impl LogRingBuffer {
    pub(crate) const fn new() -> Self {
        Self {
            entries: VecDeque::new(),
            total_bytes: 0,
        }
    }

    pub(crate) fn push(&mut self, entry: LspServerLogEntry) {
        self.total_bytes += entry_size(&entry);
        self.entries.push_back(entry);
        while self.total_bytes > LOG_RING_MAX_BYTES {
            if let Some(front) = self.entries.pop_front() {
                self.total_bytes -= entry_size(&front);
            } else {
                break;
            }
        }
    }

    /// Most recent entries (newest last), capped by `limit`. `limit == 0` means "all".
    pub(crate) fn snapshot(&self, limit: usize) -> Vec<LspServerLogEntry> {
        let take = if limit == 0 {
            self.entries.len()
        } else {
            limit.min(self.entries.len())
        };
        self.entries
            .iter()
            .rev()
            .take(take)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }
}
