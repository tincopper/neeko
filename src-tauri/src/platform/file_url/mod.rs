//! file:// URI 路径解析平台差异集中化。
//!
//! 将 file:// URI 的 scheme 之后部分转换为原生文件系统路径:
//! - Windows:去除前导斜杠 + percent-decode("/C:/repo" → "C:/repo")
//! - 非 Windows:重解析完整 URL 后取原生路径

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(not(target_os = "windows"))]
mod unix;
#[cfg(not(target_os = "windows"))]
pub use unix::*;
