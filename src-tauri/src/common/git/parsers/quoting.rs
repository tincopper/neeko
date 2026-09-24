//! git 文本输出的路径解码（C 风格转义）。
//!
//! git 在 `core.quotePath` 默认开启时，对**含非 ASCII 或特殊字符的路径**做 C 风格
//! 转义并整体加双引号（`git status` / `ls-files` / `diff --numstat` / `--name-status`
//! 的文本输出皆是）：
//!
//! ```text
//! git ls-files --others --exclude-standard -- test/
//! "test/\346\265\213\350\257\225.txt"
//! ```
//!
//! 未解码的后果是**下游全线错位**：UI 显示乱码、按路径建索引不命中（stats 合并不上）、
//! staging/diff 命令拿到引号+转义的伪路径、目录展开拿它当 pathspec 找不到目录。
//!
//! 因此解码放在**解析入口**（`parsers::{status,numstat}` 的唯一构造点），而不是每个
//! git 调用点加 `-c core.quotePath=false`：后者要求所有调用点都不漏，且无法处理
//! 必须转义的路径（含引号 / 控制字符）；前者一处收口，符合「同一事实只有一种表示」。
//!
//! 走 `-z`（NUL 分隔）调用的路径不经过本模块 —— `-z` 形态下 git 不转义、不加引号，
//! 例如 `collapsed_probe` 的探测与 `get_untracked_files` 的展开。

/// 解码 git 文本输出的单个路径 token。
///
/// - 非引号形态（无转义需求）原样返回；
/// - 引号形态按 C 转义规则解码：`\a \b \f \n \r \t \v \\ \"`，以及 1–3 位八进制
///   （git 对非 ASCII 字节逐字节输出三位八进制，如 `\346` = UTF-8 首字节）；
/// - 解码结果按 UTF-8 解释，非法字节序列走 lossy 替换（不 panic、不丢条目）。
#[must_use]
pub(crate) fn unquote_git_path(raw: &str) -> String {
    let bytes = raw.as_bytes();
    if bytes.len() < 2 || bytes[0] != b'"' || bytes[bytes.len() - 1] != b'"' {
        return raw.to_string();
    }

    let mut out: Vec<u8> = Vec::with_capacity(bytes.len() - 2);
    let end = bytes.len() - 1;
    let mut i = 1;
    while i < end {
        let byte = bytes[i];
        if byte != b'\\' {
            out.push(byte);
            i += 1;
            continue;
        }
        i += 1;
        let Some(escaped) = bytes.get(i).copied().filter(|_| i < end) else {
            break;
        };
        match escaped {
            b'a' => out.push(0x07),
            b'b' => out.push(0x08),
            b'f' => out.push(0x0c),
            b'n' => out.push(b'\n'),
            b'r' => out.push(b'\r'),
            b't' => out.push(b'\t'),
            b'v' => out.push(0x0b),
            b'\\' => out.push(b'\\'),
            b'"' => out.push(b'"'),
            b'0'..=b'7' => {
                let mut value: u32 = 0;
                let mut digits = 0;
                while digits < 3 {
                    match bytes.get(i).copied().filter(|_| i < end) {
                        Some(digit @ b'0'..=b'7') => {
                            value = value * 8 + u32::from(digit - b'0');
                            i += 1;
                            digits += 1;
                        }
                        _ => break,
                    }
                }
                // 三位八进制上限 0o777 > 255：git 不会产出越界值，非法输入钳到上限
                out.push(u8::try_from(value).unwrap_or(u8::MAX));
                continue;
            }
            other => out.push(other),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_non_ascii_octal_escapes() {
        assert_eq!(
            unquote_git_path("\"test/\\346\\265\\213\\350\\257\\225.txt\""),
            "test/测试.txt"
        );
    }

    #[test]
    fn decodes_simple_escapes() {
        assert_eq!(unquote_git_path("\"a\\tb\\nc\\\"d\\\\e\""), "a\tb\nc\"d\\e");
    }

    #[test]
    fn leaves_plain_paths_untouched() {
        assert_eq!(unquote_git_path("src/main.rs"), "src/main.rs");
        // 只有一侧有引号（半截输入）→ 不当作引号形态，原样返回
        assert_eq!(unquote_git_path("\"broken"), "\"broken");
        assert_eq!(unquote_git_path(""), "");
    }

    #[test]
    fn decodes_partial_octal_run() {
        // 兼容 1–3 位八进制（git 恒输出三位，但短形式不应被误读为字面量）
        assert_eq!(unquote_git_path("\"\\101\""), "A");
        assert_eq!(unquote_git_path("\"\\7\""), "\u{7}");
    }
}
