//! Unix 技能目录链接:符号链接。

use std::path::Path;

use crate::AppError;

/// 创建从 `source` 到 `dest` 的符号链接。
pub fn create_link(source: &Path, dest: &Path) -> Result<(), AppError> {
    std::os::unix::fs::symlink(source, dest).map_err(AppError::from)
}
