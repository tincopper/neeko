/// Windows：合并当前 PATH 与系统默认 PATH。
#[must_use]
pub fn resolve_host_path() -> String {
    crate::common::utils::command::local::resolve_full_path()
}

/// Windows：无 Unix 包装脚本（jdtls 下载回退仅 Unix），原样返回。
#[must_use]
pub fn prepend_neeko_bin(path: &str) -> String {
    path.to_string()
}
