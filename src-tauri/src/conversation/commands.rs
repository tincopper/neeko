use crate::conversation::types::{ConversationMessage, ConversationMeta, ScanReport};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

/// Scan all registered agents for conversations, updating the cache.
///
/// Async + `block_in_place` so heavy WalkDir / SQLite work yields the async
/// worker's cooperative duties instead of looking like a hung IPC handler.
/// The frontend fishbone path hydrates via `list_conversations` first, so scan
/// is always on the background rib.
#[tauri::command]
pub async fn scan_conversations(
    agent_id: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<ScanReport>, AppError> {
    tokio::task::block_in_place(|| match agent_id {
        Some(aid) => {
            let report = state
                .conversation_manager
                .scan_agent(&aid)
                .map_err(AppError::from)?;
            Ok(vec![report])
        }
        None => state.conversation_manager.scan_all().map_err(AppError::from),
    })
}

/// List cached conversations, optionally filtered by project or agent.
#[tauri::command]
pub fn list_conversations(
    project_path: Option<String>,
    agent_id: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<Vec<ConversationMeta>, AppError> {
    state
        .conversation_manager
        .list(project_path.as_deref(), agent_id.as_deref())
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
