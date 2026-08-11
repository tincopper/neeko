//! Windows Git 凭据助手默认值。

/// Windows 默认凭据助手:Git Credential Manager。
#[must_use]
pub const fn platform_default() -> &'static str {
    "manager"
}
