use crate::conversation::manager::{ListScope, ScanProgressEvent};
use crate::conversation::types::{
    ConversationListPage, ConversationListScope, ConversationMessagePage, ConversationMeta,
    ConversationSearchHit, ConversationStats, ScanReport,
};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Resolve agent ids that should participate in a full multi-agent scan.
///
/// - Prefer enabled agents from `AgentManager`.
/// - If the registry is empty or yields no overlap with conversation adapters,
///   fall back to scanning every registered adapter (safe default).
fn enabled_scan_agent_ids(state: &AppStateWrapper) -> Option<Vec<String>> {
    let Ok(am) = state.agent_manager.lock() else {
        return None;
    };
    let enabled: Vec<String> = am
        .get_agents()
        .iter()
        .filter(|a| a.enabled)
        .map(|a| a.id.clone())
        .collect();
    if enabled.is_empty() {
        None
    } else {
        Some(enabled)
    }
}

/// Scan agents for conversations, updating the in-memory cache.
///
/// Prefer passing `project_id` so bulk adapters (OpenCode) and path-encoded
/// adapters (Claude / Pi / OMP / Reasonix) can restrict discovery to that project —
/// **all** of its registered roots (main checkout + every linked worktree), not just
/// one path. Async + `block_in_place` keeps heavy WalkDir / SQLite work off the
/// cooperative async worker.
///
/// When `agent_id` is `None`, only **enabled** agents from the agent registry
/// are scanned (disabled agents are skipped).
///
/// Emits `conversation-scan-progress` events while scanning:
/// `{ agentId, phase: "start"|"done"|"error", sessionsFound, projectPath }` —
/// `projectPath` 是**显示用**的代表根（项目根），不是范围判据。
#[tauri::command]
pub async fn scan_conversations(
    agent_id: Option<String>,
    project_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<ScanReport>, AppError> {
    // Progress bridge: manager → Tauri event (process-local handler, cleared after).
    {
        let app_handle = app.clone();
        state
            .conversation_manager
            .set_scan_progress_handler(Some(Box::new(move |event: ScanProgressEvent| {
                if let Err(e) = app_handle.emit("conversation-scan-progress", &event) {
                    log::debug!("conversation-scan-progress emit failed: {e}");
                }
            })));
    }

    // 项目身份 → 根集合（唯一解析入口）。`None` = 全量遍历（既有语义）。
    // 解析含 `git worktree list`（阻塞 I/O，内部已在阻塞池里）⇒ 必须在 `block_in_place` 之前。
    let roots: Option<Vec<std::path::PathBuf>> = match &project_id {
        Some(id) => Some(state.project_scope(id).await?.roots().to_vec()),
        None => None,
    };

    let result = tokio::task::block_in_place(|| match agent_id {
        Some(aid) => {
            let report = state
                .conversation_manager
                .scan_agent(&aid, roots.as_deref())
                .map_err(AppError::from)?;
            Ok(vec![report])
        }
        None => {
            let only = enabled_scan_agent_ids(&state);
            state
                .conversation_manager
                .scan_agents(roots.as_deref(), only.as_deref())
                .map_err(AppError::from)
        }
    });

    state.conversation_manager.set_scan_progress_handler(None);

    // Best-effort cold-start index refresh after successful scan.
    if result.is_ok() {
        if let Err(e) = state.conversation_manager.persist_disk_index() {
            log::warn!("persist conversation disk index failed: {e:#}");
        }
    }

    result
}

/// List cached conversations for **one explicit scope** (project or workspace unit).
///
/// When `limit` is omitted or `0`, returns all matches (legacy full list).
/// With a positive `limit`, returns a page for infinite scroll.
///
/// `scope` 是单值判别联合（[`ConversationListScope`]），不是「两个可选过滤参数」：
/// 项目级与单元级对同一条会话的 `cwd` 给出**不同**答案，并存就必须定优先级 ——
/// 那条隐式优先级会让「调用方要单元、却被按项目过滤」的请求静默通过。
/// 项目级收**项目身份**，根集合由 [`AppStateWrapper::project_scope`] 解析；
/// 单元级的根由 [`AppStateWrapper::resolve_unit_scope`] 解析（两处都是各自唯一的校验入口）。
#[tauri::command]
pub async fn list_conversations(
    scope: ConversationListScope,
    agent_id: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
    state: State<'_, AppStateWrapper>,
) -> Result<ConversationListPage, AppError> {
    // Cold-start hydrate: load disk index into memory once if cache is empty.
    // 阻塞 fs ⇒ 与 `scan_conversations` 同一模式（`block_in_place`，红线 3）。
    tokio::task::block_in_place(|| {
        let _ = state
            .conversation_manager
            .hydrate_from_disk_index_if_empty();
    });

    // 范围 → 过滤：两个变体各一条路，没有默认分支（缺哪种语义是编译期事实，不是运行时兜底）。
    let page = |filter: ListScope<'_>| {
        state.conversation_manager.list_page(
            filter,
            agent_id.as_deref(),
            offset.unwrap_or(0),
            limit.unwrap_or(0),
        )
    };
    let page = match &scope {
        ConversationListScope::Project { project_id } => {
            let project = state.project_scope(project_id).await?;
            page(ListScope::Project(&project))
        }
        ConversationListScope::Unit { workspace } => {
            // 地址 → 单元归属（唯一入口：`resolve_workspace_target` → `UnitScope::resolve`）。
            let unit = state.resolve_unit_scope(workspace).await?;
            page(ListScope::Unit(&unit))
        }
    };
    page.map_err(AppError::from)
}

/// Get one page of a conversation's messages by its ID.
///
/// 分页是**传输**边界（红线 4：单次载荷 ≤2MB），前端按 `hasMore` 组装完整正文。
/// `offset` 省略即从第一条开始。
#[tauri::command]
pub async fn get_conversation_messages(
    id: String,
    offset: Option<u32>,
    from_end: Option<bool>,
    state: State<'_, AppStateWrapper>,
) -> Result<ConversationMessagePage, AppError> {
    // 解析要读整份会话文件（实测大会话约 0.5s）：异步命令 + block_in_place 把它挪出
    // 主线程，避免打开大会话时卡住 UI 事件循环（红线 3 的同一动机）。
    tokio::task::block_in_place(|| {
        let manager = &state.conversation_manager;
        let offset = offset.unwrap_or(0);
        if from_end.unwrap_or(false) {
            manager.get_messages_page_from_end(&id, offset)
        } else {
            manager.get_messages_page(&id, offset)
        }
        .map_err(AppError::from)
    })
}

/// 正文统计（工具调用清单 / thinking 计数），避免前端为计数持有全量正文。
#[tauri::command]
pub async fn get_conversation_stats(
    id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<ConversationStats, AppError> {
    tokio::task::block_in_place(|| {
        state
            .conversation_manager
            .conversation_stats(&id)
            .map_err(AppError::from)
    })
}

/// 正文内搜索：只回传命中定位与片段（分页视图按 seq 加载定位页）。
#[tauri::command]
pub async fn search_conversation_messages(
    id: String,
    query: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<ConversationSearchHit>, AppError> {
    tokio::task::block_in_place(|| {
        state
            .conversation_manager
            .search_messages(&id, &query)
            .map_err(AppError::from)
    })
}

/// Search conversations by title or preview text.
///
/// `project_id` 是**项目身份**（不是路径）：`Some` 时只搜落在该项目任一注册根下的会话
/// （主 checkout + 全部 linked worktree），`None` = 全量。
#[tauri::command]
pub async fn search_conversations(
    query: String,
    project_id: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<ConversationMeta>, AppError> {
    // Cold-start hydrate：与 `list_conversations` 同一模式（`block_in_place`，红线 3）。
    tokio::task::block_in_place(|| {
        let _ = state
            .conversation_manager
            .hydrate_from_disk_index_if_empty();
    });

    let project = match &project_id {
        Some(id) => Some(state.project_scope(id).await?),
        None => None,
    };
    state
        .conversation_manager
        .search(&query, project.as_ref())
        .map_err(AppError::from)
}

/// Update user-customizable fields on a conversation (title, tags).
#[tauri::command]
pub fn update_conversation(
    id: String,
    user_title: Option<String>,
    tags: Option<Vec<String>>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .conversation_manager
        .update_meta(&id, user_title, tags)
        .map_err(AppError::from)?;

    // Keep cold index roughly in sync with user edits.
    if let Err(e) = state.conversation_manager.persist_disk_index() {
        log::warn!("persist conversation disk index after update failed: {e:#}");
    }
    Ok(())
}

/// Delete one conversation by id (红线 6：只校验 + 调度).
///
/// **只收 id，不收路径**（R2.1）：目标路径由后端从自己的缓存解析，前端永远无法指定
/// 要删哪个文件/目录——这是「任意文件删除」的唯一入口防线。
///
/// 失败不乐观：错误就原样回传（`NotFound` / `Unsupported` / `Agent(stderr)`），
/// 只有成功后才刷新冷启动索引。
#[tauri::command]
pub async fn delete_conversation(
    id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let id = id.trim();
    if id.is_empty() {
        return Err(AppError::InvalidInput(
            "conversation id is required".to_string(),
        ));
    }

    if let Err(e) = state.conversation_manager.delete(id).await {
        // 删除失败必须留痕：前端只看到一句 toast，没有日志就无从判断是「路径被拒」
        // 「文件已不存在」「CLI 非零退出」还是别的（2026-10-30 排查 pi 删除时就缺这一行）。
        log::warn!("[delete_conversation] failed for {id}: {e}");
        return Err(e);
    }

    // 成功也留痕：一次「点了没反应」的排查里，只有失败日志无法区分
    // 「没走到后端」与「走到了但成功了」—— 后者在本机表现为列表没刷新。
    log::info!("[delete_conversation] deleted {id}");

    // 冷启动索引跟着缓存走（与 `update_conversation` 同一模式）。失败只告警：
    // 磁盘已经删了，把一次索引写入失败报成「删除失败」才是误报。
    if let Err(e) = state.conversation_manager.persist_disk_index() {
        log::warn!("persist conversation disk index after delete failed: {e:#}");
    }
    Ok(())
}

/// Get the native CLI resume command for a conversation, if supported.
#[tauri::command]
pub fn get_resume_command(
    id: String,
    state: State<AppStateWrapper>,
) -> Result<Option<Vec<String>>, AppError> {
    state
        .conversation_manager
        .get_resume_command(&id)
        .map_err(AppError::from)
}

/// Export a conversation as Markdown.
/// 把整段会话以 Markdown 直接写入系统剪贴板（红线 4：不经 IPC 回传正文）。
///
/// 旧实现把 Markdown 字符串回传给前端再写剪贴板，大会话相当于一次数 MB 的 IPC 载荷。
#[tauri::command]
pub async fn copy_conversation_markdown(
    id: String,
    app: AppHandle,
    state: State<'_, AppStateWrapper>,
) -> Result<u32, AppError> {
    let markdown = tokio::task::block_in_place(|| {
        state
            .conversation_manager
            .export_markdown(&id)
            .map_err(AppError::from)
    })?;
    let chars = u32::try_from(markdown.chars().count()).unwrap_or(u32::MAX);
    app.clipboard()
        .write_text(markdown)
        .map_err(|e| AppError::Unknown(format!("clipboard write failed: {e}")))?;
    Ok(chars)
}
