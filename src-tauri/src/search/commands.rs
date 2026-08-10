//! Tauri command layer for content search.
//!
//! Kept thin per the command-layer rule: receives + validates args, resolves
//! the project target, registers cancellation, then delegates to the service.

use std::path::Path;

use tauri::State;

use crate::app_state::AppStateWrapper;
use crate::common::error::AppError;
use crate::search::services;
use crate::search::types::{SearchCursor, SearchOptions, SearchPage};

/// Run a content search within a project.
///
/// Args:
/// * `query` — literal or regex search string (empty returns an empty page).
/// * `project_id` — registered project; its environment decides local vs remote.
/// * `request_id` — monotonic id; a newer request with the same id cancels the
///   previous in-flight search (frontend increments per query change).
/// * `options` — mode / case / word / regex / include / exclude.
/// * `offset` / `limit` — pagination.
#[tauri::command]
pub async fn search_run(
    query: String,
    project_id: String,
    request_id: String,
    options: Option<SearchOptions>,
    offset: Option<u32>,
    limit: Option<u32>,
    state: State<'_, AppStateWrapper>,
) -> Result<SearchPage, AppError> {
    let opts = options.unwrap_or_default();
    if query.trim().is_empty() {
        return Ok(SearchPage {
            request_id,
            query,
            project_id,
            matches: Vec::new(),
            cursor: SearchCursor {
                offset: 0,
                total_pages: -1,
            },
            truncated: false,
        });
    }

    // Resolve project root + environment (single lock acquisition).
    let (root, target) = {
        let manager = state.project_manager.lock().map_err(AppError::from)?;
        let project = manager
            .get_project(&project_id)
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {project_id}")))?;
        (
            project.path.to_string_lossy().to_string(),
            project.environment.to_exec_target(),
        )
    };

    let root = Path::new(&root)
        .canonicalize()
        .map_err(|e| AppError::InvalidInput(format!("Invalid project root: {e}")))?;
    let root_str = root.to_string_lossy().to_string();

    let token = services::cancellations().begin(&request_id);
    let notified = token.notified();

    // Poll cancellation while the search runs; abort early if requested.
    let result = tokio::select! {
        _ = notified => {
            services::cancellations().end(&request_id);
            Err(AppError::InvalidInput(format!(
                "Search request '{request_id}' was superseded"
            )))
        }
        res = services::search(&target, &root_str, &query, &opts, offset.unwrap_or(0), limit, &request_id, &project_id) => {
            services::cancellations().end(&request_id);
            res
        }
    };
    result
}

/// Cancel an in-flight search by request id.
#[tauri::command]
pub async fn search_stop(request_id: String) -> Result<(), AppError> {
    services::cancellations().cancel(&request_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::types::SearchMode;

    #[test]
    fn empty_query_short_circuits_to_empty_page() {
        let page = SearchPage {
            request_id: "req-1".into(),
            query: String::new(),
            project_id: "p-1".into(),
            matches: Vec::new(),
            cursor: SearchCursor {
                offset: 0,
                total_pages: -1,
            },
            truncated: false,
        };
        assert!(page.matches.is_empty());
        assert!(!page.truncated);
    }

    #[test]
    fn options_default_serializes() {
        let opts = SearchOptions::default();
        let json = serde_json::to_string(&opts).unwrap();
        assert!(json.contains("\"mode\":\"Content\""));
    }

    #[test]
    fn options_file_name_mode_serializes() {
        let mut opts = SearchOptions::default();
        opts.mode = SearchMode::FileName;
        let json = serde_json::to_string(&opts).unwrap();
        assert!(json.contains("\"mode\":\"FileName\""));
    }
}
