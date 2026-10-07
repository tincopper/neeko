//! 非目标平台默认 stub：无系统字体枚举实现。

/// 非 macOS / Windows / Linux 平台无字体枚举，返回空列表。
#[must_use]
pub const fn get_system_fonts() -> Vec<String> {
    Vec::new()
}
