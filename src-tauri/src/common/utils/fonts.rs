//! System font enumeration for the settings font picker —— 编排层。
//!
//! 平台枚举实现（目录扫描 / PowerShell / fc-list）在 `platform::fonts`（红线 1 / 10）。
//! 本模块只负责：进程级缓存、私有字体过滤、排序去重。
//!
//! 设计要点：
//! - **快**：macOS 不用 `system_profiler`（实测 10s+、2MB JSON）；平台实现走轻量枚举。
//! - **缓存**：字体安装是低频事件，首次取一次足够；安装新字体后可调
//!   [`reset_font_cache`] 失效重建（设置页刷新）。
//! - **可选项安全**：过滤系统私有字体（`.` 前缀）。

use std::sync::Mutex;

/// 进程级缓存：应用生命周期内字体集合基本不变，避免设置页反复枚举。
///
/// 用 `Mutex<Option<Vec>>` 而非 `OnceLock`，是为了支持安装新字体后
/// 通过 [`reset_font_cache`] 失效重建；枚举本身在锁外执行（见
/// [`get_monospace_fonts`]），锁内仅做极短临界区的短路读与写入，
/// 规避大颗粒 Mutex 长时间持锁导致的线程饥饿。
static FONT_CACHE: Mutex<Option<Vec<String>>> = Mutex::new(None);

/// Get the list of fonts available on the system (cross-platform, cached).
#[must_use]
pub fn get_monospace_fonts() -> Vec<String> {
    if let Some(fonts) = read_cache() {
        return fonts;
    }
    // 枚举在锁外执行：macOS 目录扫描 / Windows PowerShell / Linux fc-list
    // 都可能耗时数百 ms，不能持锁占用共享资源。
    let fonts = build_font_list();
    write_cache(fonts.clone());
    fonts
}

/// 清空进程级缓存，下次 [`get_monospace_fonts`] 会重新枚举系统字体。
/// 安装新字体后调用（设置页「刷新」按钮）。
pub fn reset_font_cache() {
    if let Ok(mut guard) = FONT_CACHE.lock() {
        *guard = None;
    }
}

/// 枚举 + 过滤私有字体 + 排序去重（锁外执行的纯函数，可独立测试）。
fn build_font_list() -> Vec<String> {
    let mut fonts: Vec<String> = crate::platform::fonts::get_system_fonts()
        .into_iter()
        .filter(|f| !is_private_font(f))
        .collect();
    fonts.sort_by_key(|a| a.to_lowercase());
    fonts.dedup();
    fonts
}

/// 短路读缓存；锁中毒（理论不可达）时取内部值继续。
fn read_cache() -> Option<Vec<String>> {
    FONT_CACHE
        .lock()
        .map(|g| g.as_ref().cloned())
        .unwrap_or_else(|p| p.into_inner().as_ref().cloned())
}

/// 写入缓存；锁中毒时静默跳过（下次调用会重新枚举，不会更糟）。
fn write_cache(fonts: Vec<String>) {
    if let Ok(mut guard) = FONT_CACHE.lock() {
        *guard = Some(fonts);
    }
}

/// 过滤系统私有字体（macOS 以 `.` 前缀标记内部字体，选择后 CSS 无法命中）。
fn is_private_font(family: &str) -> bool {
    family.starts_with('.')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_dot_fonts_are_filtered() {
        assert!(is_private_font(".ADT Slab Numeric"));
        assert!(is_private_font(".Apple SD Gothic NeoI"));
        assert!(!is_private_font("JetBrains Mono"));
        assert!(!is_private_font("Menlo"));
    }

    #[test]
    fn cached_list_is_sorted_and_deduped() {
        let fonts = get_monospace_fonts();
        // CI 无字体容器友好：空列表时仅校验不过滤私有字体，不强制非空
        if fonts.is_empty() {
            return;
        }
        for pair in fonts.windows(2) {
            assert!(pair[0].to_lowercase() <= pair[1].to_lowercase());
            assert_ne!(pair[0], pair[1]);
        }
        assert!(fonts.iter().all(|f| !f.starts_with('.')));
    }

    #[test]
    fn reset_font_cache_rebuilds_on_next_call() {
        let first = get_monospace_fonts();
        // 重置后再次枚举：列表仍有效（排序去重过滤不变），且与重置前一致。
        reset_font_cache();
        let second = get_monospace_fonts();
        assert_eq!(first, second);
        // 重置本身可重复调用（幂等，不 panic）。
        reset_font_cache();
        reset_font_cache();
    }
}
