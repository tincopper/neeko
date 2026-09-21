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
    /// **编辑器持有**的 uri：前端视图挂载即声明（原子性 ownership）。代开只对
    /// 无人持有的 uri 生效 —— 否则后端会拿**磁盘文本**去覆盖编辑器正在编辑的
    /// 未保存缓冲区，服务器据此算出的诊断位置与编辑器文本错位。
    editor_owned: RwLock<HashMap<String, Vec<String>>>,
}

impl LspSessionStore {
    pub(crate) fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            open_docs: RwLock::new(HashMap::new()),
            restart_counts: RwLock::new(HashMap::new()),
            editor_owned: RwLock::new(HashMap::new()),
        }
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

    /// 登记/刷新一个打开中的文档。
    ///
    /// **同 uri 只保留一条**（后来者覆盖）：客户端可能在没有 didClose 的情况下重复
    /// didOpen（前任 client 未关 / 重挂竞态），登记表若堆叠重复项，会话重启的补发会
    /// 把同一 uri 连发两次 didOpen —— rust-analyzer 之类服务器会以
    /// `duplicate DidOpenTextDocument` 拒绝并停止分析该文件。
    pub(crate) fn register_open_document(&self, key: String, doc: OpenDocument) {
        let register = |map: &mut HashMap<String, Vec<OpenDocument>>| {
            let docs = map.entry(key.clone()).or_default();
            docs.retain(|d| d.uri != doc.uri);
            docs.push(doc.clone());
        };
        match self.open_docs.write() {
            Ok(mut map) => register(&mut map),
            Err(poisoned) => {
                log::warn!("[LSP] open_docs mutex poisoned, recovering");
                let mut guard = poisoned.into_inner();
                register(&mut guard);
            }
        }
    }

    pub(crate) fn is_document_open(&self, key: &str, uri: &str) -> bool {
        self.open_document_version(key, uri).is_some()
    }

    /// 已登记版本号；未登记返回 `None`。
    ///
    /// 供转发层识别「第二个前端 client 在写同一文档」：它的版本计数器独立，
    /// 会出现版本回退（`v_new <= v_prev`）。
    pub(crate) fn open_document_version(&self, key: &str, uri: &str) -> Option<i64> {
        self.open_docs
            .read()
            .ok()
            .and_then(|m| m.get(key)?.iter().find(|d| d.uri == uri).map(|d| d.version))
    }

    /// 前端视图声明持有该文档（挂载时调用；重复声明幂等）。
    pub(crate) fn claim_document(&self, key: String, uri: String) {
        if let Ok(mut owned) = self.editor_owned.write() {
            let uris = owned.entry(key).or_default();
            if !uris.iter().any(|u| u == &uri) {
                uris.push(uri);
            }
        }
    }

    /// 视图卸载（最后一个视图）时释放持有。
    pub(crate) fn release_document(&self, key: &str, uri: &str) {
        if let Ok(mut owned) = self.editor_owned.write() {
            if let Some(uris) = owned.get_mut(key) {
                uris.retain(|u| u != uri);
                if uris.is_empty() {
                    owned.remove(key);
                }
            }
        }
    }

    /// 是否由编辑器视图持有（持有期间后端**不得**代为打开）。
    pub(crate) fn is_editor_owned(&self, key: &str, uri: &str) -> bool {
        self.editor_owned
            .read()
            .ok()
            .and_then(|m| m.get(key).map(|uris| uris.iter().any(|u| u == uri)))
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
        if let Ok(mut owned) = self.editor_owned.write() {
            owned.remove(key);
        }
        session
    }

    pub(crate) fn close_all(&self) -> Vec<LspSession> {
        let sessions: Vec<LspSession> = self
            .sessions
            .lock()
            .map(|mut s| s.drain().map(|(_, v)| v).collect())
            .unwrap_or_default();
        self.clear_all_open_documents();
        if let Ok(mut owned) = self.editor_owned.write() {
            owned.clear();
        }
        sessions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(uri: &str, version: i64) -> OpenDocument {
        OpenDocument {
            uri: uri.to_string(),
            language_id: "rust".to_string(),
            text: "fn main() {}".to_string(),
            version,
        }
    }

    /// 重复 didOpen（前任 client 未 didClose / 重挂竞态）不得让登记表出现两条同 uri
    /// —— 否则会话重启时会补发两次 didOpen，服务器（rust-analyzer）直接拒绝分析。
    #[test]
    fn registering_the_same_uri_twice_keeps_a_single_entry() {
        let store = LspSessionStore::new();
        store.register_open_document("/p::rust".to_string(), doc("file:///a.rs", 0));
        store.register_open_document("/p::rust".to_string(), doc("file:///a.rs", 3));

        let docs = store.open_docs.read().expect("lock");
        let entries = docs.get("/p::rust").expect("key");
        assert_eq!(entries.len(), 1, "同 uri 只保留一条（取最新）");
        assert_eq!(entries[0].version, 3, "后到的版本覆盖旧的");
    }

    /// 编辑器持有：声明后即为持有，释放后不再是；重复声明幂等（同 uri 只留一条）。
    #[test]
    fn editor_ownership_is_claimed_and_released() {
        let store = LspSessionStore::new();
        assert!(!store.is_editor_owned("/p::rust", "file:///a.rs"));

        store.claim_document("/p::rust".to_string(), "file:///a.rs".to_string());
        store.claim_document("/p::rust".to_string(), "file:///a.rs".to_string());
        assert!(store.is_editor_owned("/p::rust", "file:///a.rs"));
        assert_eq!(
            store
                .editor_owned
                .read()
                .expect("lock")
                .get("/p::rust")
                .map(Vec::len),
            Some(1),
            "重复声明不堆叠"
        );

        store.release_document("/p::rust", "file:///a.rs");
        assert!(!store.is_editor_owned("/p::rust", "file:///a.rs"));
    }

    /// 所有权按（project, language）隔离，且关闭会话时清空。
    #[test]
    fn editor_ownership_is_per_session_and_cleared_on_close() {
        let store = LspSessionStore::new();
        store.claim_document("/p::rust".to_string(), "file:///a.rs".to_string());

        assert!(!store.is_editor_owned("/p::go", "file:///a.rs"));
        assert!(!store.is_editor_owned("/q::rust", "file:///a.rs"));

        store.clear_open_documents("/p::rust");
        assert!(
            store.is_editor_owned("/p::rust", "file:///a.rs"),
            "清文档登记不动所有权"
        );
    }

    /// 版本号可见：转发层据此识别「第二个 client 的独立计数器」（版本回退）。
    #[test]
    fn open_document_version_reports_registered_version() {
        let store = LspSessionStore::new();
        assert_eq!(
            store.open_document_version("/p::rust", "file:///a.rs"),
            None
        );

        store.register_open_document("/p::rust".to_string(), doc("file:///a.rs", 7));
        assert_eq!(
            store.open_document_version("/p::rust", "file:///a.rs"),
            Some(7)
        );

        store.unregister_open_document("/p::rust", "file:///a.rs");
        assert_eq!(
            store.open_document_version("/p::rust", "file:///a.rs"),
            None
        );
    }

    #[test]
    fn is_document_open_tracks_register_unregister() {
        let store = LspSessionStore::new();
        assert!(!store.is_document_open("/p::rust", "file:///a.rs"));

        store.register_open_document("/p::rust".to_string(), doc("file:///a.rs", 0));
        assert!(store.is_document_open("/p::rust", "file:///a.rs"));
        assert!(!store.is_document_open("/p::rust", "file:///b.rs"));

        store.unregister_open_document("/p::rust", "file:///a.rs");
        assert!(!store.is_document_open("/p::rust", "file:///a.rs"));
    }

    /// 同一 uri 在不同（project, language）会话里互不影响。
    #[test]
    fn open_document_state_is_per_session() {
        let store = LspSessionStore::new();
        store.register_open_document("/p::rust".to_string(), doc("file:///a.rs", 0));

        assert!(store.is_document_open("/p::rust", "file:///a.rs"));
        assert!(!store.is_document_open("/p::go", "file:///a.rs"));
        assert!(!store.is_document_open("/q::rust", "file:///a.rs"));
    }
}
