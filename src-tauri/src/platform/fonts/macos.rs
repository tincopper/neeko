//! macOS 字体枚举：扫描标准字体目录，以文件名启发式推断 family 名。
//!
//! 不用 `system_profiler`（实测 10s+、2MB JSON）；目录扫描为同步 fs，调用方
//! `common::utils::fonts::get_monospace_fonts` 本身是同步入口。

use std::collections::BTreeSet;
use std::path::Path;

/// 枚举 macOS 系统字体（含用户字体）的 family 名。
///
/// 返回**未过滤、未排序**的原始集合：私有字体过滤与排序去重由
/// `common::utils::fonts` 统一完成。
#[must_use]
pub fn get_system_fonts() -> Vec<String> {
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
    families.into_iter().collect()
}

/// 用户主目录（测试与非常规环境下容错）。
fn dirs_home() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(std::path::PathBuf::from)
}

/// 扫描目录下的字体文件并提取 family 名。
///
/// 文件名到 CSS family 名的映射是启发式（去扩展名、`-Regular/Bold` 等样式
/// 后缀、下划线/连字符转空格）。CSS 匹配字体时 WebKit 对 family 名大小写
/// 不敏感且做 DejaVu 化归一，启发式命名在字体选择场景足够准确；无法识别的
/// 形态退化为文件名，最坏情况是选择后回退默认栈（与现状一致，不会更糟）。
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
