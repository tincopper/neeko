//! 非 Windows file:// URI 路径解析。

use std::path::PathBuf;

/// 将 file:// URI scheme 之后的部分转换为 Unix 原生路径。
///
/// 重解析完整 URL 让 `url` crate 校验结构,然后取原生路径。
#[must_use]
pub fn file_url_to_path(rest: &str) -> Option<PathBuf> {
    let url = url::Url::parse(&format!("file://{}", rest)).ok()?;
    url.to_file_path().ok()
}
