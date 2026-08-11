//! Linux Git 凭据助手默认值。

/// Linux 默认凭据助手:libsecret。
///
/// 运行时若 libsecret 不可用,git 会自行 fallback。
#[must_use]
pub const fn platform_default() -> &'static str {
    "libsecret"
}
