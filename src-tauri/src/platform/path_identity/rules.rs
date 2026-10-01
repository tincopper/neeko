//! 身份字母表渲染规则（**纯字符串**，与宿主 OS 无关地实现两套「形态规则」）。
//!
//! 规则体刻意不做 `#[cfg]` 门控、三端编译、三端测试：平台差异在**选择**（`mod.rs` 按宿主
//! 选 `portable_render`），不在**规则**。理由是 Windows 形态规则属于「在 macOS 开发机上
//! 不可见的失败域」—— 放进 `windows.rs` 会退化成只有 Windows CI 能验证；放在这里，
//! 本地 `cargo test` 就能跑红跑绿。
//!
//! 两套规则的区别是**形态**而不是平台：`render_posix_shaped` 同时服务
//! ① POSIX 宿主的 Local 路径；② 远端（WSL / SSH）路径 —— 后者的消费侧是远端 Linux，
//! 与宿主 OS 无关，因此必须能不经宿主 cfg 选择直接调用（见 [`render_posix_shaped`]）。

/// 把 **Windows 形态**的宿主路径渲染为平台无关身份字母表。
///
/// 输出契约（identity 字母表）：
///
/// - 分隔符一律 `/`；
/// - 无 `\\?\` / `\\.\` 设备前缀；verbatim UNC（`\\?\UNC\…`）与普通 UNC（`\\…`）
///   统一渲染为 `//server/share/…`；
/// - 盘符 ASCII 大写（`c:` → `C:`）；驱动器根保留尾斜杠（`C:/`）——
///   否则 `C:` 与「驱动器相对路径」（`C:foo`）同形，身份会退化；
/// - 折叠空段与 `.`；去尾分隔符；**不**折叠 `..`（上游 `lexical_worktree_check` 已拒绝，
///   这里保持可见以免把非法输入悄悄变成合法身份）。
///
/// 大小写与 Unicode 归一形**刻意不做**：折叠会在大小写敏感文件系统上把两个不同对象并成
/// 一个身份（违反区分性）。
///
/// 非 Windows 宿主上本规则不被 `portable_render` 选中（只被本文件的测试引用），
/// 故对该平台放行 `dead_code` —— 测试仍然三端运行，这正是规则体不做 cfg 门控的目的。
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[must_use]
pub fn render_windows_shaped(raw: &str) -> String {
    let (body_raw, unc) = strip_windows_prefix(raw);
    let body = body_raw.replace('\\', "/");
    let leading_root = !unc && body.starts_with('/');

    let segments: Vec<String> = body
        .split('/')
        .filter(|seg| !seg.is_empty() && *seg != ".")
        .map(normalize_drive_segment)
        .collect();

    if segments.is_empty() {
        // 全是分隔符（或 UNC 头）⇒ 渲染成根，绝不返回空串 ——「空串」与「没传路径」同形。
        return if unc {
            "//".to_string()
        } else {
            "/".to_string()
        };
    }

    let drive_root = segments.len() == 1 && is_drive_segment(&segments[0]);
    let mut out = String::new();
    if unc {
        out.push_str("//");
    } else if leading_root {
        out.push('/');
    }
    out.push_str(&segments.join("/"));
    if drive_root {
        out.push('/');
    }
    out
}

/// 把 **POSIX 形态**的远端或宿主路径渲染为平台无关身份字母表。
///
/// 与 [`render_windows_shaped`] 的关键差别：**`\` 是 POSIX 的合法文件名字符**，绝不改写，
/// 因此本函数不按宿主平台分叉 —— 它在 Windows 宿主上同样有效，这正是 WSL / SSH 分支
/// （消费侧是远端 Linux，见 `path_guard` 的既有判据）与 POSIX 宿主 Local 分支共用的规则。
///
/// 输出契约：折叠空段与 `.`、去尾分隔符、保留前导 `/`（根不塌成空串）、保留相对性、
/// 不折叠 `..`（上游已拒绝）。
#[must_use]
pub fn render_posix_shaped(raw: &str) -> String {
    let leading_root = raw.starts_with('/');
    let segments: Vec<&str> = raw
        .split('/')
        .filter(|seg| !seg.is_empty() && *seg != ".")
        .collect();

    if segments.is_empty() {
        return if leading_root {
            "/".to_string()
        } else {
            String::new()
        };
    }

    let joined = segments.join("/");
    if leading_root {
        format!("/{joined}")
    } else {
        joined
    }
}

/// 剥设备/UNC 前缀，返回（主体，是否 UNC）。
///
/// verbatim UNC（`\\?\UNC\srv\share\…`）与普通 UNC（`\\srv\share\…`）都归到 UNC 分支；
/// `\\?\C:\…` 与 `\\.\C:\…` 只剥前缀、保留盘符主体。
fn strip_windows_prefix(raw: &str) -> (&str, bool) {
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        return (rest, true);
    }
    if let Some(rest) = raw.strip_prefix(r"\\?\") {
        return (rest, false);
    }
    if let Some(rest) = raw.strip_prefix(r"\\.\") {
        return (rest, false);
    }
    if let Some(rest) = raw.strip_prefix(r"\\") {
        return (rest, true);
    }
    (raw, false)
}

fn is_drive_segment(seg: &str) -> bool {
    let bytes = seg.as_bytes();
    bytes.len() == 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic()
}

fn normalize_drive_segment(seg: &str) -> String {
    if !is_drive_segment(seg) {
        return seg.to_string();
    }
    let letter = seg.as_bytes()[0] as char;
    format!("{}:", letter.to_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Windows 形态 ─────────────────────────────────────────────────────

    #[test]
    fn windows_verbatim_disk_path_drops_prefix() {
        assert_eq!(
            render_windows_shaped(r"\\?\C:\Users\me\wt"),
            "C:/Users/me/wt"
        );
        assert_eq!(
            render_windows_shaped(r"\\.\C:\Users\me\wt"),
            "C:/Users/me/wt"
        );
    }

    #[test]
    fn windows_drive_letter_is_uppercased_and_rest_kept_verbatim() {
        // 只规范化盘符：其余段的大小写是文件系统的事实，不得改写（区分性）
        assert_eq!(render_windows_shaped(r"c:\Users\me\WT"), "C:/Users/me/WT");
    }

    #[test]
    fn windows_drive_root_keeps_trailing_slash() {
        // 驱动器根必须与「驱动器相对路径」区分：`C:/` ≠ `C:foo`
        assert_eq!(render_windows_shaped(r"\\?\C:\"), "C:/");
        assert_eq!(render_windows_shaped("C:foo"), "C:foo");
    }

    #[test]
    fn windows_unc_is_rendered_with_double_slash() {
        assert_eq!(
            render_windows_shaped(r"\\?\UNC\srv\share\x"),
            "//srv/share/x"
        );
        assert_eq!(render_windows_shaped(r"\\srv\share\x"), "//srv/share/x");
    }

    #[test]
    fn windows_collapses_empty_and_curdir_segments() {
        assert_eq!(render_windows_shaped(r"\\?\C:\a\.\b\\"), "C:/a/b");
        assert_eq!(render_windows_shaped(r"\\?\C:\a\b\\"), "C:/a/b");
    }

    #[test]
    fn windows_does_not_swallow_parent_segments() {
        // `..` 由上游 lexical 检查拒绝；这里保持可见，绝不悄悄产出合法身份
        assert_eq!(render_windows_shaped(r"\\?\C:\a\..\b"), "C:/a/../b");
    }

    // ── POSIX 形态 ───────────────────────────────────────────────────────

    #[test]
    fn posix_collapses_dot_and_trailing_separator() {
        assert_eq!(render_posix_shaped("/home/u/p/./x/"), "/home/u/p/x");
        assert_eq!(render_posix_shaped("sub/wt/"), "sub/wt");
    }

    #[test]
    fn posix_keeps_root_and_never_returns_empty_for_root() {
        assert_eq!(render_posix_shaped("/./"), "/");
        assert_eq!(render_posix_shaped("/"), "/");
        assert_eq!(render_posix_shaped(""), "");
    }

    #[test]
    fn posix_never_rewrites_backslashes() {
        // `\` 是 POSIX 的合法文件名字符：改写它会把两个不同文件并成一个身份
        assert_eq!(render_posix_shaped(r"/a\b/c"), r"/a\b/c");
    }
}
