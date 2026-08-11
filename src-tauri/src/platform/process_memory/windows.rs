/// Windows：tasklist 不易直接获取 RSS（需 PowerShell），v1 跳过。
#[must_use]
pub const fn sample_process_memory_mb(_pid: u32) -> Option<f64> {
    None
}
