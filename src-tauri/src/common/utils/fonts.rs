//! System font enumeration for the settings font picker.
//!
//! 设计要点：
//! - **快**：macOS 不用 `system_profiler`（实测 10s+、2MB JSON）；改为直接
//!   扫描标准字体目录并以轻量文件名→family 名映射返回。
//! - **缓存**：进程级缓存（`Mutex<Option<Vec>>`），字体安装是低频事件，
//!   首次取一次足够；安装新字体后可调 [`reset_font_cache`] 失效重建（设置页刷新）。
//! - **可选项安全**：过滤系统私有字体（`.` 前缀）与非首选取名形态。

use std::collections::BTreeSet;
use std::path::Path;
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

/// 枚举 + 排序去重 + 私有字体过滤（锁外执行的纯函数，可独立测试）。
fn build_font_list() -> Vec<String> {
    let mut fonts = get_system_fonts();
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

#[cfg(target_os = "macos")]
fn get_system_fonts() -> Vec<String> {
    // 标准字体目录（家庭目录优先，用户安装的字体最可能是想要的选择项）
    let dirs = [
        dirs_home().map(|h| h.join("Library/Fonts")),
        Some(std::path::PathBuf::from("/Library/Fonts")),
        Some(std::path::PathBuf::from("/System/Library/Fonts")),
    ];
    let mut families = BTreeSet::new();
    for dir in dirs.into_iter().flatten() {
        collect_ttf_family_names(&dir, &mut families);
    }
    families
        .into_iter()
        .filter(|f| !is_private_font(f))
        .collect()
}

/// 用户主目录（测试与非常规环境下容错）。
#[cfg(target_os = "macos")]
fn dirs_home() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(std::path::PathBuf::from)
}

/// 扫描目录下的字体文件并提取 family 名。
///
/// 文件名到 CSS family 名的映射是启发式（去扩展名、`-Regular/Bold` 等样式
/// 后缀、下划线/连字符转空格）。CSS 匹配字体时 WebKit 对 family 名大小写
/// 不敏感且做 DejaVu 化归一，启发式命名在字体选择场景足够准确；无法识别的
/// 形态退化为文件名，最坏情况是选择后回退默认栈（与现状一致，不会更糟）。
#[cfg(target_os = "macos")]
fn collect_ttf_family_names(dir: &Path, out: &mut BTreeSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    const FONT_EXTS: [&str; 5] = ["ttf", "otf", "ttc", "dfont", "otc"];
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());
        let Some(ext) = ext else { continue };
        if !FONT_EXTS.contains(&ext.as_str()) {
            continue;
        }
        if let Some(name) = family_from_filename(&path) {
            out.insert(name);
        }
    }
}

/// 从字体文件名推断 CSS family 名（去样式后缀 + 分隔符转空格）。
#[cfg(target_os = "macos")]
fn family_from_filename(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    // 去常见样式后缀（大小写不敏感）。先按长度降序排列：`-BoldItalic` 必须
    // 在 `-Bold` / `-Italic` 之前命中，否则 `Foo-BoldItalic` 会被截成 `Foo-Italic`。
    let mut style_suffixes = [
        "-Regular",
        "-Bold",
        "-Italic",
        "-BoldItalic",
        "-Light",
        "-Medium",
        "-Thin",
        "-SemiBold",
        "-ExtraBold",
        "-Black",
        " Regular",
        " Bold",
        " Italic",
    ];
    style_suffixes.sort_by_key(|s| std::cmp::Reverse(s.len()));
    let mut name = stem.to_string();
    for suffix in style_suffixes {
        if name
            .to_ascii_lowercase()
            .ends_with(&suffix.to_ascii_lowercase())
            && name.len() > suffix.len()
        {
            name.truncate(name.len() - suffix.len());
            break;
        }
    }
    // .ttc 集合文件常见下划线形态（Menlo.ttc → Menlo；Hiragino_xxx 保持可读）
    let name = name.replace('_', " ").trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

#[cfg(target_os = "windows")]
fn get_system_fonts() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            r#"[System.Reflection.Assembly]::LoadWithPartialName('System.Drawing') | Out-Null;
(New-Object System.Drawing.Text.InstalledFontCollection).Families |
Where-Object { $_.IsStyleAvailable('Regular') } |
Select-Object -ExpandProperty Name"#,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && !is_private_font(l))
            .collect(),
        Err(e) => {
            log::warn!("Failed to get Windows fonts via PowerShell: {e}");
            vec![]
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn get_system_fonts() -> Vec<String> {
    vec![]
}

#[cfg(target_os = "linux")]
fn get_system_fonts() -> Vec<String> {
    use std::process::Command;
    let output = Command::new("fc-list")
        .args(["--format=%{family[0]}\n"])
        .output();
    match output {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            let mut fonts: Vec<String> = text
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect();
            fonts = fonts
                .into_iter()
                .map(|f| f.split(',').next().unwrap_or(&f).trim().to_string())
                .filter(|f| !f.is_empty() && !is_private_font(f))
                .collect();
            fonts
        }
        Err(e) => {
            log::warn!("Failed to get Linux fonts via fc-list: {e}");
            vec![]
        }
    }
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

    #[cfg(target_os = "macos")]
    #[test]
    fn family_from_stem_strips_style_suffixes() {
        let p = Path::new("/System/Library/Fonts/Menlo.ttc");
        assert_eq!(family_from_filename(p).as_deref(), Some("Menlo"));

        let p = Path::new("/Library/Fonts/JetBrainsMono-Regular.ttf");
        assert_eq!(family_from_filename(p).as_deref(), Some("JetBrainsMono"));

        let p = Path::new("/Library/Fonts/Source Code Pro-Bold.ttf");
        assert_eq!(family_from_filename(p).as_deref(), Some("Source Code Pro"));

        // 连体后缀：-BoldItalic 必须先于 -Bold / -Italic 命中，不得截成残名
        let p = Path::new("/Library/Fonts/SourceCodePro-BoldItalic.ttf");
        assert_eq!(family_from_filename(p).as_deref(), Some("SourceCodePro"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn font_dirs_scan_returns_nonempty_on_real_system() {
        let dir = Path::new("/System/Library/Fonts");
        if !dir.exists() {
            return;
        }
        let mut out = BTreeSet::new();
        collect_ttf_family_names(dir, &mut out);
        // 真实 macOS 一定有 Menlo / Monaco 等系统等宽字体
        assert!(
            out.iter()
                .any(|f| f.contains("Menlo") || f.contains("Monaco")),
            "system fonts should contain Menlo/Monaco, got: {out:?}"
        );
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
