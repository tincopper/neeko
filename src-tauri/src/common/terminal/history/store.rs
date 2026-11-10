//! 终端历史日志的**单一所有者**。
//!
//! 第一性原理：日志是「会话身份」的附属资源。它的目录、文件格式、写入、迁移、回收
//! 必须只有一处知道 —— 否则 `live_sessions` 域得反向 import `terminal` 域、三端各算一次
//! 目录、纯函数 `restore()` 被塞进磁盘 GC。这里把这些职责全部收进 [`HistoryStore`]，
//! 对外只暴露「准备一个会话」与三个生命周期事件；组合根注入目录，测试注入 `tempdir()`。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::contract::SessionHistory;
use super::sanitizer::{MAX_LOG_BYTES, MAX_LOG_LINES};
use super::writer::Recorder;

/// 日志文件头：净化器语义变了（逐字节过滤 → 单行编辑器），旧格式日志回放会
/// 出现孤立 `%` / 空白行 / 重复 prompt，读到不带此头的文件一律降级为空。
/// 头只在原子写时写入，不参与 `tail` 的截断计算。
const LOG_MAGIC: &[u8] = b"NEEKO-SHELL-LOG-v2\n";

/// 历史与本次会话之间的可见分界（纯文本，不含 ESC）。
///
/// **英文**：它是终端里用户直接读到的输出，与日志 / 错误信息同一条规则
/// （根 `AGENTS.md`「错误消息和日志字符串使用英文」）。中文还会在等宽终端里
/// 按 2 列/字计宽，遇到窄终端或非 CJK 字体时整行折行、把分界框撑断。
///
/// 语义：上方是历史回放，下方是本次会话。`pub(super)` 只为让测试引用同一个
/// 常量 —— 文案在断言里再抄一遍，改一处就会留一处假绿。
pub(super) const REPLAY_SEPARATOR: &[u8] =
    b"\r\n\xe2\x94\x80\xe2\x94\x80\xe2\x94\x80 end of previous output \xc2\xb7 this session starts below \xe2\x94\x80\xe2\x94\x80\xe2\x94\x80\r\n\r\n";

/// 一次会话创建所需的全部历史决策。**在 `run_blocking` 里算好**，让三端 pipeline
/// 只做纯内存操作（`drain.push` + 起写线程），彻底把阻塞 fs 移出 async command 链（红线 3）。
#[derive(Debug)]
pub struct HistoryPlan {
    store: Arc<HistoryStore>,
    /// 推进 drain 的首批字节（空 = 不回放）。
    replay: Vec<u8>,
    /// 新会话写线程的初始正文 —— 旧日志已经读进内存，直接作为新日志起点，
    /// 不再 `fs::copy` 一份文件（少一次 IO、少一个「copy 成功但 adopt 失败」的竞态）。
    seed: Vec<u8>,
}

impl HistoryPlan {
    /// 回放字节。空表示没有历史，调用方跳过 `drain.push`。
    #[must_use]
    pub fn replay(&self) -> &[u8] {
        &self.replay
    }

    /// 把历史计划接到一个 drain 上：**唯一**的接线接缝，Local / WSL / SSH 三端共用。
    ///
    /// 顺序是物理契约：回放字节必须在 reader / IO 线程产出第一批数据之前入队
    /// （由调用方保证 attach 早于线程启动）。抽出单一接缝后，三端不可能各写一遍
    /// 而漏掉某一端；测试也能直接对这条接缝断言顺序，不必起真实 PTY。
    #[must_use]
    pub(crate) fn attach(
        &self,
        drain: &crate::common::terminal::drain::SessionDrain,
        session_id: &str,
    ) -> Option<Recorder> {
        if !self.replay.is_empty() {
            // 空缓冲必然接收；wake 走同一个 Notify，long-poll 也能被唤醒。
            drain.push(&self.replay, || drain.notify_one());
        }
        self.store.start_writer(session_id, self.seed.clone())
    }
}

/// 终端历史日志的唯一所有者。目录由组合根注入（`terminal_history_dir()`），测试注入 `tempdir()`。
#[derive(Debug)]
pub struct HistoryStore {
    dir: PathBuf,
}

impl HistoryStore {
    /// 以注入目录构造所有者；测试传 `tempdir()`，组合根用 [`HistoryStore::at_default_dir`]。
    #[must_use]
    pub const fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// 组合根唯一调用点：`terminal_history_dir()` 只在这里出现一次。
    #[must_use]
    pub fn at_default_dir() -> Self {
        Self::new(crate::common::paths::terminal_history_dir())
    }

    /// 会话创建前的**唯一阻塞点**：读旧日志 + 造回放载荷 + 准备新日志初值。
    /// 调用方（router）用 `common::runtime::run_blocking` 包住，三端共用这一份结果。
    ///
    /// `None` = 不落盘不回放（agent TUI / 未注入 history）。这一个判据在 router
    /// 单点裁决，前后端、三端都不再各写一遍。
    #[must_use]
    pub fn prepare(self: &Arc<Self>, resume_from: Option<&str>) -> Option<HistoryPlan> {
        let seed = resume_from
            .map(|from| self.read_tail(from))
            .unwrap_or_default();
        let replay = replay_payload(&seed);
        Some(HistoryPlan {
            store: Arc::clone(self),
            replay,
            seed,
        })
    }

    /// 启动写线程：非阻塞（只 spawn 一个 OS 线程），可安全地在任何 pipeline 里调用。
    /// 非法 `session_id` 返回 `None`（红线 8 同源校验）；合法则必定返回写线程句柄。
    #[must_use]
    pub fn start_writer(&self, session_id: &str, seed: Vec<u8>) -> Option<Recorder> {
        let path = self.checked_log_path(session_id)?;
        Some(Recorder::start(self.dir.clone(), path, seed))
    }

    /// 启动恢复后的孤儿回收，由组合根在 `on_setup` 调用 —— **不**在 `restore()` 里做，
    /// 因为 `restore()` 是纯回填函数且被单测直接调用（曾在测试里删掉真实用户日志）。
    pub fn prune(&self, live_ids: &HashSet<String>) {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let (id, is_log) = match name.strip_suffix(".log") {
                Some(id) => (id, true),
                None => match name.strip_suffix(".log.tmp") {
                    Some(id) => (id, false),
                    None => continue,
                },
            };
            if is_log && live_ids.contains(id) {
                continue;
            }
            let _ = std::fs::remove_file(entry.path());
        }
    }

    /// 读回日志正文；文件不存在 / 无版本头（旧格式）/ 读失败一律降级为空。
    #[must_use]
    pub fn read_tail(&self, session_id: &str) -> Vec<u8> {
        match self.checked_log_path(session_id) {
            Some(path) => read_tail_bytes(&path),
            None => Vec::new(),
        }
    }

    /// `session_id` 能拼进日志文件名吗？前端传来的 `resumeFrom` 消费前必须挡住
    /// `..` / 路径分隔符 / 控制字符，否则日志读写会跳出 `self.dir`（红线 8 同源校验）。
    #[must_use]
    pub fn is_safe_session_id(session_id: &str) -> bool {
        !session_id.is_empty()
            && session_id.len() <= 128
            && session_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    }

    fn checked_log_path(&self, session_id: &str) -> Option<PathBuf> {
        Self::is_safe_session_id(session_id).then(|| self.dir.join(format!("{session_id}.log")))
    }

    fn remove(&self, session_id: &str) {
        if let Some(path) = self.checked_log_path(session_id) {
            let _ = std::fs::remove_file(path);
        }
    }
}

impl SessionHistory for HistoryStore {
    fn on_adopt(&self, from_session_id: &str, _into_session_id: &str) {
        // 新日志已在 prepare 时以旧日志为初值，旧文件现在只是冗余副本。
        // adopt 失败时本方法不会被调用，旧文件仍在，用户可再次恢复。
        self.remove(from_session_id);
    }

    fn on_unregister(&self, session_id: &str) {
        self.remove(session_id);
    }
}

/// 把 `existing + appended` 收敛到 `min(MAX_LOG_BYTES, MAX_LOG_LINES)` 的尾部。
/// 字节截断落在 UTF-8 字符边界上；行截断落在 `\n` 之后，两者都只丢最旧的内容。
#[must_use]
pub fn tail(existing: &[u8], appended: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(existing.len() + appended.len());
    buf.extend_from_slice(existing);
    buf.extend_from_slice(appended);

    if buf.len() > MAX_LOG_BYTES {
        let mut start = buf.len() - MAX_LOG_BYTES;
        while start < buf.len() && (buf[start] & 0xc0) == 0x80 {
            start += 1;
        }
        buf.drain(..start);
    }

    let newline_count = buf.iter().filter(|&&b| b == b'\n').count();
    if newline_count > MAX_LOG_LINES {
        let drop = newline_count - MAX_LOG_LINES;
        let mut seen = 0usize;
        let mut at = 0usize;
        for (i, &b) in buf.iter().enumerate() {
            if b == b'\n' {
                seen += 1;
                if seen == drop {
                    at = i + 1;
                    break;
                }
            }
        }
        buf.drain(..at);
    }
    buf
}

/// 回放载荷 = 历史正文 + 分隔线。空日志返回空（调用方据此跳过回放）。
#[must_use]
pub fn replay_payload(log: &[u8]) -> Vec<u8> {
    if log.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(log.len() + REPLAY_SEPARATOR.len() + 2);
    out.extend_from_slice(log);
    if !out.ends_with(b"\r\n") {
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(REPLAY_SEPARATOR);
    out
}

fn read_tail_bytes(path: &Path) -> Vec<u8> {
    match std::fs::read(path) {
        Ok(bytes) if bytes.starts_with(LOG_MAGIC) => tail(&[], &bytes[LOG_MAGIC.len()..]),
        _ => Vec::new(),
    }
}

/// tmp + rename 原子写：崩溃不会留下半截日志。失败只 warn（日志是缓存，不阻断终端）。
pub(crate) fn write_atomic(dir: &Path, path: &Path, bytes: &[u8]) {
    use std::io::Write;

    if let Err(e) = std::fs::create_dir_all(dir) {
        log::warn!("[terminal-history] create dir failed: {e}");
        return;
    }
    let tmp = path.with_extension("log.tmp");
    let result = std::fs::File::create(&tmp).and_then(|mut f| {
        f.write_all(LOG_MAGIC)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)
    });
    if let Err(e) = result {
        log::warn!("[terminal-history] write failed: {e}");
        let _ = std::fs::remove_file(&tmp);
    }
}

/// 组合根注入到 `live_sessions::Registry` 的类型别名。
pub type SharedHistoryStore = Arc<HistoryStore>;

/// 供测试断言「写线程确实以旧日志为初值续写」而不碰私有字段。
#[cfg(test)]
impl HistoryPlan {
    pub(crate) fn seed_for_test(&self) -> &[u8] {
        &self.seed
    }
}
