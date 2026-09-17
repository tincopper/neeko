//! 有效断点：`enabled && !muted` —— **后端唯一过滤点**。
//!
//! 实时（`DapManager::set_breakpoints`）与启动/重跑（`adapter_breakpoints`）两条
//! 下发路径**都必须**走它：只堵实时路径 ⇒ mute 后 Rerun 会经启动路径把全部断点
//! 重新下发命中（打穿 mute 核心语义）。

use std::collections::BTreeMap;

use super::super::types::BreakpointSpec;

/// `line → enabled`（单个文件的断点行集）。
pub type LineSet = BTreeMap<u32, bool>;

/// 有效断点过滤 —— 后端唯一过滤点。`effective = enabled && !muted`。
#[must_use]
pub fn effective_breakpoints(breakpoints: &[BreakpointSpec], muted: bool) -> Vec<BreakpointSpec> {
    breakpoints
        .iter()
        .filter(|b| b.enabled && !muted)
        .cloned()
        .collect()
}

/// `file + line set` → 规范身份的断点列表（行号升序；`verified` 由适配器回填）。
///
/// 单一构造点：内存快照、单文件快照、mute 同步快照三处此前各自手写一遍
/// （含 `verified: false` 的重复字面量），任何字段增减都会漏改其中一处。
#[must_use]
pub fn specs_for_file(file_path: &str, lines: &LineSet) -> Vec<BreakpointSpec> {
    lines
        .iter()
        .map(|(line, enabled)| BreakpointSpec {
            file_path: file_path.to_string(),
            line: *line,
            verified: false,
            enabled: *enabled,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bp(file_path: &str, line: u32, enabled: bool) -> BreakpointSpec {
        BreakpointSpec {
            file_path: file_path.to_string(),
            line,
            verified: false,
            enabled,
        }
    }

    /// 纯函数过滤：`enabled && !muted`；mute 下全扣留（叠加态，不碰单个位）。
    #[test]
    fn effective_breakpoints_filters_disabled_and_muted() {
        let bps = vec![bp("/proj/a.go", 10, true), bp("/proj/a.go", 20, false)];
        let effective = effective_breakpoints(&bps, false);
        assert_eq!(effective.len(), 1, "只下发 enabled 行");
        assert_eq!(effective[0].line, 10);
        assert!(
            effective_breakpoints(&bps, true).is_empty(),
            "mute 下全部扣留"
        );
    }

    /// `specs_for_file` 保序（行号升序）且不改写 enabled 位。
    #[test]
    fn specs_for_file_keeps_line_order_and_enabled_bits() {
        let lines: LineSet = [(20, false), (10, true)].into_iter().collect();

        let specs = specs_for_file("/proj/a.go", &lines);
        assert_eq!(
            specs.iter().map(|s| s.line).collect::<Vec<_>>(),
            vec![10, 20]
        );
        assert!(specs[0].enabled);
        assert!(!specs[1].enabled);
        assert!(specs.iter().all(|s| s.file_path == "/proj/a.go"));
        // `verified` 是适配器回填的字段，内存快照一律 false。
        assert!(specs.iter().all(|s| !s.verified));
    }
}
