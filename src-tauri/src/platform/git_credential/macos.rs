//! macOS Git 凭据助手默认值。

/// macOS 默认凭据助手:Keychain。
#[must_use]
pub const fn platform_default() -> &'static str {
    "osxkeychain"
}
