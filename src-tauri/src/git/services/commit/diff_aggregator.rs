#![allow(unused_imports, missing_docs)]

use std::path::Path;

use crate::AppError;

/// Get the diff for selected files.
pub fn get_selected_diff(project_path: &Path, file_paths: &[String]) -> Result<String, AppError> {
    if file_paths.is_empty() {
        return Err(AppError::InvalidInput(
            "No files selected. Please select files to commit first.".to_string(),
        ));
    }

    let diff = crate::common::git::local::get_diff_for_files(project_path, file_paths, 500)
        .map_err(AppError::from)?;

    if diff.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "No changes found in selected files.".to_string(),
        ));
    }

    log::info!("[AI commit] files={:?} diff_len={}", file_paths, diff.len());
    Ok(diff)
}
