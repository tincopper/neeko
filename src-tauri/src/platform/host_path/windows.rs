/// Windows：合并当前 PATH 与系统默认 PATH。
#[must_use]
pub fn resolve_host_path() -> String {
    crate::common::utils::command::local::resolve_full_path()
}
