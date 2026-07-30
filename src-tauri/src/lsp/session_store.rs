//! LSP session lifecycle management.

use std::collections::HashMap;
use std::sync::{Mutex, RwLock};

use crate::lsp::session::LspSession;
use crate::lsp::types::LspSessionInfo;

/// Tracked open document for session restart recovery.
#[derive(Clone)]
pub(crate) struct OpenDocument {
    pub(crate) uri: String,
    pub(crate) language_id: String,
    pub(crate) text: String,
    pub(crate) version: i64,
}

/// Manages LspSession lifecycle independent of plugin or profile concerns.
pub struct LspSessionStore {
    /// Active sessions: Mutex because LspSession contains LspProcess (non-Sync).
    sessions: Mutex<HashMap<String, LspSession>>,
    /// Document tracking: RwLock since documents are mostly read.
    open_docs: RwLock<HashMap<String, Vec<OpenDocument>>>,
    /// Restart bookkeeping: RwLock for concurrent reads.
    restart_counts: RwLock<HashMap<String, u32>>,
}

impl LspSessionStore {
    pub(crate) fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            open_docs: RwLock::new(HashMap::new()),
            restart_counts: RwLock::new(HashMap::new()),
        }
    }

    pub(crate) fn contains(&self, key: &str) -> bool {
        self.sessions
            .lock()
            .map(|s| s.contains_key(key))
            .unwrap_or(false)
    }

    pub(crate) fn is_alive(&self, key: &str) -> bool {
        self.sessions
            .lock()
            .ok()
            .and_then(|s| s.get(key).map(|x| x.is_alive()))
            .unwrap_or(false)
    }

    pub(crate) fn with_session<F, R>(&self, key: &str, f: F) -> Option<R>
    where
        F: FnOnce(&LspSession) -> R,
    {
        self.sessions.lock().ok()?.get(key).map(f)
    }

    pub(crate) fn insert(&self, key: String, session: LspSession) {
        if let Ok(mut s) = self.sessions.lock() {
            s.insert(key, session);
        }
    }

    pub(crate) fn remove(&self, key: &str) -> Option<LspSession> {
        self.sessions.lock().ok()?.remove(key)
    }

    pub(crate) fn list(&self) -> Vec<LspSessionInfo> {
        self.sessions
            .lock()
            .map(|s| s.values().map(|x| x.snapshot()).collect())
            .unwrap_or_default()
    }

    pub(crate) fn session_language_ids_for_project(&self, project_path: &str) -> Vec<String> {
        self.sessions
            .lock()
            .map(|s| {
                s.values()
                    .filter(|x| x.project_path == project_path)
                    .map(|x| x.language_id.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub(crate) fn restart_count(&self, key: &str) -> u32 {
        self.restart_counts
            .read()
            .map(|m| *m.get(key).unwrap_or(&0))
            .unwrap_or(0)
    }

    pub(crate) fn increment_restart(&self, key: &str) -> u32 {
        self.restart_counts
            .write()
            .map(|mut m| {
                let entry = m.entry(key.to_string()).or_insert(0);
                *entry += 1;
                *entry
            })
            .unwrap_or(0)
    }

    pub(crate) fn clear_restart(&self, key: &str) {
        match self.restart_counts.write() {
            Ok(mut m) => {
                m.remove(key);
            }
            Err(poisoned) => {
                log::warn!("[LSP] restart_counts mutex poisoned, recovering");
                poisoned.into_inner().remove(key);
            }
        }
    }

    pub(crate) fn register_open_document(&self, key: String, doc: OpenDocument) {
        match self.open_docs.write() {
            Ok(mut map) => {
                map.entry(key).or_default().push(doc);
            }
            Err(poisoned) => {
                log::warn!("[LSP] open_docs mutex poisoned, recovering");
                poisoned.into_inner().entry(key).or_default().push(doc);
            }
        }
    }

    pub(crate) fn is_document_open(&self, key: &str, uri: &str) -> bool {
        self.open_docs
            .read()
            .ok()
            .and_then(|m| m.get(key).map(|docs| docs.iter().any(|d| d.uri == uri)))
            .unwrap_or(false)
    }

    pub(crate) fn unregister_open_document(&self, key: &str, uri: &str) {
        match self.open_docs.write() {
            Ok(mut map) => {
                if let Some(docs) = map.get_mut(key) {
                    docs.retain(|d| d.uri != uri);
                    if docs.is_empty() {
                        map.remove(key);
                    }
                }
            }
            Err(poisoned) => {
                log::warn!("[LSP] open_docs mutex poisoned, recovering");
                let mut map = poisoned.into_inner();
                if let Some(docs) = map.get_mut(key) {
                    docs.retain(|d| d.uri != uri);
                    if docs.is_empty() {
                        map.remove(key);
                    }
                }
            }
        }
    }

    pub(crate) fn clear_open_documents(&self, key: &str) {
        match self.open_docs.write() {
            Ok(mut map) => {
                map.remove(key);
            }
            Err(poisoned) => {
                log::warn!("[LSP] open_docs mutex poisoned, recovering");
                poisoned.into_inner().remove(key);
            }
        }
    }

    pub(crate) fn clear_all_open_documents(&self) {
        if let Ok(mut map) = self.open_docs.write() {
            map.clear();
        }
    }

    pub(crate) fn reopen_documents<F>(&self, key: &str, notify: F) -> usize
    where
        F: Fn(&str, &str, i64, &str) -> bool,
    {
        let docs = self
            .open_docs
            .read()
            .ok()
            .and_then(|m| m.get(key).cloned())
            .unwrap_or_default();
        docs.iter()
            .filter(|doc| notify(&doc.uri, &doc.language_id, doc.version, &doc.text))
            .count()
    }

    /// Close a session and return it for external kill.
    /// Caller is responsible for calling `kill_child()` on the returned session.
    pub(crate) fn close_session(&self, key: &str) -> Option<LspSession> {
        let session = self.remove(key);
        self.clear_open_documents(key);
        self.clear_restart(key);
        session
    }

    pub(crate) fn close_all(&self) -> Vec<LspSession> {
        let sessions: Vec<LspSession> = self
            .sessions
            .lock()
            .map(|mut s| s.drain().map(|(_, v)| v).collect())
            .unwrap_or_default();
        self.clear_all_open_documents();
        sessions
    }
}
