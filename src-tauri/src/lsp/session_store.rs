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
    /// `text` 是否可能在 `version` 上已陈旧（只收到了增量 `didChange`，后端重建不了全文）。
    /// 重放时据实告警 —— 不假装登记表里的文本是新的（错误地静默反而更难诊断）。
    pub(crate) text_stale: bool,
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

    /// 把该键的「连续失败」计数设为 `count`（**重启路径接账专用**）。
    ///
    /// 为什么是绝对值而不是自增：用户 stop 走 `close_session`（清空 streak，语义是
    /// 「从头开始」），而**重启**走 `take_session`（不清 streak）——重启是同一故障
    /// episode 的延续，调用方必须拿关闭**前**读到的 streak 接账。绝对写入让「关闭
    /// 序列内部新增的清理」不会把计数意外归零（若用自增，每次重启都从 1 开始 ⇒
    /// 崩溃循环永远绕过 `MAX_RESTART_COUNT`，上限形同虚设）。
    pub(crate) fn set_restart_count(&self, key: &str, count: u32) {
        match self.restart_counts.write() {
            Ok(mut m) => {
                if count == 0 {
                    m.remove(key);
                } else {
                    m.insert(key.to_string(), count);
                }
            }
            Err(poisoned) => {
                log::warn!("[LSP] restart_counts mutex poisoned, recovering");
                if count == 0 {
                    poisoned.into_inner().remove(key);
                } else {
                    poisoned.into_inner().insert(key.to_string(), count);
                }
            }
        }
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
            .filter(|doc| {
                if doc.text_stale {
                    // 只有增量 didChange 到达过：重放的文本停在最后一次全量同步。
                    // 如实告警而不静默 —— 新一轮诊断可能基于陈旧文本，排错时必须知道。
                    log::warn!(
                        "[LSP] replaying {} at v={} with possibly stale text \
                         (only incremental didChange was observed after it)",
                        doc.uri,
                        doc.version
                    );
                }
                notify(&doc.uri, &doc.language_id, doc.version, &doc.text)
            })
            .count()
    }

    /// 登记表与服务器**同源**：`didChange` 经 `lsp_transport` 转发时同步这里。
    ///
    /// - `full_text = Some(..)`（全量同步：`contentChanges` 里没有 `range`）⇒
    ///   文本与版本都更新；
    /// - `full_text = None`（增量同步）⇒ 只推版本，文本标记为可能陈旧；
    /// - 未登记的 uri ⇒ **不造条目**（登记表 = 我们确实 didOpen 过的文档）。
    ///
    /// 版本只**前进**（`max`）：登记表版本是重启重放 didOpen 的依据，让迟到 /
    /// 竞争 client 的低版本把它拉回去会破坏「重放版本不回退」的不变量。
    ///
    /// 返回是否命中已登记条目（调用方据此决定是否记 debug 日志）。
    pub(crate) fn update_open_document(
        &self,
        key: &str,
        uri: &str,
        version: i64,
        full_text: Option<&str>,
    ) -> bool {
        let update = |map: &mut HashMap<String, Vec<OpenDocument>>| -> bool {
            let Some(doc) = map
                .get_mut(key)
                .and_then(|docs| docs.iter_mut().find(|d| d.uri == uri))
            else {
                return false;
            };
            doc.version = doc.version.max(version);
            match full_text {
                Some(text) => {
                    doc.text.clear();
                    doc.text.push_str(text);
                    doc.text_stale = false;
                }
                None => doc.text_stale = true,
            }
            true
        };
        match self.open_docs.write() {
            Ok(mut map) => update(&mut map),
            Err(poisoned) => {
                log::warn!("[LSP] open_docs mutex poisoned, recovering");
                update(&mut poisoned.into_inner())
            }
        }
    }

    /// 摘除会话对象，**保留**该键的文档登记 / 编辑器所有权 / restart streak。
    ///
    /// 语义是「替换」：重启 / 崩溃重试后新服务器需要同一批文档（否则
    /// `reopen_documents` 是空转），且编辑器可能仍持有未保存缓冲区（登记表丢了
    /// 所有权就丢了，后端会按磁盘文本代开）。调用方负责对返回的会话跑关闭序列。
    pub(crate) fn take_session(&self, key: &str) -> Option<LspSession> {
        self.remove(key)
    }

    /// 摘除会话 + 清空该键的文档登记 / 编辑器所有权 / restart streak。
    ///
    /// 语义是「结束」（用户 stop / 项目停用）：服务器端确实忘了这些文档，下次
    /// 打开必须重新 didOpen（版本从 `next_open_version(None) = 0` 起），streak 也
    /// 该从头开始。**重启路径不得复用它**，否则重放的数据源被清掉。
    ///
    /// Caller is responsible for calling `kill_child()` on the returned session.
    pub(crate) fn close_session(&self, key: &str) -> Option<LspSession> {
        let session = self.take_session(key);
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
    use std::sync::Arc;

    /// 往 store 里放一个无真实进程的桩会话（关闭路径要能摘出对象来跑序列）。
    fn insert_stub_session(store: &LspSessionStore, key: &str) {
        let transport = Arc::new(crate::lsp::session::testing::RecordingTransport::default());
        let session = crate::lsp::session::testing::stub_session(transport, "/p", "rust", "stub");
        store.insert(key.to_string(), session);
    }

    fn doc(uri: &str, version: i64) -> OpenDocument {
        OpenDocument {
            uri: uri.to_string(),
            language_id: "rust".to_string(),
            text: "fn main() {}".to_string(),
            version,
            text_stale: false,
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

    /// 重启是**替换**：摘会话对象不得连带清掉文档登记与编辑器所有权。
    ///
    /// 缺陷现场（本用例钉死）：`close_session` 三件事一起做，重启路径复用它 ⇒
    /// 新会话建好后的 `reopen_documents` 恒重放 0 条（服务器端该文档消失，编辑器
    /// 也不重发 didOpen ⇒ 无诊断无补全），且 `editor_owned` 被清 ⇒ 后续请求判定
    /// 「需要后端代开」⇒ 按**磁盘文本**代开编辑器里的未保存缓冲区 ⇒ 诊断坐标错位。
    #[test]
    fn take_session_keeps_documents_and_ownership() {
        let store = LspSessionStore::new();
        let key = "/p::rust";
        insert_stub_session(&store, key);
        store.register_open_document(key.to_string(), doc("file:///a.rs", 1));
        store.register_open_document(key.to_string(), doc("file:///b.rs", 2));
        store.claim_document(key.to_string(), "file:///a.rs".to_string());
        store.set_restart_count(key, 2);

        let taken = store.take_session(key);

        assert!(
            taken.is_some(),
            "take_session 必须摘出会话对象（调用方要跑关闭序列）"
        );
        assert!(!store.is_alive(key), "会话对象已摘除");
        assert_eq!(
            store.reopen_documents(key, |_, _, _, _| true),
            2,
            "重启后重放的数据源必须还在（否则 reopen_documents 恒 0 条）"
        );
        assert!(
            store.is_editor_owned(key, "file:///a.rs"),
            "编辑器所有权必须跨重启保留（否则后端按磁盘文本代开未保存缓冲区）"
        );
        assert_eq!(
            store.restart_count(key),
            2,
            "重启是同一故障 episode 的延续：streak 不得被替换路径清零"
        );
    }

    /// 用户 stop / 项目停用是「会话就此结束」：登记表、所有权、streak 一并清空。
    #[test]
    fn close_session_clears_documents_and_ownership() {
        let store = LspSessionStore::new();
        let key = "/p::rust";
        insert_stub_session(&store, key);
        store.register_open_document(key.to_string(), doc("file:///a.rs", 1));
        store.register_open_document(key.to_string(), doc("file:///b.rs", 2));
        store.claim_document(key.to_string(), "file:///a.rs".to_string());
        store.set_restart_count(key, 3);

        let closed = store.close_session(key);

        assert!(closed.is_some(), "close_session 必须摘出会话对象");
        assert!(!store.is_alive(key));
        assert_eq!(
            store.reopen_documents(key, |_, _, _, _| true),
            0,
            "停止后服务器端确实忘了这些文档：登记表必须清空"
        );
        assert!(
            !store.is_editor_owned(key, "file:///a.rs"),
            "停止后所有权清空（下次打开重新声明）"
        );
        assert_eq!(
            store.restart_count(key),
            0,
            "停止 = 从头开始（streak 归零）"
        );
    }

    /// 全量同步的 didChange：文本与版本都可信 —— 重放必须用**最新文本**，
    /// 否则重启后服务器按 didOpen 时刻的旧文本算诊断（坐标与编辑器错位）。
    #[test]
    fn update_open_document_full_sync_replaces_text() {
        let store = LspSessionStore::new();
        let key = "/p::rust";
        store.register_open_document(key.to_string(), doc("file:///a.rs", 1));

        let hit =
            store.update_open_document(key, "file:///a.rs", 2, Some("fn main() { /* new */ }"));

        assert!(hit, "已登记 uri 的 didChange 必须命中条目");
        assert_eq!(store.open_document_version(key, "file:///a.rs"), Some(2));
        let text = store
            .open_docs
            .read()
            .expect("lock")
            .get(key)
            .and_then(|docs| docs.iter().find(|d| d.uri == "file:///a.rs"))
            .map(|d| d.text.clone());
        assert_eq!(
            text.as_deref(),
            Some("fn main() { /* new */ }"),
            "全量同步的文本必须替换登记表里的旧文本（重放会用这份）"
        );
    }

    /// 增量同步（只有 range 编辑）：后端无编辑器缓冲区，无法重建全文 ⇒ 只推版本，
    /// 文本保持（重放会打 warn 说明可能陈旧，不假装文本是新的）。
    #[test]
    fn update_open_document_incremental_bumps_version_only() {
        let store = LspSessionStore::new();
        let key = "/p::rust";
        store.register_open_document(key.to_string(), doc("file:///a.rs", 1));

        let hit = store.update_open_document(key, "file:///a.rs", 5, None);

        assert!(hit);
        assert_eq!(store.open_document_version(key, "file:///a.rs"), Some(5));
        let text = store
            .open_docs
            .read()
            .expect("lock")
            .get(key)
            .and_then(|docs| docs.iter().find(|d| d.uri == "file:///a.rs"))
            .map(|d| d.text.clone());
        assert_eq!(
            text.as_deref(),
            Some("fn main() {}"),
            "增量同步不得改文本（改了就是拿错文本去重放）"
        );
    }

    /// 未登记的 uri（前端在 Neeko 之外打开的文档 / 竞争窗口里的迟到 didChange）
    /// → 不造条目：登记表只记录「我们确实 didOpen 过的文档」。
    #[test]
    fn update_open_document_ignores_unregistered_uri() {
        let store = LspSessionStore::new();
        let key = "/p::rust";
        store.register_open_document(key.to_string(), doc("file:///a.rs", 1));

        let hit = store.update_open_document(key, "file:///other.rs", 9, Some("x"));

        assert!(!hit, "未登记 uri 不得被报告为已更新");
        assert!(!store.is_document_open(key, "file:///other.rs"));
        assert_eq!(
            store.reopen_documents(key, |_, _, _, _| true),
            1,
            "登记表仍只有原来那一条"
        );
    }
}
