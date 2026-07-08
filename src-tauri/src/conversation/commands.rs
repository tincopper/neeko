use crate::conversation::types::{ConversationMessage, ConversationMeta, ScanReport};
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

#[tauri::command]
pub fn scan_conversations(
    agent_id: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<Vec<ScanReport>, AppError> {
    let manager = &state.conversation_manager;
    match agent_id {
        Some(aid) => {
            let report = manager.scan_agent(&aid).map_err(AppError::from)?;
            Ok(vec![report])
        }
        None => manager.scan_all().map_err(AppError::from),
    }
}

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

#[tauri::command]
pub fn export_conversation(
    id: String,
    state: State<AppStateWrapper>,
) -> Result<String, AppError> {
    state
        .conversation_manager
        .export_markdown(&id)
        .map_err(AppError::from)
}
