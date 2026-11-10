//! PTY 字节流 → 可回放纯文本：**单行编辑器**，纯计算，无任何 IO。
//!
//! shell 的 prompt 重绘靠 `\r` 归位 + `ESC[K`/`ESC[J` 擦除 + 覆盖写。
//! 单纯剥 ESC 会把被擦掉的反显 `%`、补白、半截命令全留下来（实测回放出一堆
//! 孤立 `%` / 空白行 / 重复 prompt）。因此这里模拟一个极简行编辑器：只有 `\n` 提交行。

/// 单会话日志与单次回放载荷的字节上限：与 `drain.rs::DETACHED_TAIL_CAPACITY` 对齐，
/// 也避免 `TerminalViewBase` 单次巨 write 撞 12s stall 自愈。
pub const MAX_LOG_BYTES: usize = 256 * 1024;

/// 行数上限：与前端 `TERMINAL_SCROLLBACK = 5000` 同源。
pub const MAX_LOG_LINES: usize = 5000;

/// 未提交行的字符数上限（**字符**，不是字节）。
///
/// `Sanitizer::line` 是 `Vec<char>`，中文一字可能 3 字节；与 [`MAX_LOG_BYTES`] 共用
/// 一个常量会让内存峰值达到字节上限的 3 倍。单独设一个更保守的字符预算。
const MAX_LINE_CHARS: usize = 64 * 1024;

/// 未闭合转义序列的最大保留长度，防畸形输出撑爆内存。
pub(crate) const MAX_PENDING_ESCAPE: usize = 4096;

/// PTY 原始字节 → 可回放的纯文本（一次性）。
///
/// 净化器是**单行编辑器**而不是逐字节过滤器：shell 的 prompt 重绘靠 `\r` 归位 +
/// `ESC[K`/`ESC[J` 擦除 + 覆盖写，单纯剥 ESC 会把被擦掉的反显 `%`、补白、半截命令
/// 全留在日志里（实测回放出一堆孤立 `%` 与空白行）。只有 `\n` 才提交一行。
#[must_use]
pub fn sanitize(bytes: &[u8]) -> String {
    let mut s = Sanitizer::new();
    let mut out = s.feed(bytes);
    out.push_str(&s.finish());
    out
}

/// 转义序列对当前行的编辑动作；其余（SGR / 私有模式 / OSC …）一律忽略。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Edit {
    Ignore,
    EraseToLineEnd,
    EraseToCursor,
    EraseWholeLine,
    SetColumn(usize),
    Forward(usize),
    Backward(usize),
    DeleteChars(usize),
    InsertBlanks(usize),
    EraseChars(usize),
}

/// 流式 ANSI 净化器：持有跨 chunk 未完成的转义序列 / UTF-8 字节，以及当前行与光标列。
#[derive(Debug, Default)]
pub struct Sanitizer {
    pending: Vec<u8>,
    line: Vec<char>,
    col: usize,
}

impl Sanitizer {
    /// 新建一个空的净化器（无跨 chunk 残留）。
    #[must_use]
    pub const fn new() -> Self {
        Self {
            pending: Vec::new(),
            line: Vec::new(),
            col: 0,
        }
    }

    /// 在光标处写一个字符（覆盖或补齐空格后追加），然后前进一列。
    ///
    /// 没有 LF 的超长输出（进度条 / `top` 之类）不能让当前行在内存里无限增长：
    /// 超过 `MAX_LINE_CHARS` 字符时丢掉最旧的一段。
    fn put(&mut self, ch: char) {
        if self.line.len() >= MAX_LINE_CHARS {
            let drop = MAX_LINE_CHARS / 2;
            self.line.drain(..drop);
            self.col = self.col.saturating_sub(drop);
        }
        if self.col < self.line.len() {
            self.line[self.col] = ch;
        } else {
            while self.line.len() < self.col {
                self.line.push(' ');
            }
            self.line.push(ch);
        }
        self.col += 1;
    }

    fn apply(&mut self, edit: Edit) {
        match edit {
            Edit::Ignore => {}
            Edit::EraseToLineEnd => self.line.truncate(self.col),
            Edit::EraseToCursor => {
                for ch in self.line.iter_mut().take(self.col) {
                    *ch = ' ';
                }
            }
            Edit::EraseWholeLine => {
                self.line.clear();
                self.col = 0;
            }
            Edit::SetColumn(n) => self.col = n,
            Edit::Forward(n) => self.col = self.col.saturating_add(n),
            Edit::Backward(n) => self.col = self.col.saturating_sub(n),
            Edit::DeleteChars(n) => {
                let end = (self.col + n).min(self.line.len());
                if self.col < end {
                    self.line.drain(self.col..end);
                }
            }
            Edit::InsertBlanks(n) => {
                let at = self.col.min(self.line.len());
                self.line.splice(at..at, std::iter::repeat_n(' ', n));
            }
            Edit::EraseChars(n) => {
                for ch in self.line.iter_mut().skip(self.col).take(n) {
                    *ch = ' ';
                }
            }
        }
    }

    /// 提交当前行：去掉尾部补白，追加 CRLF，重置行与光标。
    fn commit(&mut self, out: &mut String) {
        let end = self
            .line
            .iter()
            .rposition(|c| !c.is_whitespace())
            .map_or(0, |i| i + 1);
        out.extend(self.line[..end].iter());
        out.push_str("\r\n");
        self.line.clear();
        self.col = 0;
    }

    /// 吃进一段 PTY 输出，吐出**已提交**的行。未闭合序列 / 半截 UTF-8 / 当前行留到下次。
    pub fn feed(&mut self, bytes: &[u8]) -> String {
        let mut buf = std::mem::take(&mut self.pending);
        buf.extend_from_slice(bytes);

        let mut out = String::with_capacity(buf.len());
        let mut i = 0usize;
        while i < buf.len() {
            let b = buf[i];
            if b == 0x1b {
                match parse_escape(&buf[i..]) {
                    Some((n, edit)) => {
                        self.apply(edit);
                        i += n;
                    }
                    // 超长未闭合序列（畸形输出）不能让 pending 无限增长：强制丢掉 ESC。
                    None if buf.len() - i > MAX_PENDING_ESCAPE => i += 1,
                    None => break,
                }
                continue;
            }
            match b {
                // CR 是「光标回行首」，**不是换行**：shell 的 prompt 重绘全靠它覆盖。
                b'\r' => {
                    self.col = 0;
                    i += 1;
                }
                // 只有 LF 提交一行；CRLF 因此天然不产生空行。
                b'\n' => {
                    self.commit(&mut out);
                    i += 1;
                }
                b'\t' => {
                    let next = (self.col / 8 + 1) * 8;
                    while self.col < next {
                        self.put(' ');
                    }
                    i += 1;
                }
                b'\x08' => {
                    self.col = self.col.saturating_sub(1);
                    i += 1;
                }
                // 其余 C0 控制符与 DEL 不进日志。
                0x00..=0x07 | 0x0b..=0x0c | 0x0e..=0x1f | 0x7f => i += 1,
                0x20..=0x7e => {
                    self.put(b as char);
                    i += 1;
                }
                _ => {
                    let need = utf8_encoded_len(b);
                    if need == 0 {
                        i += 1;
                        continue;
                    }
                    if i + need > buf.len() {
                        break; // 半截 UTF-8，留给下一 chunk
                    }
                    match std::str::from_utf8(&buf[i..i + need]) {
                        Ok(s) => {
                            for ch in s.chars() {
                                self.put(ch);
                            }
                            i += need;
                        }
                        Err(_) => i += 1,
                    }
                }
            }
        }
        self.pending.extend_from_slice(&buf[i..]);
        out
    }

    /// 会话结束：提交最后一行；丢弃仍未闭合的转义序列与半截 UTF-8。
    pub fn finish(&mut self) -> String {
        self.pending.clear();
        if self.line.iter().all(|c| c.is_whitespace()) {
            self.line.clear();
            self.col = 0;
            return String::new();
        }
        let end = self
            .line
            .iter()
            .rposition(|c| !c.is_whitespace())
            .map_or(0, |i| i + 1);
        let out: String = self.line[..end].iter().collect();
        self.line.clear();
        self.col = 0;
        out
    }
}

/// 解析从 `data[0] == ESC` 开始的完整序列，返回 `(长度, 行编辑动作)`；`None` = 尚未闭合。
fn parse_escape(data: &[u8]) -> Option<(usize, Edit)> {
    debug_assert_eq!(data.first(), Some(&0x1b));
    if data.len() < 2 {
        return None;
    }
    match data[1] {
        b'[' => parse_csi(data),
        // OSC / DCS / SOS / PM / APC：到 BEL 或 ST(ESC \) 结束，内容一律忽略。
        b']' | b'P' | b'X' | b'^' | b'_' => {
            let mut i = 2;
            while i < data.len() {
                if data[i] == 0x07 {
                    return Some((i + 1, Edit::Ignore));
                }
                if data[i] == 0x1b {
                    if i + 1 >= data.len() {
                        return None;
                    }
                    return Some((
                        if data[i + 1] == b'\\' { i + 2 } else { i + 1 },
                        Edit::Ignore,
                    ));
                }
                i += 1;
            }
            None
        }
        // 字符集指定 / 其它三字节形式：ESC ( B、ESC # 8 …
        b'(' | b')' | b'*' | b'+' | b'-' | b'.' | b'/' | b'#' | b'%' | b' ' => {
            (data.len() >= 3).then_some((3, Edit::Ignore))
        }
        // 单字符转义（ESC 7 / ESC 8 / ESC c / ESC = …）。
        _ => Some((2, Edit::Ignore)),
    }
}

/// 解析 CSI：参数字节 0x20..=0x3f，final 0x40..=0x7e。
fn parse_csi(data: &[u8]) -> Option<(usize, Edit)> {
    let mut end = None;
    for (i, &b) in data.iter().enumerate().skip(2) {
        if (0x40..=0x7e).contains(&b) {
            end = Some(i);
            break;
        }
        if !(0x20..=0x3f).contains(&b) {
            return Some((i + 1, Edit::Ignore)); // 畸形参数
        }
    }
    let end = end?;
    let final_byte = data[end];
    let raw = &data[2..end];
    // 私有模式（?2004h 等）与 SGR 都不改行内容。
    let params: Vec<usize> = raw
        .split(|&b| b == b';')
        .map(|part| {
            let digits: Vec<u8> = part.iter().copied().filter(u8::is_ascii_digit).collect();
            std::str::from_utf8(&digits)
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0)
        })
        .collect();
    let p = |idx: usize, default: usize| -> usize {
        let v = params.get(idx).copied().unwrap_or(0);
        if v == 0 {
            default
        } else {
            v
        }
    };
    let edit = match final_byte {
        // EL：擦到行尾 / 擦到光标 / 整行。
        b'K' => match params.first().copied().unwrap_or(0) {
            1 => Edit::EraseToCursor,
            2 => Edit::EraseWholeLine,
            _ => Edit::EraseToLineEnd,
        },
        // ED：单屏模型下 0/1 等价于擦到行尾，2 等价于清整行。
        b'J' => match params.first().copied().unwrap_or(0) {
            2 | 3 => Edit::EraseWholeLine,
            _ => Edit::EraseToLineEnd,
        },
        b'G' | b'`' => Edit::SetColumn(p(0, 1).saturating_sub(1)),
        b'C' => Edit::Forward(p(0, 1)),
        b'D' => Edit::Backward(p(0, 1)),
        b'P' => Edit::DeleteChars(p(0, 1)),
        b'@' => Edit::InsertBlanks(p(0, 1)),
        b'X' => Edit::EraseChars(p(0, 1)),
        // CUP：行号忽略（线性日志只有当前行），列号照用。
        b'H' | b'f' => Edit::SetColumn(p(1, 1).saturating_sub(1)),
        _ => Edit::Ignore,
    };
    Some((end + 1, edit))
}

/// UTF-8 首字节给出的编码长度；`0` = 非法首字节。
const fn utf8_encoded_len(lead: u8) -> usize {
    match lead {
        0xc2..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf4 => 4,
        _ => 0,
    }
}
