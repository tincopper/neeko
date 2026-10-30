#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::{Context, Result};
use chrono::DateTime;
use regex::Regex;
use walkdir::WalkDir;

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage};
use crate::conversation::adapters::saturating_count;
use crate::conversation::normalize::{build_preview_messages, normalize_session_text, NormTarget};
use crate::conversation::types::{
    ConversationListPage, ConversationMessage, ConversationMessagePage, ConversationMeta,
    ConversationSearchHit, ConversationStats, ScanReport, ToolCallRef,
};

/// 会话标题三优先级解析（供 `scan` 循环与单测复用）。
///
/// - P2：AI 生成标题（`title`）
/// - P3：首条用户消息（`first_user_message`）
/// - 兜底：`<agent_id> <native_session_id 前 8 位>`
pub(crate) fn resolve_title(
    title: Option<&str>,
    first_user_message: Option<&str>,
    agent_id: &str,
    native_session_id: &str,
) -> String {
    normalize_session_text(title.unwrap_or(""), NormTarget::Title)
        .or_else(|| normalize_session_text(first_user_message.unwrap_or(""), NormTarget::Title))
        .unwrap_or_else(|| {
            let short = &native_session_id[..native_session_id.len().min(8)];
            format!("{} {}", agent_id, short)
        })
}

/// 内存缓存 + 扫描编排
///
/// 职责：
/// - 持有所有 AgentSessionAdapter 实例
/// - 扫描 Agent 原生会话文件，提取元数据存入内存缓存
/// - 提供查询、搜索、消息查看、恢复上下文构建、Markdown 导出等功能
#[allow(clippy::type_complexity)]
pub struct ConversationManager {
    adapters: HashMap<String, Box<dyn AgentSessionAdapter>>,
    cache: Mutex<HashMap<String, ConversationMeta>>,
    /// Whether the cold-start disk index has been applied this process.
    disk_index_hydrated: Mutex<bool>,
    /// Optional progress callback for scan_agents (command layer may emit Tauri events).
    scan_progress: Mutex<Option<Box<dyn Fn(ScanProgressEvent) + Send>>>,
    /// 单槽正文缓存：分页只解析一次（见 `load_transcript`）。
    transcript: Mutex<Option<CachedTranscript>>,
}

/// 最近一次正文解析结果。用于分页：否则每一页都会重新解析整份会话文件
/// （实测最大会话 4293 条：7 页 = 7 次全量解析 ≈ 3.7s，而单次解析 ≈ 0.5s）。
///
/// 只缓存**一个**会话、且以 (文件长度, 修改时间) 失效 —— 它是读放大缓存，不是持久化
/// （会话文件是 append-only，变长即失效，不会读到旧正文）。
struct CachedTranscript {
    conversation_id: String,
    file_len: u64,
    file_modified: Option<std::time::SystemTime>,
    messages: std::sync::Arc<Vec<ConversationMessage>>,
}

/// Lightweight progress signal emitted during multi-agent scan.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressEvent {
    /// Agent currently being scanned.
    pub agent_id: String,
    /// `start` | `done` | `error`
    pub phase: String,
    /// Sessions found for this agent after `done` (0 on start/error).
    pub sessions_found: u32,
    /// Optional project scope for this scan.
    pub project_path: Option<String>,
}

impl ConversationManager {
    /// 创建 ConversationManager，注入适配器列表
    #[must_use]
    pub fn new(adapters: Vec<Box<dyn AgentSessionAdapter>>) -> Self {
        let mut adapter_map = HashMap::new();
        for adapter in adapters {
            adapter_map.insert(adapter.agent_id().to_string(), adapter);
        }
        Self {
            adapters: adapter_map,
            cache: Mutex::new(HashMap::new()),
            disk_index_hydrated: Mutex::new(false),
            scan_progress: Mutex::new(None),
            transcript: Mutex::new(None),
        }
    }

    /// Register a process-wide scan progress listener (overwrites previous).
    pub fn set_scan_progress_handler(
        &self,
        handler: Option<Box<dyn Fn(ScanProgressEvent) + Send>>,
    ) {
        if let Ok(mut slot) = self.scan_progress.lock() {
            *slot = handler;
        }
    }

    fn emit_progress(&self, event: ScanProgressEvent) {
        if let Ok(slot) = self.scan_progress.lock() {
            if let Some(handler) = slot.as_ref() {
                handler(event);
            }
        }
    }

    /// Hydrate memory cache from `~/.neeko/conversation-index.json` once when empty.
    ///
    /// Safe to call on every list/search: no-ops after first successful attempt
    /// (including missing file). Does not overwrite non-empty cache entries.
    pub fn hydrate_from_disk_index_if_empty(&self) -> Result<bool> {
        {
            let hydrated = self
                .disk_index_hydrated
                .lock()
                .map_err(|e| anyhow::anyhow!("disk_index_hydrated lock poisoned: {e}"))?;
            if *hydrated {
                return Ok(false);
            }
        }

        let mut cache = self
            .cache
            .lock()
            .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;
        if !cache.is_empty() {
            if let Ok(mut h) = self.disk_index_hydrated.lock() {
                *h = true;
            }
            return Ok(false);
        }

        let loaded = match crate::conversation::disk_index::load_default_index() {
            Ok(v) => v,
            Err(e) => {
                log::warn!("conversation disk index load failed: {e:#}");
                if let Ok(mut h) = self.disk_index_hydrated.lock() {
                    *h = true;
                }
                return Ok(false);
            }
        };

        let Some(index) = loaded else {
            if let Ok(mut h) = self.disk_index_hydrated.lock() {
                *h = true;
            }
            return Ok(false);
        };

        for meta in index.conversations {
            cache.entry(meta.id.clone()).or_insert(meta);
        }
        if let Ok(mut h) = self.disk_index_hydrated.lock() {
            *h = true;
        }
        Ok(true)
    }

    /// Persist current memory cache to the cold-start disk index.
    pub fn persist_disk_index(&self) -> Result<()> {
        let snapshot: Vec<ConversationMeta> = {
            let cache = self
                .cache
                .lock()
                .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;
            cache.values().cloned().collect()
        };
        crate::conversation::disk_index::save_default_index(snapshot)
    }

    /// Scan every registered agent. When `project_path` is `Some`, adapters that
    /// support scoped discovery only parse sessions for that project.
    pub fn scan_all(&self, project_path: Option<&str>) -> Result<Vec<ScanReport>> {
        self.scan_agents(project_path, None)
    }

    /// Scan a subset of agents (or all when `only_agent_ids` is `None`).
    ///
    /// Used by the command layer to skip disabled agents without coupling the
    /// manager to `AgentManager`.
    pub fn scan_agents(
        &self,
        project_path: Option<&str>,
        only_agent_ids: Option<&[String]>,
    ) -> Result<Vec<ScanReport>> {
        use std::thread;

        // Materialize ids so we can share `&self` across scoped threads.
        // If the enabled-agent filter yields no overlap with adapters, fall back
        // to all adapters so History never goes silently empty.
        let agent_ids: Vec<String> = match only_agent_ids {
            Some(ids) => {
                let filtered: Vec<String> = ids
                    .iter()
                    .filter(|id| self.adapters.contains_key(id.as_str()))
                    .cloned()
                    .collect();
                if filtered.is_empty() {
                    self.adapters.keys().cloned().collect()
                } else {
                    filtered
                }
            }
            None => self.adapters.keys().cloned().collect(),
        };

        thread::scope(|scope| {
            let mut handles = Vec::with_capacity(agent_ids.len());
            for agent_id in &agent_ids {
                handles.push(scope.spawn(move || -> Result<ScanReport> {
                    let adapter = self.adapters.get(agent_id).ok_or_else(|| {
                        anyhow::anyhow!(
                            "Adapter missing for agent id that was just listed: {agent_id}"
                        )
                    })?;
                    self.emit_progress(ScanProgressEvent {
                        agent_id: agent_id.clone(),
                        phase: "start".into(),
                        sessions_found: 0,
                        project_path: project_path.map(|s| s.to_string()),
                    });
                    match self.scan_agent_inner(agent_id, adapter.as_ref(), project_path) {
                        Ok(report) => {
                            self.emit_progress(ScanProgressEvent {
                                agent_id: agent_id.clone(),
                                phase: "done".into(),
                                sessions_found: report.sessions_found,
                                project_path: project_path.map(|s| s.to_string()),
                            });
                            Ok(report)
                        }
                        Err(e) => {
                            self.emit_progress(ScanProgressEvent {
                                agent_id: agent_id.clone(),
                                phase: "error".into(),
                                sessions_found: 0,
                                project_path: project_path.map(|s| s.to_string()),
                            });
                            Err(e)
                        }
                    }
                }));
            }

            let mut reports = Vec::with_capacity(handles.len());
            let mut first_err: Option<anyhow::Error> = None;
            for handle in handles {
                match handle.join() {
                    Ok(Ok(report)) => reports.push(report),
                    Ok(Err(e)) => {
                        if first_err.is_none() {
                            first_err = Some(e);
                        } else {
                            log::error!("scan_all agent error: {e:#}");
                        }
                    }
                    Err(panic_payload) => {
                        let msg = format!("scan_all worker panicked: {panic_payload:?}");
                        log::error!("{msg}");
                        if first_err.is_none() {
                            first_err = Some(anyhow::anyhow!(msg));
                        }
                    }
                }
            }
            if let Some(e) = first_err {
                // Prefer returning partial success when any reports exist so one bad
                // adapter cannot blank the entire history list.
                if reports.is_empty() {
                    return Err(e);
                }
                log::error!("scan_all completed with partial errors: {e:#}");
            }
            // Stable-ish order by agent_id for tests / logs
            reports.sort_by(|a, b| a.agent_id.cmp(&b.agent_id));
            Ok(reports)
        })
    }

    /// 扫描指定 Agent 的会话文件，更新内存缓存
    pub fn scan_agent(&self, agent_id: &str, project_path: Option<&str>) -> Result<ScanReport> {
        let adapter = self
            .adapters
            .get(agent_id)
            .with_context(|| format!("Adapter not found for agent: {agent_id}"))?;
        self.emit_progress(ScanProgressEvent {
            agent_id: agent_id.to_string(),
            phase: "start".into(),
            sessions_found: 0,
            project_path: project_path.map(|s| s.to_string()),
        });
        match self.scan_agent_inner(agent_id, adapter.as_ref(), project_path) {
            Ok(report) => {
                self.emit_progress(ScanProgressEvent {
                    agent_id: agent_id.to_string(),
                    phase: "done".into(),
                    sessions_found: report.sessions_found,
                    project_path: project_path.map(|s| s.to_string()),
                });
                Ok(report)
            }
            Err(e) => {
                self.emit_progress(ScanProgressEvent {
                    agent_id: agent_id.to_string(),
                    phase: "error".into(),
                    sessions_found: 0,
                    project_path: project_path.map(|s| s.to_string()),
                });
                Err(e)
            }
        }
    }

    fn scan_agent_inner(
        &self,
        agent_id: &str,
        adapter: &dyn AgentSessionAdapter,
        project_path: Option<&str>,
    ) -> Result<ScanReport> {
        // 优先使用批量解析（如 SQLite 单文件多会话适配器）
        if let Some(bulk) = adapter.parse_all_metas_for_project(project_path) {
            let metas = bulk?;
            let mut sessions_found: u32 = 0;
            let errors: Vec<String> = Vec::new();

            for (meta, synthetic_path) in metas {
                let conversation = build_conversation_meta(agent_id, adapter, meta, synthetic_path);
                let mut cache = self
                    .cache
                    .lock()
                    .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;
                let (user_title, tags) = cache
                    .get(&conversation.id)
                    .map(|prev| (prev.user_title.clone(), prev.tags.clone()))
                    .unwrap_or((None, Vec::new()));
                let mut conversation = conversation;
                conversation.user_title = user_title;
                conversation.tags = tags;
                cache.insert(conversation.id.clone(), conversation);
                sessions_found += 1;
            }

            return Ok(ScanReport {
                agent_id: agent_id.to_string(),
                sessions_found,
                errors,
            });
        }

        // 默认逐文件扫描（可被 discovery_roots 收窄到项目目录）
        let session_root = adapter.session_root();
        let walk_roots: Vec<std::path::PathBuf> = match adapter.discovery_roots(project_path) {
            // Adapter opted into scoped discovery for this project.
            Some(roots) if roots.is_empty() => {
                return Ok(ScanReport {
                    agent_id: agent_id.to_string(),
                    sessions_found: 0,
                    errors: Vec::new(),
                });
            }
            Some(roots) => roots,
            // Unscoped / unsupported: full session_root walk.
            None => {
                if !session_root.exists() {
                    return Ok(ScanReport {
                        agent_id: agent_id.to_string(),
                        sessions_found: 0,
                        errors: Vec::new(),
                    });
                }
                vec![session_root.clone()]
            }
        };

        // Basename-only patterns (no `/`, no leading `**/`) match nested paths by default.
        let effective_pattern = normalize_file_pattern(adapter.file_pattern());
        let pattern_regex = pattern_to_regex(&effective_pattern);

        let mut sessions_found: u32 = 0;
        let mut errors: Vec<String> = Vec::new();
        let mut files_seen: u32 = 0;
        let mut pattern_hits: u32 = 0;

        for walk_root in &walk_roots {
            if !walk_root.exists() {
                continue;
            }
            for entry in WalkDir::new(walk_root)
                .min_depth(1)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                files_seen = files_seen.saturating_add(1);

                // 使用相对于 session_root 的路径匹配 pattern（scoped roots 仍相对完整 root）
                let rel_path = match path.strip_prefix(&session_root) {
                    Ok(rp) => rp,
                    Err(_) => {
                        // Fallback: relative to the walk root when outside session_root
                        // (test adapters that inject a temp root as discovery root).
                        match path.strip_prefix(walk_root) {
                            Ok(rp) => rp,
                            Err(_) => continue,
                        }
                    }
                };
                // Windows 上 rel_path 用 `\` 分隔,而 glob pattern 约定 `/` 分隔;
                // 统一转成 `/` 后再匹配,否则 `**/sessions/*.jsonl` 在 Windows 上永远命中不了。
                let rel_str = rel_path.to_string_lossy().replace('\\', "/");

                if !pattern_regex.is_match(&rel_str) {
                    continue;
                }
                pattern_hits = pattern_hits.saturating_add(1);

                // Fingerprint reuse: skip re-parsing unchanged session files.
                let path_buf = path.to_path_buf();
                let signature = crate::conversation::scan_cache::source_signature(path);
                let cached_meta = signature.and_then(|sig| {
                    crate::conversation::scan_cache::get_cached_file_meta(path, &sig)
                });

                let parse_result = if let Some(meta) = cached_meta {
                    Ok(meta)
                } else {
                    adapter.parse_meta(path).inspect(|meta| {
                        if let Some(sig) = signature {
                            crate::conversation::scan_cache::put_cached_file_meta(
                                path_buf.clone(),
                                sig,
                                meta.clone(),
                            );
                        }
                    })
                };

                match parse_result {
                    Ok(meta) => {
                        let conversation =
                            build_conversation_meta(agent_id, adapter, meta, path_buf);
                        // Preserve user edits from prior cache entry when re-scan rebuilds meta.
                        let mut cache = self
                            .cache
                            .lock()
                            .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;
                        let (user_title, tags) = cache
                            .get(&conversation.id)
                            .map(|prev| (prev.user_title.clone(), prev.tags.clone()))
                            .unwrap_or((None, Vec::new()));
                        let mut conversation = conversation;
                        conversation.user_title = user_title;
                        conversation.tags = tags;
                        cache.insert(conversation.id.clone(), conversation);
                        sessions_found += 1;
                    }
                    Err(e) => {
                        // Intentional main-session / noise filters use `bail!("skip: ...")`.
                        // Do not flood ScanReport.errors with expected noise.
                        if is_intentional_skip(&e) {
                            log::debug!("scan skip {}: {e}", path.display());
                        } else {
                            errors.push(format!("Failed to parse {}: {e}", path.display()));
                        }
                    }
                }
            }
        }

        if sessions_found == 0 && files_seen > 0 {
            let msg = format!(
                "scan found 0 sessions for {agent_id} under {} (files_seen={files_seen}, pattern_hits={pattern_hits}, pattern={effective_pattern}, roots={})",
                session_root.display(),
                walk_roots.len()
            );
            log::warn!("{msg}");
            errors.push(msg);
        }

        Ok(ScanReport {
            agent_id: agent_id.to_string(),
            sessions_found,
            errors,
        })
    }

    /// 列出缓存的会话（全量，兼容旧调用方 / 测试）。
    ///
    /// - `project_path`: 严格匹配会话所属项目（见 [`matches_project_path`]）
    /// - `agent_id`: 按 agent 过滤（为 None 时不过滤）
    /// - 结果按 `updated_at` 倒序排列
    pub fn list(
        &self,
        project_path: Option<&str>,
        agent_id: Option<&str>,
    ) -> Result<Vec<ConversationMeta>> {
        let page = self.list_page(project_path, agent_id, 0, 0)?;
        Ok(page.items)
    }

    /// Paginated list for fishbone / infinite scroll.
    ///
    /// - `limit == 0` means "return all remaining from offset".
    /// - Project filter is **strict**: only sessions whose `project_path` belongs
    ///   to the selected project. Sessions with missing project path are excluded
    ///   when a project filter is set (History is project-scoped).
    pub fn list_page(
        &self,
        project_path: Option<&str>,
        agent_id: Option<&str>,
        offset: u32,
        limit: u32,
    ) -> Result<ConversationListPage> {
        let cache = self
            .cache
            .lock()
            .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;

        let mut results: Vec<ConversationMeta> = cache
            .values()
            .filter(|m| {
                let matches_project = match project_path {
                    Some(pp) => matches_project_path(m.project_path.as_deref(), pp),
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

        results.sort_by_key(|b| std::cmp::Reverse(b.updated_at));

        let total = u32::try_from(results.len()).unwrap_or(u32::MAX);
        let start = (offset as usize).min(results.len());
        let end = if limit == 0 {
            results.len()
        } else {
            (start + limit as usize).min(results.len())
        };
        let items: Vec<ConversationMeta> = results[start..end].to_vec();
        let has_more = (u64::from(offset) + items.len() as u64) < u64::from(total);

        Ok(ConversationListPage {
            items,
            total,
            offset,
            limit,
            has_more,
        })
    }

    /// 获取一页会话正文（红线 4：单次 IPC 载荷受预算约束）。
    ///
    /// 分页只是**传输**边界：解析仍然完整（本地文件，不涉 IPC），因此搜索/统计/导出
    /// 这些需要全量的路径继续用 [`Self::get_messages`]。
    pub fn get_messages_page(
        &self,
        conversation_id: &str,
        offset: u32,
    ) -> Result<ConversationMessagePage> {
        let all = self.load_transcript(conversation_id)?;
        let start = (offset as usize).min(all.len());
        let end = page_end(&all, start);
        Ok(build_message_page(&all, start, end, end < all.len()))
    }

    /// 取「以尾部为锚」的一页正文：`offset_from_end` 表示跳过末尾多少条。
    ///
    /// 正文视图从最新消息开始看，所以首屏要的是尾页；`offset_from_end = 0` 即最后一页。
    /// `has_more` 的语义随之变成「更早的方向还有」。
    pub fn get_messages_page_from_end(
        &self,
        conversation_id: &str,
        offset_from_end: u32,
    ) -> Result<ConversationMessagePage> {
        let all = self.load_transcript(conversation_id)?;
        let end = all.len().saturating_sub(offset_from_end as usize);
        let start = page_start_from_end(&all, end);
        Ok(build_message_page(&all, start, end, start > 0))
    }

    /// 正文统计（工具调用清单 / thinking 计数）。由 Rust 计算，避免前端为计数持有全量正文。
    pub fn conversation_stats(&self, conversation_id: &str) -> Result<ConversationStats> {
        let all = self.load_transcript(conversation_id)?;
        Ok(summarize_transcript(&all))
    }

    /// 正文内搜索：返回命中定位 + 片段（不返回正文，载荷与命中数成正比）。
    pub fn search_messages(
        &self,
        conversation_id: &str,
        query: &str,
    ) -> Result<Vec<ConversationSearchHit>> {
        /// 单次搜索最多返回的命中数（超出即截断，前端提示可继续输入缩小范围）。
        const MAX_HITS: usize = 200;
        /// 命中片段前后保留的字符数。
        const SNIPPET_RADIUS: usize = 40;

        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        // 大小写不敏感匹配必须直接在**原串**上做：`to_lowercase()` 可能改变字节长度（如 `İ`），
        // 用它算出的偏移会让片段错位甚至切坏多字节字符。
        let pattern = regex::RegexBuilder::new(&regex::escape(trimmed))
            .case_insensitive(true)
            .build()
            .context("invalid search pattern")?;
        let all = self.load_transcript(conversation_id)?;

        let mut hits: Vec<ConversationSearchHit> = Vec::new();
        for message in all.iter() {
            if hits.len() >= MAX_HITS {
                break;
            }
            if let Some(matched) = pattern.find(&message.content) {
                hits.push(ConversationSearchHit {
                    seq: message.seq,
                    role: message.role.clone(),
                    snippet: snippet_around(
                        &message.content,
                        matched.start(),
                        matched.end() - matched.start(),
                        SNIPPET_RADIUS,
                    ),
                });
            }
        }
        Ok(hits)
    }

    /// 取（缓存的）完整正文。分页是传输边界，解析只做一次。
    fn load_transcript(
        &self,
        conversation_id: &str,
    ) -> Result<std::sync::Arc<Vec<ConversationMessage>>> {
        let file_path = self.session_file_path(conversation_id)?;
        let (file_len, file_modified) = transcript_stamp(&file_path);

        {
            let cache = self
                .transcript
                .lock()
                .map_err(|e| anyhow::anyhow!("Transcript cache lock poisoned: {e}"))?;
            if let Some(hit) = cache.as_ref() {
                if hit.conversation_id == conversation_id
                    && hit.file_len == file_len
                    && hit.file_modified == file_modified
                {
                    return Ok(std::sync::Arc::clone(&hit.messages));
                }
            }
        }

        let messages = std::sync::Arc::new(self.get_messages(conversation_id)?);
        let mut cache = self
            .transcript
            .lock()
            .map_err(|e| anyhow::anyhow!("Transcript cache lock poisoned: {e}"))?;
        *cache = Some(CachedTranscript {
            conversation_id: conversation_id.to_string(),
            file_len,
            file_modified,
            messages: std::sync::Arc::clone(&messages),
        });
        Ok(messages)
    }

    /// 会话正文对应的原生文件路径（缓存未命中时的解析入口）。
    fn session_file_path(&self, conversation_id: &str) -> Result<std::path::PathBuf> {
        let cache = self
            .cache
            .lock()
            .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;
        cache
            .get(conversation_id)
            .map(|m| m.file_path.clone())
            .context("Conversation not found in cache")
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
                blocks: p.blocks,
                model: p.model,
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
    pub fn search(&self, query: &str, project_path: Option<&str>) -> Result<Vec<ConversationMeta>> {
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
                // project_path: strict project ownership (History is project-scoped)
                if let Some(pp) = project_path {
                    if !matches_project_path(m.project_path.as_deref(), pp) {
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

        results.sort_by_key(|b| std::cmp::Reverse(b.updated_at));
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

        let (native_session_id, project_path, file_path) = {
            let cache = self
                .cache
                .lock()
                .map_err(|e| anyhow::anyhow!("Cache lock poisoned: {e}"))?;
            let meta = cache
                .get(conversation_id)
                .context("Conversation not found in cache")?;
            (
                meta.native_session_id.clone(),
                meta.project_path.clone(),
                meta.file_path.clone(),
            )
        };

        // Prefer path-aware resume (e.g. Reasonix needs absolute session file path).
        Ok(adapter.resume_command_for_file(
            &native_session_id,
            project_path.as_deref().unwrap_or(""),
            &file_path,
        ))
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
        md.push_str(&format!(
            "- **Started**: {}\n",
            format_timestamp(meta.started_at)
        ));
        md.push_str(&format!(
            "- **Messages**: {}\n\n---\n\n",
            meta.message_count
        ));

        for msg in &messages {
            let timestamp = format_timestamp(msg.timestamp);
            md.push_str(&format!("### {} ({})\n\n", msg.role, timestamp));
            md.push_str(&format!("{}\n\n", msg.content));
        }

        Ok(md)
    }
}

/// 单页正文的序列化字节预算（红线 4 的 2MB 上限留出外层包装与前端解析余量）。
const MESSAGE_PAGE_BYTE_BUDGET: usize = 1_500_000;

/// 单页条数上限：避免「极小消息」把单页条数拉爆（也限制前端单次渲染批次）。
const MESSAGE_PAGE_MAX_ITEMS: usize = 800;

/// 工具调用清单上限：清单随会话线性增长（每条约 60 字节），超出即截断；
/// `tool_calls` 仍是真实总数，`tool_call_list_truncated` 告知前端（红线 4 的同一约束）。
const MAX_TOOL_CALL_REFS: usize = 2000;

/// 单页正文的装配（头分页 / 尾分页共用）。
fn build_message_page(
    all: &[ConversationMessage],
    start: usize,
    end: usize,
    has_more: bool,
) -> ConversationMessagePage {
    ConversationMessagePage {
        items: all[start..end].to_vec(),
        total: saturating_count(all.len()),
        offset: saturating_count(start),
        limit: saturating_count(end - start),
        has_more,
    }
}

/// 正文统计（纯函数，便于直测）：工具调用 / thinking 计数 + 侧边栏清单。
fn summarize_transcript(messages: &[ConversationMessage]) -> ConversationStats {
    use crate::conversation::types::MessageBlock;

    let mut tool_call_list: Vec<ToolCallRef> = Vec::new();
    let mut tool_calls: u32 = 0;
    let mut thinking_count: u32 = 0;
    let mut unique_tools: Vec<String> = Vec::new();

    for message in messages {
        for (block_idx, block) in message.blocks.iter().enumerate() {
            match block {
                MessageBlock::ToolUse { name, input, .. } => {
                    tool_calls += 1;
                    if !unique_tools.iter().any(|known| known == name) {
                        unique_tools.push(name.clone());
                    }
                    if tool_call_list.len() < MAX_TOOL_CALL_REFS {
                        tool_call_list.push(ToolCallRef {
                            seq: message.seq,
                            block_idx: saturating_count(block_idx),
                            name: name.clone(),
                            summary: tool_call_summary(name, input),
                        });
                    }
                }
                MessageBlock::Thinking { .. } => thinking_count += 1,
                _ => {}
            }
        }
    }

    ConversationStats {
        total_messages: saturating_count(messages.len()),
        tool_calls,
        thinking_count,
        unique_tools,
        tool_call_list_truncated: tool_calls > saturating_count(tool_call_list.len()),
        tool_call_list,
    }
}

/// 计算「以 `end` 为右端」的一页起点：与 [`page_end`] 同构，方向相反，
/// 同样保证至少 1 条（超大单条消息不会让 offset 卡死）。
fn page_start_from_end(messages: &[ConversationMessage], end: usize) -> usize {
    let end = end.min(messages.len());
    let mut bytes = 0usize;
    let mut start = end;
    while start > 0 {
        let index = start - 1;
        if end - start >= MESSAGE_PAGE_MAX_ITEMS || bytes >= MESSAGE_PAGE_BYTE_BUDGET {
            break;
        }
        bytes += serde_json::to_vec(&messages[index]).map_or(0, |v| v.len());
        start = index;
    }
    start
}

/// 工具调用摘要：路径 / 命令 / pattern 优先，其余截断序列化（与前端
/// `getToolSummary` 同一规则，两侧各自有测试；侧边栏用这份，块内渲染用前端那份）。
fn tool_call_summary(name: &str, input: &serde_json::Value) -> String {
    /// 摘要字符上限。
    const SUMMARY_MAX_CHARS: usize = 120;

    let pick = |keys: &[&str]| -> Option<String> {
        keys.iter()
            .find_map(|key| input.get(*key).and_then(|v| v.as_str()))
            .map(|s| s.trim().to_string())
    };
    let picked = match name {
        "Read" | "Write" | "Edit" | "LS" | "Cat" => pick(&["file_path", "path"]),
        "Bash" => pick(&["command"]),
        "Grep" | "Glob" | "GlobSearch" => pick(&["pattern"]),
        _ => None,
    };
    let raw = picked.unwrap_or_else(|| {
        serde_json::to_string(input)
            .unwrap_or_default()
            .chars()
            .take(60)
            .collect()
    });
    crate::conversation::text::truncate(&raw, SUMMARY_MAX_CHARS)
}

/// 命中片段：围绕命中位置取前后若干字符，折叠换行（供搜索列表展示）。
fn snippet_around(content: &str, byte_idx: usize, needle_len: usize, radius: usize) -> String {
    let chars_before: String = {
        let prefix = content.get(..byte_idx).unwrap_or_default();
        let mut chars: Vec<char> = prefix.chars().collect();
        let skip = chars.len().saturating_sub(radius);
        chars.drain(..skip);
        chars.into_iter().collect()
    };
    let tail_start = content
        .get(byte_idx + needle_len..)
        .map(|rest| rest.chars().take(radius).collect::<String>())
        .unwrap_or_default();
    let needle = content
        .get(byte_idx..byte_idx + needle_len)
        .unwrap_or_default();
    let snippet = format!("{chars_before}{needle}{tail_start}");
    snippet.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 会话文件指纹（长度 + 修改时间）。会话文件 append-only，靠这两项即可判定缓存失效。
fn transcript_stamp(path: &std::path::Path) -> (u64, Option<std::time::SystemTime>) {
    match std::fs::metadata(path) {
        Ok(meta) => (meta.len(), meta.modified().ok()),
        // 文件不可读时给一个必然不匹配的指纹：让缓存失效，由解析路径报出真实错误
        Err(_) => (u64::MAX, None),
    }
}

/// 计算本页结束下标（`start..end` 即本页切片）。
///
/// 约束：条数 ≤ [`MESSAGE_PAGE_MAX_ITEMS`]、累计序列化字节 ≤ [`MESSAGE_PAGE_BYTE_BUDGET`]，
/// 且**至少 1 条** —— 否则超大单条消息会让 offset 永不前进，前端死循环。
fn page_end(messages: &[ConversationMessage], start: usize) -> usize {
    let start = start.min(messages.len());
    let mut bytes = 0usize;
    for (i, message) in messages[start..].iter().enumerate() {
        if i >= MESSAGE_PAGE_MAX_ITEMS || bytes >= MESSAGE_PAGE_BYTE_BUDGET {
            return start + i;
        }
        bytes += serde_json::to_vec(message).map_or(0, |v| v.len());
    }
    messages.len()
}

/// Build a cache entry from adapter-parsed meta (shared by bulk + WalkDir paths).
fn build_conversation_meta(
    agent_id: &str,
    adapter: &dyn AgentSessionAdapter,
    meta: crate::conversation::adapter::ParsedMeta,
    file_path: std::path::PathBuf,
) -> ConversationMeta {
    let native_session_id = meta.native_session_id;
    let id = format!("{agent_id}:{native_session_id}");
    let resolved_title = resolve_title(
        meta.title.as_deref(),
        meta.first_user_message.as_deref(),
        agent_id,
        &native_session_id,
    );
    let resolved_preview = build_preview_messages(&meta.recent_messages);
    let supports_resume = adapter
        .resume_command_for_file(
            &native_session_id,
            meta.project_path.as_deref().unwrap_or(""),
            &file_path,
        )
        .is_some();

    ConversationMeta {
        id,
        native_session_id,
        agent_id: agent_id.to_string(),
        title: resolved_title,
        model: meta.model,
        started_at: meta.started_at,
        updated_at: meta.updated_at,
        message_count: meta.message_count,
        preview: resolved_preview,
        file_path,
        project_path: meta.project_path,
        user_title: None,
        tags: Vec::new(),
        supports_resume,
    }
}

/// Strict project ownership for History list/search.
///
/// A session belongs to `project` when its recorded path equals the project or
/// is nested under it (`/proj` matches `/proj` and `/proj/sub`, not `/proj-other`).
/// Missing session project path never matches a concrete project filter.
pub(crate) fn matches_project_path(session_project: Option<&str>, project: &str) -> bool {
    let Some(raw) = session_project.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    let project = project.trim().trim_end_matches('/');
    if project.is_empty() {
        return false;
    }
    let session = raw.trim_end_matches('/');
    if session == project {
        return true;
    }
    // Require boundary so `/proj` does not match `/proj-other`.
    session.starts_with(project) && session[project.len()..].starts_with('/')
}

/// Adapters signal intentional noise filters with `bail!("skip: ...")`.
fn is_intentional_skip(err: &anyhow::Error) -> bool {
    err.to_string().starts_with("skip:")
}

/// Parse a conversation ID like `agent:session` into its components.
fn parse_conversation_id(id: &str) -> Option<(&str, &str)> {
    let colon_pos = id.find(':')?;
    Some((&id[..colon_pos], &id[colon_pos + 1..]))
}

/// Normalize adapter `file_pattern` so basename-only globs match nested paths.
///
/// - If the pattern already contains `/` or starts with `**/`, it is returned as-is.
/// - Otherwise (e.g. `*.jsonl`, `rollout-*.jsonl`), prefix `**/` so WalkDir relative
///   paths like `2026/07/16/rollout-….jsonl` match.
///
/// This fixes silent empty scans for Codex/Pi/Gemini/Qoder-style nested layouts
/// without requiring every adapter to remember `**/`.
pub(crate) fn normalize_file_pattern(pattern: &str) -> String {
    let p = pattern.trim();
    if p.is_empty() {
        return p.to_string();
    }
    if p.contains('/') || p.starts_with("**/") {
        p.to_string()
    } else {
        format!("**/{p}")
    }
}

/// Convert a simple glob pattern into a regular expression.
///
/// Globstar rules:
/// - `**/` matches zero or more path segments (including root), so `**/*.jsonl`
///   matches both `session.jsonl` and `a/b/session.jsonl`.
/// - bare `**` (not followed by `/`) matches any characters including `/`.
/// - single `*` matches a single path segment (no `/`).
fn pattern_to_regex(pattern: &str) -> Regex {
    let mut regex_str = String::new();
    let chars: Vec<char> = pattern.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '*' => {
                if i + 1 < chars.len() && chars[i + 1] == '*' {
                    // `**/` = zero or more directories (optional prefix)
                    if i + 2 < chars.len() && chars[i + 2] == '/' {
                        regex_str.push_str("(?:.*/)?");
                        i += 2; // skip second `*` and `/`
                    } else {
                        // bare `**`
                        regex_str.push_str(".*");
                        i += 1; // skip second `*`
                    }
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
    Regex::new(&format!("^{regex_str}$"))
        .unwrap_or_else(|_| Regex::new(".*").expect("infallible: .* is always a valid regex"))
}

/// Format a Unix timestamp (ms or seconds) into a human-readable string.
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
    use crate::conversation::adapter::{ParsedMessage, ParsedMeta};
    use std::path::{Path, PathBuf};
    use tempfile::TempDir;

    /// 用于测试的内存适配器，从 JSONL fixture 文件中读取数据
    struct TestAdapter {
        agent_id: String,
        root: PathBuf,
        file_pattern: String,
        /// 解析次数（验证分页复用缓存、文件变动时失效）
        parse_calls: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    }

    impl TestAdapter {
        fn new(agent_id: &str, root: PathBuf) -> Self {
            Self {
                agent_id: agent_id.to_string(),
                root,
                file_pattern: "*.jsonl".to_string(),
                parse_calls: std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            }
        }

        fn counting(mut self, counter: std::sync::Arc<std::sync::atomic::AtomicUsize>) -> Self {
            self.parse_calls = counter;
            self
        }

        fn read_jsonl_entries(path: &Path) -> Result<Vec<serde_json::Value>> {
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
            let entries = Self::read_jsonl_entries(file_path)?;
            let first = entries.first().context("Empty file")?;

            let native_session_id = file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();

            let title = first.get("content").and_then(|c| c.as_str()).map(|s| {
                let truncated: String = s.chars().take(80).collect();
                truncated
            });

            let started_at = first.get("timestamp").and_then(|t| t.as_i64()).unwrap_or(0);

            let updated_at = entries
                .last()
                .and_then(|e| e.get("timestamp"))
                .and_then(|t| t.as_i64())
                .unwrap_or(started_at);

            let message_count = u32::try_from(entries.len()).expect("entry count fits u32");

            let project_path = first
                .get("project_path")
                .and_then(|p| p.as_str())
                .map(|s| s.to_string());

            Ok(ParsedMeta {
                native_session_id,
                title,
                first_user_message: None,
                recent_messages: Vec::new(),
                model: None,
                started_at,
                updated_at,
                message_count,
                project_path,
            })
        }

        fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
            self.parse_calls
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let entries = Self::read_jsonl_entries(file_path)?;
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
                let timestamp = entry.get("timestamp").and_then(|t| t.as_i64()).unwrap_or(0);
                let raw_seq = entry
                    .get("seq")
                    .and_then(|s| s.as_u64())
                    .unwrap_or(seq as u64);
                let seq_value = u32::try_from(raw_seq).expect("seq fits u32");
                let blocks = entry
                    .get("blocks")
                    .and_then(|b| serde_json::from_value(b.clone()).ok())
                    .unwrap_or_default();
                messages.push(ParsedMessage {
                    role,
                    content,
                    blocks,
                    model: None,
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

        fn resume_command(
            &self,
            native_session_id: &str,
            _project_path: &str,
        ) -> Option<Vec<String>> {
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

        let reports = manager.scan_all(None).unwrap();
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

        let reports = manager.scan_all(None).unwrap();
        assert_eq!(reports.len(), 2);
    }

    #[test]
    fn should_list_conversations_filtered_by_project_path() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", Some("/projects/alpha"));
        create_fixture(&dir, "session-2.jsonl", Some("/projects/beta"));

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all(None).unwrap();

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
        manager.scan_all(None).unwrap();

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
        manager.scan_all(None).unwrap();

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
        manager.scan_all(None).unwrap();

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
        manager.scan_all(None).unwrap();

        let results = manager.search("", None).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn should_update_meta() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", Some("/projects/test"));

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all(None).unwrap();

        let list = manager.list(None, None).unwrap();
        let conv_id = &list[0].id;

        manager
            .update_meta(
                conv_id,
                Some("Custom Title".to_string()),
                Some(vec!["bug".to_string()]),
            )
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
        manager.scan_all(None).unwrap();

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
        manager.scan_all(None).unwrap();

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
        manager.scan_all(None).unwrap();

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

        let reports = manager.scan_all(None).unwrap();
        assert_eq!(reports[0].sessions_found, 0);
        assert!(reports[0].errors.is_empty());
    }

    // ─── L0: file_pattern nested scan contract ───

    #[test]
    fn should_normalize_basename_pattern_with_globstar_prefix() {
        assert_eq!(normalize_file_pattern("*.jsonl"), "**/*.jsonl");
        assert_eq!(
            normalize_file_pattern("rollout-*.jsonl"),
            "**/rollout-*.jsonl"
        );
        assert_eq!(normalize_file_pattern("**/*.jsonl"), "**/*.jsonl");
        assert_eq!(normalize_file_pattern("a/b/*.json"), "a/b/*.json");
        assert_eq!(normalize_file_pattern("  *.json  "), "**/*.json");
    }

    #[test]
    fn should_match_nested_and_top_level_with_globstar_pattern() {
        let re = pattern_to_regex(&normalize_file_pattern("rollout-*.jsonl"));
        assert!(re.is_match("rollout-2026-07-16T11-08-58-uuid.jsonl"));
        assert!(re.is_match("2026/07/16/rollout-2026-07-16T11-08-58-uuid.jsonl"));
        assert!(!re.is_match("2026/07/16/other.jsonl"));

        let re_jsonl = pattern_to_regex(&normalize_file_pattern("*.jsonl"));
        assert!(re_jsonl.is_match("session-1.jsonl"));
        assert!(re_jsonl.is_match("sanitized-path/session-1.jsonl"));
    }

    #[test]
    fn should_scan_nested_rollout_layout_with_basename_pattern() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("2026").join("07").join("16");
        std::fs::create_dir_all(&nested).unwrap();
        let name = "rollout-2026-07-16T11-08-58-019f68e6-1a7f-75e0-8765-84171499aa7b.jsonl";
        create_fixture(
            &dir,
            &format!("2026/07/16/{name}"),
            Some("/projects/nested"),
        );

        let mut adapter = TestAdapter::new("codex-like", dir.path().to_path_buf());
        adapter.file_pattern = "rollout-*.jsonl".to_string();
        let manager = ConversationManager::new(vec![Box::new(adapter)]);

        let reports = manager.scan_all(None).unwrap();
        assert_eq!(reports.len(), 1);
        assert_eq!(
            reports[0].sessions_found, 1,
            "basename pattern must discover nested rollout-*.jsonl"
        );
        assert!(
            reports[0].errors.is_empty(),
            "unexpected scan errors: {:?}",
            reports[0].errors
        );

        let list = manager.list(None, None).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].native_session_id.contains("rollout-"));
    }

    #[test]
    fn should_scan_nested_sanitized_path_with_star_jsonl_pattern() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("-Users-tomgs-project");
        std::fs::create_dir_all(&nested).unwrap();
        create_fixture(
            &dir,
            "-Users-tomgs-project/session-abc.jsonl",
            Some("/Users/tomgs/project"),
        );

        // Default TestAdapter pattern is `*.jsonl` (basename-only)
        let adapter = TestAdapter::new("pi-like", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);

        let reports = manager.scan_all(None).unwrap();
        assert_eq!(
            reports[0].sessions_found, 1,
            "*.jsonl must discover nested sanitized-path sessions"
        );
        let list = manager.list(Some("/Users/tomgs/project"), None).unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn should_report_zero_sessions_when_root_has_files_but_no_pattern_hits() {
        let dir = TempDir::new().unwrap();
        // File exists under root but does not match rollout-*.jsonl
        std::fs::write(dir.path().join("notes.txt"), "noise").unwrap();

        let mut adapter = TestAdapter::new("codex-like", dir.path().to_path_buf());
        adapter.file_pattern = "rollout-*.jsonl".to_string();
        let manager = ConversationManager::new(vec![Box::new(adapter)]);

        let reports = manager.scan_all(None).unwrap();
        assert_eq!(reports[0].sessions_found, 0);
        assert!(
            reports[0]
                .errors
                .iter()
                .any(|e| e.contains("scan found 0 sessions") && e.contains("files_seen=")),
            "expected observability error, got {:?}",
            reports[0].errors
        );
    }

    #[test]
    fn should_get_resume_command_even_without_project_path_when_adapter_allows() {
        // TestAdapter ignores project_path and always returns Some; scan and get_resume
        // must stay consistent (no fake "/" probe vs runtime None split).
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", None);

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all(None).unwrap();

        let list = manager.list(None, None).unwrap();
        let conv = &list[0];
        assert!(
            conv.supports_resume,
            "supports_resume must match resume_command capability even when project_path is None"
        );

        let cmd = manager.get_resume_command(&conv.id).unwrap();
        assert_eq!(
            cmd,
            Some(vec![
                "test-agent".to_string(),
                "resume".to_string(),
                conv.native_session_id.clone(),
            ])
        );
    }

    #[test]
    fn should_set_supports_resume_false_when_adapter_returns_none() {
        struct NoResumeAdapter {
            inner: TestAdapter,
        }
        impl AgentSessionAdapter for NoResumeAdapter {
            fn agent_id(&self) -> &str {
                self.inner.agent_id()
            }
            fn session_root(&self) -> PathBuf {
                self.inner.session_root()
            }
            fn file_pattern(&self) -> &str {
                self.inner.file_pattern()
            }
            fn parse_meta(&self, p: &Path) -> Result<ParsedMeta> {
                self.inner.parse_meta(p)
            }
            fn parse_messages(&self, p: &Path) -> Result<Vec<ParsedMessage>> {
                self.inner.parse_messages(p)
            }
            fn extract_session_id(&self, p: &Path) -> Option<String> {
                self.inner.extract_session_id(p)
            }
            fn resume_command(
                &self,
                _native_session_id: &str,
                _project_path: &str,
            ) -> Option<Vec<String>> {
                None
            }
        }

        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "session-1.jsonl", Some("/projects/p"));
        let manager = ConversationManager::new(vec![Box::new(NoResumeAdapter {
            inner: TestAdapter::new("test-agent", dir.path().to_path_buf()),
        })]);
        manager.scan_all(None).unwrap();
        let list = manager.list(None, None).unwrap();
        assert!(!list[0].supports_resume);
        assert!(manager.get_resume_command(&list[0].id).unwrap().is_none());
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
        create_claude_session_file(root, "-Users-tomgs-my-project", "fake-session-1.jsonl");

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
            fn resume_command(&self, sid: &str, pp: &str) -> Option<Vec<String>> {
                ClaudeCodeAdapter.resume_command(sid, pp)
            }
        }

        let adapter = TestClaudeAdapter {
            root: root.to_path_buf(),
        };
        let manager = ConversationManager::new(vec![Box::new(adapter)]);

        // 扫描
        let reports = manager.scan_all(None).unwrap();
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].sessions_found, 1);
        assert!(reports[0].errors.is_empty());

        // 列表：按 project_path 过滤
        let results = manager.list(Some("/Users/tomgs/my-project"), None).unwrap();
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
        assert_eq!(
            cmd,
            vec!["--resume", "40fb5179-2c80-45a9-8ac0-56ce8ab4178e"]
        );
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
        struct TestAdapter {
            root: PathBuf,
        }
        impl AgentSessionAdapter for TestAdapter {
            fn agent_id(&self) -> &str {
                "claude-code"
            }
            fn session_root(&self) -> PathBuf {
                self.root.clone()
            }
            fn file_pattern(&self) -> &str {
                "**/*.jsonl"
            }
            fn parse_meta(&self, p: &Path) -> Result<ParsedMeta> {
                ClaudeCodeAdapter.parse_meta(p)
            }
            fn parse_messages(&self, p: &Path) -> Result<Vec<ParsedMessage>> {
                ClaudeCodeAdapter.parse_messages(p)
            }
            fn extract_session_id(&self, p: &Path) -> Option<String> {
                ClaudeCodeAdapter.extract_session_id(p)
            }
            fn resume_command(&self, sid: &str, pp: &str) -> Option<Vec<String>> {
                ClaudeCodeAdapter.resume_command(sid, pp)
            }
        }

        let manager = ConversationManager::new(vec![Box::new(TestAdapter {
            root: dir.path().to_path_buf(),
        })]);
        manager.scan_all(None).unwrap();

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

    fn meta_with(
        native_session_id: &str,
        title: Option<&str>,
        first_user_message: Option<&str>,
    ) -> ParsedMeta {
        ParsedMeta {
            native_session_id: native_session_id.to_string(),
            title: title.map(|s| s.to_string()),
            first_user_message: first_user_message.map(|s| s.to_string()),
            model: None,
            started_at: 0,
            updated_at: 0,
            message_count: 0,
            recent_messages: Vec::new(),
            project_path: None,
        }
    }

    #[test]
    fn resolve_title_prefers_ai_title_over_user_message() {
        let meta = meta_with(
            "sess9876abcd",
            Some("AI Summary Title"),
            Some("raw user request"),
        );
        assert_eq!(
            resolve_title(
                meta.title.as_deref(),
                meta.first_user_message.as_deref(),
                "claude-code",
                "sess9876abcd"
            ),
            "AI Summary Title"
        );
    }

    #[test]
    fn resolve_title_falls_back_to_user_message() {
        let meta = meta_with(
            "sess9876abcd",
            None,
            Some("  help me fix the <system-reminder>secret</system-reminder> bug  "),
        );
        assert_eq!(
            resolve_title(
                meta.title.as_deref(),
                meta.first_user_message.as_deref(),
                "claude-code",
                "sess9876abcd"
            ),
            "help me fix the bug"
        );
    }

    #[test]
    fn resolve_title_falls_back_to_agent_and_session_id() {
        let meta = meta_with("sess9876abcd", None, None);
        assert_eq!(
            resolve_title(
                meta.title.as_deref(),
                meta.first_user_message.as_deref(),
                "opencode",
                "sess9876abcd"
            ),
            "opencode sess9876"
        );
    }

    #[test]
    fn should_reuse_file_meta_cache_on_second_scan_and_preserve_user_edits() {
        crate::conversation::scan_cache::reset_scan_parse_cache_for_tests();
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "sess-cache.jsonl", Some("/proj/a"));
        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);

        let first = manager.scan_all(None).unwrap();
        assert_eq!(first[0].sessions_found, 1);
        let id = manager.list(None, None).unwrap()[0].id.clone();
        manager
            .update_meta(&id, Some("My Title".into()), Some(vec!["tag1".into()]))
            .unwrap();

        // Second scan: fingerprint hit path should still restore user_title/tags.
        let second = manager.scan_all(None).unwrap();
        assert_eq!(second[0].sessions_found, 1);
        let listed = manager.list(None, None).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].user_title.as_deref(), Some("My Title"));
        assert_eq!(listed[0].tags, vec!["tag1".to_string()]);
    }

    #[test]
    fn matches_project_path_requires_boundary_and_non_empty_session() {
        assert!(matches_project_path(Some("/proj"), "/proj"));
        assert!(matches_project_path(Some("/proj/"), "/proj"));
        assert!(matches_project_path(Some("/proj/sub"), "/proj"));
        assert!(!matches_project_path(Some("/proj-other"), "/proj"));
        assert!(!matches_project_path(None, "/proj"));
        assert!(!matches_project_path(Some(""), "/proj"));
        assert!(!matches_project_path(Some("/proj"), ""));
    }

    #[test]
    fn should_scope_walk_to_discovery_roots_only() {
        use crate::conversation::adapter::{ParsedMessage, ParsedMeta};
        use std::path::{Path, PathBuf};
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        struct ScopedAdapter {
            root: PathBuf,
            parse_calls: Arc<AtomicUsize>,
        }

        impl AgentSessionAdapter for ScopedAdapter {
            fn agent_id(&self) -> &str {
                "scoped-test"
            }
            fn session_root(&self) -> PathBuf {
                self.root.clone()
            }
            fn file_pattern(&self) -> &str {
                "*.jsonl"
            }
            fn discovery_roots(&self, project_path: Option<&str>) -> Option<Vec<PathBuf>> {
                crate::conversation::scope::discovery_roots_for(
                    self.root.clone(),
                    project_path,
                    crate::conversation::scope::EncodeStyle::Claude,
                )
            }
            fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
                self.parse_calls.fetch_add(1, Ordering::SeqCst);
                let project = file_path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string());
                Ok(ParsedMeta {
                    native_session_id: file_path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("x")
                        .to_string(),
                    title: Some("t".into()),
                    first_user_message: None,
                    recent_messages: vec![],
                    model: None,
                    started_at: 1,
                    updated_at: 2,
                    message_count: 1,
                    project_path: project,
                })
            }
            fn parse_messages(&self, _file_path: &Path) -> Result<Vec<ParsedMessage>> {
                Ok(vec![])
            }
            fn extract_session_id(&self, file_path: &Path) -> Option<String> {
                file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            }
            fn resume_command(&self, _id: &str, _pp: &str) -> Option<Vec<String>> {
                None
            }
        }

        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let in_scope = root.join("-Users-tomgs-proj");
        let out_scope = root.join("-Users-tomgs-other");
        std::fs::create_dir_all(&in_scope).unwrap();
        std::fs::create_dir_all(&out_scope).unwrap();
        std::fs::write(
            in_scope.join("a.jsonl"),
            "{}
",
        )
        .unwrap();
        std::fs::write(
            out_scope.join("b.jsonl"),
            "{}
",
        )
        .unwrap();

        let parse_calls = Arc::new(AtomicUsize::new(0));
        let manager = ConversationManager::new(vec![Box::new(ScopedAdapter {
            root: root.to_path_buf(),
            parse_calls: parse_calls.clone(),
        })]);

        let reports = manager
            .scan_all(Some("/Users/tomgs/proj"))
            .expect("scoped scan");
        assert_eq!(reports[0].sessions_found, 1);
        assert_eq!(
            parse_calls.load(Ordering::SeqCst),
            1,
            "must not parse out-of-scope project dir"
        );

        let page = manager
            .list_page(Some("/Users/tomgs/proj"), None, 0, 10)
            .unwrap();
        // project_path from dir name is sanitized form, list filter uses session project_path
        // Our parse sets project_path to dir name; matches_project_path won't match.
        // Still assert cache size via unfiltered list.
        let all = manager.list(None, None).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].native_session_id, "a");
        let _ = page;
    }

    #[test]
    fn should_skip_disabled_agents_via_scan_agents_filter() {
        use crate::conversation::adapter::{ParsedMessage, ParsedMeta};
        use std::path::{Path, PathBuf};
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        struct CountingAdapter {
            id: String,
            root: PathBuf,
            calls: Arc<AtomicUsize>,
        }

        impl AgentSessionAdapter for CountingAdapter {
            fn agent_id(&self) -> &str {
                &self.id
            }
            fn session_root(&self) -> PathBuf {
                self.root.clone()
            }
            fn file_pattern(&self) -> &str {
                "*.jsonl"
            }
            fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
                self.calls.fetch_add(1, Ordering::SeqCst);
                Ok(ParsedMeta {
                    native_session_id: file_path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("x")
                        .to_string(),
                    title: Some("t".into()),
                    first_user_message: None,
                    recent_messages: vec![],
                    model: None,
                    started_at: 1,
                    updated_at: 2,
                    message_count: 1,
                    project_path: Some("/p".into()),
                })
            }
            fn parse_messages(&self, _: &Path) -> Result<Vec<ParsedMessage>> {
                Ok(vec![])
            }
            fn extract_session_id(&self, _: &Path) -> Option<String> {
                None
            }
            fn resume_command(&self, _: &str, _: &str) -> Option<Vec<String>> {
                None
            }
        }

        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("s.jsonl"),
            "{}
",
        )
        .unwrap();
        let calls_a = Arc::new(AtomicUsize::new(0));
        let calls_b = Arc::new(AtomicUsize::new(0));
        let manager = ConversationManager::new(vec![
            Box::new(CountingAdapter {
                id: "agent-a".into(),
                root: dir.path().to_path_buf(),
                calls: calls_a.clone(),
            }),
            Box::new(CountingAdapter {
                id: "agent-b".into(),
                root: dir.path().to_path_buf(),
                calls: calls_b.clone(),
            }),
        ]);

        let only = vec!["agent-a".to_string()];
        let reports = manager.scan_agents(None, Some(&only)).unwrap();
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].agent_id, "agent-a");
        assert_eq!(calls_a.load(Ordering::SeqCst), 1);
        assert_eq!(calls_b.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn should_exclude_sessions_without_project_path_when_filtering() {
        let dir = TempDir::new().unwrap();
        create_fixture(&dir, "with-project.jsonl", Some("/projects/alpha"));
        create_fixture(&dir, "no-project.jsonl", None);

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all(None).unwrap();

        let all = manager.list(None, None).unwrap();
        assert_eq!(all.len(), 2);

        let filtered = manager.list(Some("/projects/alpha"), None).unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].project_path.as_deref(), Some("/projects/alpha"));
    }

    #[test]
    fn should_page_list_with_has_more() {
        let dir = TempDir::new().unwrap();
        // Distinct names so three sessions land in cache.
        create_fixture(&dir, "s1.jsonl", Some("/projects/p"));
        create_fixture(&dir, "s2.jsonl", Some("/projects/p"));
        create_fixture(&dir, "s3.jsonl", Some("/projects/p"));

        let adapter = TestAdapter::new("test-agent", dir.path().to_path_buf());
        let manager = ConversationManager::new(vec![Box::new(adapter)]);
        manager.scan_all(None).unwrap();

        let page0 = manager.list_page(Some("/projects/p"), None, 0, 2).unwrap();
        assert_eq!(page0.items.len(), 2);
        assert_eq!(page0.total, 3);
        assert_eq!(page0.offset, 0);
        assert_eq!(page0.limit, 2);
        assert!(page0.has_more);

        let page1 = manager.list_page(Some("/projects/p"), None, 2, 2).unwrap();
        assert_eq!(page1.items.len(), 1);
        assert_eq!(page1.total, 3);
        assert!(!page1.has_more);

        // limit=0 returns all remaining from offset.
        let all = manager.list_page(Some("/projects/p"), None, 0, 0).unwrap();
        assert_eq!(all.items.len(), 3);
        assert!(!all.has_more);
    }

    /// 生成 tests fixture：每行一条消息（TestAdapter 直读 content/timestamp）。
    fn write_fixture(dir: &Path, name: &str, count: u32) -> PathBuf {
        let path = dir.join(name);
        let mut body = String::new();
        for i in 0..count {
            body.push_str(&format!(
                r#"{{"role":"user","content":"m{i}","timestamp":{}}}"#,
                1_700_000_000_000i64 + i64::from(i)
            ));
            body.push('\n');
        }
        std::fs::write(&path, body).unwrap();
        path
    }

    /// 工具调用清单有上限：计数保持精确，清单截断并打标（红线 4）。
    #[test]
    fn should_cap_tool_call_list_but_keep_exact_count() {
        let mut blocks = Vec::new();
        for i in 0..(MAX_TOOL_CALL_REFS + 5) {
            blocks.push(
                serde_json::from_value(serde_json::json!({
                    "type": "toolUse",
                    "id": format!("c{i}"),
                    "name": "Bash",
                    "input": { "command": "ls" }
                }))
                .expect("valid block"),
            );
        }
        let messages = vec![ConversationMessage {
            role: "assistant".into(),
            content: "many tools".into(),
            blocks,
            model: None,
            timestamp: 0,
            seq: 0,
        }];

        let stats = summarize_transcript(&messages);
        assert_eq!(stats.tool_calls as usize, MAX_TOOL_CALL_REFS + 5);
        assert_eq!(stats.tool_call_list.len(), MAX_TOOL_CALL_REFS);
        assert!(stats.tool_call_list_truncated);
    }

    /// 非 ASCII / 大小写混排时片段不能错位（`to_lowercase` 会改变字节长度）。
    #[test]
    fn should_snippet_non_ascii_matches_without_corruption() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("unicode.jsonl");
        let body = [
            r#"{"role":"user","content":"İstanbul 会话：请 ROTATE 这个密钥","timestamp":1}"#,
            r#"{"role":"assistant","content":"已按 rotate 处理","timestamp":2}"#,
        ]
        .join("\n");
        std::fs::write(&path, format!("{body}\n")).unwrap();

        let manager = ConversationManager::new(vec![Box::new(TestAdapter::new(
            "pi",
            dir.path().to_path_buf(),
        ))]);
        manager.scan_all(None).unwrap();
        let id = manager.list(None, None).unwrap()[0].id.clone();

        let hits = manager.search_messages(&id, "rotate").unwrap();
        assert_eq!(
            hits.len(),
            2,
            "case-insensitive match on both turns: {hits:?}"
        );
        assert!(
            hits[0].snippet.contains("ROTATE"),
            "snippet={:?}",
            hits[0].snippet
        );
        assert!(
            hits[0].snippet.contains("İstanbul") || hits[0].snippet.contains("会话"),
            "snippet must keep neighbouring text: {:?}",
            hits[0].snippet
        );
    }

    /// 尾页起点：方向相反、同样至少 1 条。
    #[test]
    fn should_compute_tail_page_start() {
        let messages: Vec<ConversationMessage> = (0..900u32)
            .map(|i| message_of(i, format!("m{i}")))
            .collect();
        assert_eq!(page_start_from_end(&messages, messages.len()), 100);
        assert_eq!(page_start_from_end(&messages, 300), 0);
        assert_eq!(page_start_from_end(&messages, 0), 0);

        let huge = vec![message_of(0, "x".repeat(MESSAGE_PAGE_BYTE_BUDGET * 2))];
        assert_eq!(page_start_from_end(&huge, 1), 0);
    }

    fn write_rich_fixture(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        let body = [
            r#"{"role":"user","content":"please run the tests","timestamp":1700000000001}"#,
            r#"{"role":"assistant","content":"running","timestamp":1700000000002,"blocks":[{"type":"thinking","thinking":"plan"},{"type":"toolUse","id":"c1","name":"Bash","input":{"command":"pnpm test"}}]}"#,
            r#"{"role":"assistant","content":"also read","timestamp":1700000000003,"blocks":[{"type":"toolUse","id":"c2","name":"Read","input":{"file_path":"src/lib.rs"}}]}"#,
            r#"{"role":"user","content":"thanks, run the tests again","timestamp":1700000000004}"#,
        ]
        .join("\n");
        std::fs::write(&path, format!("{body}\n")).unwrap();
        path
    }

    #[test]
    fn should_report_stats_from_backend() {
        let dir = TempDir::new().unwrap();
        write_rich_fixture(dir.path(), "stats.jsonl");
        let manager = ConversationManager::new(vec![Box::new(TestAdapter::new(
            "pi",
            dir.path().to_path_buf(),
        ))]);
        manager.scan_all(None).unwrap();
        let id = manager.list(None, None).unwrap()[0].id.clone();

        let stats = manager.conversation_stats(&id).unwrap();
        assert_eq!(stats.total_messages, 4);
        assert_eq!(stats.tool_calls, 2);
        assert_eq!(stats.thinking_count, 1);
        assert_eq!(
            stats.unique_tools,
            vec!["Bash".to_string(), "Read".to_string()]
        );
        assert_eq!(stats.tool_call_list[0].seq, 1);
        assert_eq!(stats.tool_call_list[0].block_idx, 1);
        assert_eq!(stats.tool_call_list[0].summary, "pnpm test");
        assert_eq!(stats.tool_call_list[1].summary, "src/lib.rs");
        assert!(!stats.tool_call_list_truncated);
    }

    #[test]
    fn should_search_messages_without_returning_bodies() {
        let dir = TempDir::new().unwrap();
        write_rich_fixture(dir.path(), "search.jsonl");
        let manager = ConversationManager::new(vec![Box::new(TestAdapter::new(
            "pi",
            dir.path().to_path_buf(),
        ))]);
        manager.scan_all(None).unwrap();
        let id = manager.list(None, None).unwrap()[0].id.clone();

        let hits = manager.search_messages(&id, "TESTS").unwrap();
        assert_eq!(hits.len(), 2, "case-insensitive match on both user turns");
        assert_eq!(hits[0].seq, 0);
        assert_eq!(hits[1].seq, 3);
        assert!(hits[0].snippet.contains("tests"));
        assert!(hits[0].snippet.len() < 200, "snippet must stay short");

        assert!(manager.search_messages(&id, "   ").unwrap().is_empty());
        assert!(manager
            .search_messages(&id, "no-such-text")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn should_summarise_tool_calls_like_the_frontend() {
        let args = |value: serde_json::Value| value;
        assert_eq!(
            tool_call_summary("Read", &args(serde_json::json!({ "file_path": "a.rs" }))),
            "a.rs"
        );
        assert_eq!(
            tool_call_summary("Edit", &args(serde_json::json!({ "path": "b.rs" }))),
            "b.rs"
        );
        assert_eq!(
            tool_call_summary("Bash", &args(serde_json::json!({ "command": "pnpm test" }))),
            "pnpm test"
        );
        assert_eq!(
            tool_call_summary("Grep", &args(serde_json::json!({ "pattern": "useEffect" }))),
            "useEffect"
        );
        assert_eq!(
            tool_call_summary("CustomTool", &args(serde_json::json!({ "a": 1 }))),
            r#"{"a":1}"#
        );
        // 超长摘要按字符边界截断（不 panic、不切坏 UTF-8）
        let long = tool_call_summary(
            "Bash",
            &args(serde_json::json!({ "command": "x".repeat(500) })),
        );
        assert!(long.chars().count() <= 123, "got {long}");
        assert!(long.ends_with("..."));
    }

    #[test]
    fn should_page_from_the_tail() {
        let dir = TempDir::new().unwrap();
        write_fixture(dir.path(), "tail.jsonl", 900);
        let manager = ConversationManager::new(vec![Box::new(TestAdapter::new(
            "pi",
            dir.path().to_path_buf(),
        ))]);
        manager.scan_all(None).unwrap();
        let id = manager.list(None, None).unwrap()[0].id.clone();

        let tail = manager.get_messages_page_from_end(&id, 0).unwrap();
        assert_eq!(tail.total, 900);
        assert!(tail.has_more, "earlier messages still exist");
        assert_eq!(
            tail.items.last().map(|m| m.content.clone()),
            Some("m899".to_string())
        );

        let earlier = manager
            .get_messages_page_from_end(&id, u32::try_from(tail.items.len()).unwrap())
            .unwrap();
        assert_eq!(earlier.offset, 0);
        assert!(!earlier.has_more);
        // 两页拼起来正好覆盖全部，且无重叠
        assert_eq!(earlier.items.len() + tail.items.len(), 900);
        assert_eq!(earlier.items.last().map(|m| m.seq), Some(99));
    }

    /// 红线 4 端到端：分页拼接 = 全量，且各项分页元信息自洽。
    #[test]
    fn should_page_messages_end_to_end() {
        let dir = TempDir::new().unwrap();
        write_fixture(dir.path(), "s1.jsonl", 900);
        let manager = ConversationManager::new(vec![Box::new(TestAdapter::new(
            "pi",
            dir.path().to_path_buf(),
        ))]);
        manager.scan_all(None).unwrap();
        let id = manager.list(None, None).unwrap()[0].id.clone();

        let full = manager.get_messages(&id).unwrap();
        assert_eq!(full.len(), 900);

        let mut offset = 0u32;
        let mut assembled = Vec::new();
        loop {
            let page = manager.get_messages_page(&id, offset).unwrap();
            assert_eq!(page.total, 900);
            assert!(page.limit >= 1, "each page must make progress");
            assembled.extend(page.items.clone());
            if !page.has_more {
                break;
            }
            offset = page.offset + page.limit;
        }
        assert_eq!(assembled.len(), full.len());
        assert_eq!(
            assembled.iter().map(|m| m.seq).collect::<Vec<_>>(),
            full.iter().map(|m| m.seq).collect::<Vec<_>>()
        );
    }

    /// 分页只解析一次：否则每一页都要重读整份会话（实测 7 页 = 7 次全量解析）。
    #[test]
    fn should_parse_transcript_once_across_pages() {
        let dir = TempDir::new().unwrap();
        write_fixture(dir.path(), "s2.jsonl", 900);
        let counter = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let manager = ConversationManager::new(vec![Box::new(
            TestAdapter::new("pi", dir.path().to_path_buf()).counting(counter.clone()),
        )]);
        manager.scan_all(None).unwrap();
        let id = manager.list(None, None).unwrap()[0].id.clone();

        let _ = manager.get_messages_page(&id, 0).unwrap();
        let _ = manager.get_messages_page(&id, 800).unwrap();
        assert_eq!(counter.load(std::sync::atomic::Ordering::Relaxed), 1);
    }

    /// 文件增长后缓存必须失效（会话文件是 append-only，页面不能读到旧正文）。
    #[test]
    fn should_invalidate_transcript_cache_when_file_grows() {
        let dir = TempDir::new().unwrap();
        let path = write_fixture(dir.path(), "s3.jsonl", 3);
        let counter = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let manager = ConversationManager::new(vec![Box::new(
            TestAdapter::new("pi", dir.path().to_path_buf()).counting(counter.clone()),
        )]);
        manager.scan_all(None).unwrap();
        let id = manager.list(None, None).unwrap()[0].id.clone();

        assert_eq!(manager.get_messages_page(&id, 0).unwrap().total, 3);

        let mut extra = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        use std::io::Write;
        for i in 3..5 {
            writeln!(
                extra,
                r#"{{"role":"user","content":"m{i}","timestamp":{}}}"#,
                1_700_000_000_000i64 + i64::from(i)
            )
            .unwrap();
        }
        drop(extra);

        assert_eq!(manager.get_messages_page(&id, 0).unwrap().total, 5);
        assert_eq!(counter.load(std::sync::atomic::Ordering::Relaxed), 2);
    }

    fn message_of(seq: u32, content: String) -> ConversationMessage {
        ConversationMessage {
            role: if seq.is_multiple_of(2) {
                "user".into()
            } else {
                "assistant".into()
            },
            content,
            blocks: Vec::new(),
            model: None,
            timestamp: i64::from(seq),
            seq,
        }
    }

    /// 红线 4：单页条数上限守住传输边界。
    #[test]
    fn should_cap_page_by_item_limit() {
        let count = saturating_count(MESSAGE_PAGE_MAX_ITEMS) + 100;
        let messages: Vec<ConversationMessage> =
            (0..count).map(|i| message_of(i, format!("m{i}"))).collect();
        assert_eq!(page_end(&messages, 0), MESSAGE_PAGE_MAX_ITEMS);
        assert_eq!(page_end(&messages, MESSAGE_PAGE_MAX_ITEMS), messages.len());
    }

    /// 超大单条消息也必须成页（否则 offset 不前进，前端会死循环）。
    #[test]
    fn should_keep_at_least_one_message_per_page() {
        let huge = "x".repeat(MESSAGE_PAGE_BYTE_BUDGET * 2);
        let messages = vec![message_of(0, huge), message_of(1, "small".into())];
        assert_eq!(page_end(&messages, 0), 1);
        assert_eq!(page_end(&messages, 1), 2);
    }

    #[test]
    fn should_respect_byte_budget() {
        // 每条 ~4KB → 预算（1.5MB）先于条数上限（800）触发
        let body = "y".repeat(4000);
        let messages: Vec<ConversationMessage> =
            (0..2000u32).map(|i| message_of(i, body.clone())).collect();
        let end = page_end(&messages, 0);
        assert!(end > 1, "budget must allow more than one message");
        assert!(end < MESSAGE_PAGE_MAX_ITEMS, "byte budget must bind first");
    }

    #[test]
    fn should_clamp_offset_past_end() {
        let messages = vec![message_of(0, "only".into())];
        assert_eq!(page_end(&messages, 5), 1);
        assert_eq!(page_end(&[], 0), 0);
    }

    /// 回归：首条用户消息带图片引用时，标题不得退化成图片 blob URI 或 `[Image #N]` 占位符。
    #[test]
    fn should_not_leak_image_reference_into_title() {
        let placeholder = resolve_title(
            None,
            Some("[Image #1] \n\n历史会话中显示的不是标题而是一串ID"),
            "pi",
            "01a187b7-f5da",
        );
        assert_eq!(placeholder, "历史会话中显示的不是标题而是一串ID");

        let expanded = resolve_title(
            None,
            Some("[[Image #1]](file:///Users/t/.pi/agent/image-view/blobs/32b9.png)\n\n同一个问题"),
            "pi",
            "01a187b7-f5da",
        );
        assert_eq!(expanded, "同一个问题");
        assert!(!expanded.contains("file://"));
    }

    /// 回归：纯图片回合不能作为标题素材，必须继续落到兜底。
    #[test]
    fn should_fall_back_when_first_message_is_image_only() {
        let title = resolve_title(None, Some("[Image #1]"), "pi", "01a187b7-f5da");
        assert_eq!(title, "pi 01a187b7");
    }
}
