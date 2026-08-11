//! Windows file:// URI 路径解析。

use std::path::PathBuf;

/// 将 file:// URI scheme 之后的部分转换为 Windows 原生路径。
///
/// 去除前导斜杠("/C:/repo" → "C:/repo"),然后 percent-decode 支持空格与非 ASCII 文件名。
#[must_use]
pub fn file_url_to_path(rest: &str) -> Option<PathBuf> {
    let trimmed = rest.strip_prefix('/').unwrap_or(rest);
    let decoded = urlencoding::decode(trimmed).ok()?;
    Some(PathBuf::from(decoded.as_ref()))
}
