//! Windows 技能目录链接:目录递归复制(Windows 无原生 symlink 语义)。

use std::path::Path;

use crate::AppError;

/// 递归复制 `source` 目录到 `dest`(Windows 下降级为复制)。
pub fn create_link(source: &Path, dest: &Path) -> Result<(), AppError> {
    crate::library::skill::sync_engine::copy_dir_recursive(source, dest).map_err(AppError::from)
}
