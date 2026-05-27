# Fix Error Handling — unwrap panics + silent swallowing

## Goals
1. Replace `.lock().unwrap()` with `.lock().map_err(AppError::from)?` to prevent panic on poisoned lock
2. Return `Result` from mutating commands that currently return `()`
3. Stop `.unwrap_or_default()` from silently swallowing lock failures
