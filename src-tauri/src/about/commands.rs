//! About 域 Tauri 命令层（极薄：只做取数 + 调度，无业务逻辑）。

use crate::about::services::{build_app_info, AppInfo};
use crate::AppError;

/// 查询应用版本与元数据信息（About 页数据源）。
#[tauri::command]
pub fn get_app_info(app: tauri::AppHandle) -> Result<AppInfo, AppError> {
    let info = app.package_info();
    let config = app.config();
    let authors = (!info.authors.is_empty()).then(|| info.authors.to_string());
    let description = (!info.description.is_empty()).then(|| info.description.to_string());
    Ok(build_app_info(
        info.name.clone(),
        info.version.to_string(),
        config.identifier.clone(),
        description,
        authors,
        config.bundle.copyright.clone(),
    ))
}
