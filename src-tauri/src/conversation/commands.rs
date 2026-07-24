use crate::conversation::types::{
    ConversationListPage, ConversationMessage, ConversationMeta, ScanReport,
};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Scan agents for conversations, updating the in-memory cache.
///
/// Prefer passing `project_path` so bulk adapters (OpenCode) can restrict discovery
/// to the active project. Async + `block_in_place` keeps heavy WalkDir / SQLite
/// work off the cooperative async worker.
#[tauri::command]
pub async fn scan_conversations(
    agent_id: Option<String>,
    project_path: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<ScanReport>, AppError> {
    tokio::task::block_in_place(|| match agent_id {
        Some(aid) => {
            let report = state
                .conversation_manager
                .scan_agent(&aid, project_path.as_deref())
                .map_err(AppError::from)?;
            Ok(vec![report])
        }
        None => state
            .conversation_manager
            .scan_all(project_path.as_deref())
            .map_err(AppError::from),
    })
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
        .map_err(AppError::from)
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
