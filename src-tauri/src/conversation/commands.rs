use crate::conversation::manager::ScanProgressEvent;
use crate::conversation::types::{
    ConversationListPage, ConversationMessage, ConversationMeta, ScanReport,
};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::{AppHandle, Emitter, State};

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
/// Prefer passing `project_path` so bulk adapters (OpenCode) and path-encoded
/// adapters (Claude / Pi / OMP / Reasonix) can restrict discovery to the active
/// project. Async + `block_in_place` keeps heavy WalkDir / SQLite work off the
/// cooperative async worker.
///
/// When `agent_id` is `None`, only **enabled** agents from the agent registry
/// are scanned (disabled agents are skipped).
///
/// Emits `conversation-scan-progress` events while scanning:
/// `{ agentId, phase: "start"|"done"|"error", sessionsFound, projectPath }`.
#[tauri::command]
pub async fn scan_conversations(
    agent_id: Option<String>,
    project_path: Option<String>,
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

    let result = tokio::task::block_in_place(|| match agent_id {
        Some(aid) => {
            let report = state
                .conversation_manager
                .scan_agent(&aid, project_path.as_deref())
                .map_err(AppError::from)?;
            Ok(vec![report])
        }
        None => {
            let only = enabled_scan_agent_ids(&state);
            state
                .conversation_manager
                .scan_agents(project_path.as_deref(), only.as_deref())
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

/// List cached conversations, optionally filtered by project or agent.
///
/// When `limit` is omitted or `0`, returns all matches (legacy full list).
/// With a positive `limit`, returns a page for infinite scroll.
#[tauri::command]
pub fn list_conversations(
    project_path: Option<String>,
    agent_id: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
    state: State<AppStateWrapper>,
) -> Result<ConversationListPage, AppError> {
    // Cold-start hydrate: load disk index into memory once if cache is empty.
    let _ = state
        .conversation_manager
        .hydrate_from_disk_index_if_empty();

    state
        .conversation_manager
        .list_page(
            project_path.as_deref(),
            agent_id.as_deref(),
            offset.unwrap_or(0),
            limit.unwrap_or(0),
        )
        .map_err(AppError::from)
}

/// Get full messages for a conversation by its ID.
#[tauri::command]
pub fn get_conversation_messages(
    id: String,
    state: State<AppStateWrapper>,
) -> Result<Vec<ConversationMessage>, AppError> {
    state
        .conversation_manager
        .get_messages(&id)
        .map_err(AppError::from)
}

/// Search conversations by title or preview text.
#[tauri::command]
pub fn search_conversations(
    query: String,
    project_path: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<Vec<ConversationMeta>, AppError> {
    let _ = state
        .conversation_manager
        .hydrate_from_disk_index_if_empty();

    state
        .conversation_manager
        .search(&query, project_path.as_deref())
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
#[tauri::command]
pub fn export_conversation(id: String, state: State<AppStateWrapper>) -> Result<String, AppError> {
    state
        .conversation_manager
        .export_markdown(&id)
        .map_err(AppError::from)
}
