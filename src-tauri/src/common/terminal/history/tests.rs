//! `history` 模块测试。夹具路径一律由 `tempdir()` 推导（红线 13），绝不碰真实 `~/.neeko/`。

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use crate::common::terminal::drain::SessionDrain;
use crate::common::terminal::history::contract::SessionHistory;
use crate::common::terminal::history::sanitizer::{
    sanitize, Sanitizer, MAX_LOG_BYTES, MAX_LOG_LINES, MAX_PENDING_ESCAPE,
};
use crate::common::terminal::history::store::{
    replay_payload, tail, HistoryStore, REPLAY_SEPARATOR,
};

// ── sanitize / Sanitizer ───────────────────────────────────────────────

/// 真实 zsh -i -f 会话字节（PTY 捕获）：两次 PROMPT_SP 重绘、
/// `\x08` 退格回显、`\r\r\n` 提交、`?2004h/l` bracketed paste、两条命令输出。
const ZSH_SESSION: &str = concat!(
        "\x1b\x5b\x31\x6d\x1b\x5b\x37\x6d\x25\x1b\x5b\x32\x37\x6d\x1b\x5b\x31\x6d\x1b\x5b\x30\x6d\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20",
        "\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20",
        "\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20",
        "\x20\x20\x20\x20\x20\x0d\x20\x0d\x0d\x1b\x5b\x30\x6d\x1b\x5b\x32\x37\x6d\x1b\x5b\x32\x34\x6d\x1b\x5b\x4a\x74\x6f\x6d\x67\x73\x40",
        "\x74\x6f\x6d\x67\x73\x2d\x32\x20\x6e\x65\x65\x6b\x6f\x20\x25\x20\x1b\x5b\x4b\x1b\x5b\x3f\x32\x30\x30\x34\x68\x70\x08\x70\x77\x64",
        "\x1b\x5b\x3f\x32\x30\x30\x34\x6c\x0d\x0d\x0a\x2f\x55\x73\x65\x72\x73\x2f\x74\x6f\x6d\x67\x73\x2f\x52\x75\x73\x74\x72\x6f\x76\x65",
        "\x72\x50\x72\x6f\x6a\x65\x63\x74\x73\x2f\x6e\x65\x65\x6b\x6f\x0d\x0a\x1b\x5b\x31\x6d\x1b\x5b\x37\x6d\x25\x1b\x5b\x32\x37\x6d\x1b",
        "\x5b\x31\x6d\x1b\x5b\x30\x6d\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20",
        "\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20",
        "\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x0d\x20\x0d\x0d\x1b\x5b\x30\x6d\x1b\x5b",
        "\x32\x37\x6d\x1b\x5b\x32\x34\x6d\x1b\x5b\x4a\x74\x6f\x6d\x67\x73\x40\x74\x6f\x6d\x67\x73\x2d\x32\x20\x6e\x65\x65\x6b\x6f\x20\x25",
        "\x20\x1b\x5b\x4b\x1b\x5b\x3f\x32\x30\x30\x34\x68\x65\x08\x65\x63\x68\x6f\x20\x6e\x65\x65\x6b\x6f\x2d\x6f\x6b\x1b\x5b\x3f\x32\x30",
        "\x30\x34\x6c\x0d\x0d\x0a\x6e\x65\x65\x6b\x6f\x2d\x6f\x6b\x0d\x0a\x1b\x5b\x31\x6d\x1b\x5b\x37\x6d\x25\x1b\x5b\x32\x37\x6d\x1b\x5b",
        "\x31\x6d\x1b\x5b\x30\x6d\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20",
        "\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20",
        "\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x0d\x20\x0d\x0d\x1b\x5b\x30\x6d\x1b\x5b\x32",
        "\x37\x6d\x1b\x5b\x32\x34\x6d\x1b\x5b\x4a\x74\x6f\x6d\x67\x73\x40\x74\x6f\x6d\x67\x73\x2d\x32\x20\x6e\x65\x65\x6b\x6f\x20\x25\x20",
        "\x1b\x5b\x4b\x1b\x5b\x3f\x32\x30\x30\x34\x68\x65\x08\x65\x78\x69\x74\x1b\x5b\x3f\x32\x30\x30\x34\x6c\x0d\x0d\x0a",
    );

/// 真实 zsh 会话回放必须干净：无孤立 `%`、无空白行、无重复 prompt、
/// 命令与输出各一行。这是用户截图反馈的端到端回归钉子。
#[test]
fn real_zsh_session_replays_as_clean_commands_and_output() {
    let text = sanitize(ZSH_SESSION.as_bytes());
    let lines: Vec<&str> = text.split("\r\n").filter(|l| !l.is_empty()).collect();
    assert_eq!(
        lines,
        vec![
            "tomgs@tomgs-2 neeko % pwd",
            "/Users/tomgs/RustroverProjects/neeko",
            "tomgs@tomgs-2 neeko % echo neeko-ok",
            "neeko-ok",
            "tomgs@tomgs-2 neeko % exit",
        ],
        "{text:?}"
    );
    assert!(!text.contains("\r\n\r\n"), "不得出现空白行: {text:?}");
}

#[test]
fn strips_csi_colours_and_private_modes() {
    assert_eq!(sanitize(b"\x1b[32mhello\x1b[0m"), "hello");
    assert_eq!(sanitize(b"\x1b[?1049h\x1b[?25l\x1b[?2004h"), "");
    assert_eq!(
        sanitize(b"\x1b[38;2;215;119;87mcoloured\x1b[39m"),
        "coloured"
    );
    assert_eq!(sanitize(b"\x1b[2K\x1b[1Gprompt"), "prompt");
}

#[test]
fn strips_osc_both_terminators_and_dcs() {
    assert_eq!(sanitize(b"\x1b]0;title\x07prompt"), "prompt");
    assert_eq!(sanitize(b"\x1b]8;;url\x1b\\link\x1b]8;;\x1b\\"), "link");
    assert_eq!(sanitize(b"\x1bP+q544e\x1b\\after"), "after");
}

#[test]
fn strips_charset_single_escape_and_control_bytes() {
    assert_eq!(sanitize(b"\x1b(Bhello"), "hello");
    assert_eq!(sanitize(b"\x1b7saved\x1b8"), "saved");
    assert_eq!(sanitize(b"a\x00\x01\x07b\x7fc"), "abc");
}

#[test]
fn only_lf_commits_a_line_and_crlf_never_doubles() {
    assert_eq!(sanitize(b"a\r\nb"), "a\r\nb");
    assert_eq!(sanitize(b"a\nb"), "a\r\nb");
    // 单独 \r 是「归位 + 覆盖」，不是换行 —— 这正是 prompt 重绘的基础。
    assert_eq!(sanitize(b"abc\rX"), "Xbc");
    // TAB 展开到 8 列边界，避免光标列与显示列错位。
    assert_eq!(sanitize(b"a\tb"), "a       b");
}

/// 用户实测回归：zsh `PROMPT_SP` 输出「反显 % + 补白 + \r 归位 +
/// ESC[J 清到屏尾 + 真 prompt」。旧实现把 \r 当换行、把被擦除的文本留下，
/// 回放出一堆孤立 `%` / 空白行 / 重复 prompt。
#[test]
fn zsh_prompt_sp_redraw_leaves_one_clean_prompt() {
    let mut frame = Vec::new();
    frame.extend_from_slice(b"\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m");
    frame.extend_from_slice(&[b' '; 79]);
    frame.extend_from_slice(b"\r \r\r\x1b[0m\x1b[27m\x1b[24m\x1b[J");
    frame.extend_from_slice(b"tomgs@tomgs-2 neeko % \x1b[K\x1b[?2004h");
    let text = sanitize(&frame);
    assert_eq!(text, "tomgs@tomgs-2 neeko %", "{text:?}");
    assert_eq!(text.matches('%').count(), 1, "反显的孤立 % 必须被擦除");
    assert!(!text.contains('\r'), "未提交行不带 CRLF");
    assert!(!text.starts_with(' '), "PROMPT_SP 补白必须被擦除");
}

/// 连续多次 prompt 重绘 + 真正敲命令：只留一行命令、一行输出。
#[test]
fn repeated_prompt_redraws_do_not_duplicate_lines() {
    let mut bytes = Vec::new();
    for _ in 0..4 {
        bytes.extend_from_slice(b"%                                                                               \r \r\r\x1b[0m\x1b[27m\x1b[24m\x1b[J");
        bytes.extend_from_slice(b"tomgs@tomgs-2 neeko % \x1b[K");
    }
    bytes.extend_from_slice(b"\x1b[1G\x1b[2Ktomgs@tomgs-2 neeko % pwd\r\n");
    bytes.extend_from_slice(b"/Users/tomgs/RustroverProjects/neeko\r\n");
    let text = sanitize(&bytes);
    assert_eq!(
        text, "tomgs@tomgs-2 neeko % pwd\r\n/Users/tomgs/RustroverProjects/neeko\r\n",
        "{text:?}"
    );
}

/// 用户看到的 `ttop`：补全/重绘时的半截字符必须被 \r + ESC[K 覆盖掉。
#[test]
fn cursor_erase_removes_half_typed_command() {
    assert_eq!(
        sanitize(b"tomgs % t\r\x1b[Ktomgs % top\r\n"),
        "tomgs % top\r\n"
    );
}

#[test]
fn keeps_utf8_text() {
    assert_eq!(sanitize("\x1b[31m中文修复\x1b[0m".as_bytes()), "中文修复");
}

#[test]
fn unfinished_escape_is_not_emitted_as_text() {
    assert_eq!(sanitize(b"a\x1b[31"), "a");
}

#[test]
fn sanitizer_joins_escape_split_across_chunks() {
    let mut s = Sanitizer::new();
    // feed 只吐「已提交行」；当前行留在编辑器里直到 LF 或 finish。
    assert_eq!(s.feed(b"a\x1b[3"), "");
    assert_eq!(s.feed(b"1mhello\x1b[0"), "");
    assert_eq!(s.feed(b"m!\r\n"), "ahello!\r\n");
    assert_eq!(s.finish(), "");
}

#[test]
fn sanitizer_joins_utf8_split_across_chunks() {
    let bytes = "中文".as_bytes();
    let mut s = Sanitizer::new();
    let first = s.feed(&bytes[..2]); // 只剩「中」的前两字节
    let second = s.feed(&bytes[2..]);
    assert_eq!(format!("{first}{second}{}", s.finish()), "中文");
}

#[test]
fn sanitizer_bounds_a_never_closed_escape() {
    let mut s = Sanitizer::new();
    let huge = vec![b'x'; MAX_PENDING_ESCAPE + 100];
    let mut input = vec![0x1b, b']'];
    input.extend_from_slice(&huge);
    // 未闭合且超长 ⇒ 丢掉 ESC，剩余字节按普通可见文本输出（含 `]`）。
    // 关键不变量是「畸形序列不会把整段输出吞掉」，而不是内部 pending 字段。
    let out = s.feed(&input);
    let tail = s.finish();
    assert_eq!(out, "");
    assert!(tail.starts_with(']'), "{:?}", &tail[..20.min(tail.len())]);
    assert!(tail.len() >= huge.len() / 2, "可见文本不得被整段吞掉");
}

// ── tail ───────────────────────────────────────────────────────────────

#[test]
fn tail_appends_and_keeps_small_logs_intact() {
    assert_eq!(tail(b"", b"abc"), b"abc");
    assert_eq!(tail(b"cmd\r\n", b"out\r\n"), b"cmd\r\nout\r\n");
}

#[test]
fn tail_caps_bytes_and_keeps_the_newest_end() {
    let old = vec![b'a'; MAX_LOG_BYTES];
    let got = tail(&old, b"END");
    assert!(got.len() <= MAX_LOG_BYTES, "len = {}", got.len());
    assert!(got.ends_with(b"END"));
}

#[test]
fn tail_caps_lines_and_drops_the_oldest() {
    let mut old = Vec::new();
    for i in 0..MAX_LOG_LINES + 20 {
        old.extend_from_slice(format!("line{i}\r\n").as_bytes());
    }
    let got = tail(&old, b"last\r\n");
    assert_eq!(got.iter().filter(|&&b| b == b'\n').count(), MAX_LOG_LINES);
    assert!(got.ends_with(b"last\r\n"));
    assert!(!got.starts_with(b"line0\r\n"));
}

#[test]
fn tail_byte_cut_lands_on_a_utf8_boundary() {
    let mut buf = Vec::new();
    while buf.len() < MAX_LOG_BYTES + 64 {
        buf.extend_from_slice("中".as_bytes());
    }
    let got = tail(&buf, b"x");
    assert!(got.len() <= MAX_LOG_BYTES, "len = {}", got.len());
    assert!(std::str::from_utf8(&got).is_ok(), "截断不得产生非法 UTF-8");
    assert!(got.ends_with(b"x"));
}

// ── replay_payload ─────────────────────────────────────────────────────

#[test]
fn replay_payload_is_empty_for_empty_log() {
    assert!(replay_payload(b"").is_empty());
}

#[test]
fn replay_payload_appends_separator_on_a_new_line() {
    let got = replay_payload(b"cmd\r\noutput");
    let text = String::from_utf8(got).unwrap();
    assert!(text.starts_with("cmd\r\noutput\r\n"), "{text:?}");
    // 分界文案从常量取（不在断言里抄第二份，避免改一处留一处假绿）
    let separator = std::str::from_utf8(REPLAY_SEPARATOR).expect("separator is ascii + box chars");
    assert!(text.contains(separator.trim()), "{text:?}");
    // 用户可见输出用英文（根 AGENTS.md）；顺带挡住「又改回中文」的回归。
    assert!(
        !separator
            .chars()
            .any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c)),
        "回放分界必须是英文（用户可见输出），当前含中文：{separator:?}"
    );
    assert!(text.ends_with("\r\n\r\n"), "{text:?}");
    assert!(!text.contains('\u{1b}'), "回放不得含 ESC");
}

// ── HistoryStore：单一所有者 / 生命周期 / 路径安全 ─────────────────────

fn store_at(dir: &Path) -> Arc<HistoryStore> {
    Arc::new(HistoryStore::new(dir.to_path_buf()))
}

/// 等日志内容满足谓词。`feed` 吐「已提交行」、`finish` 吐「最后一行」，
/// 两次落盘之间有个窗口，不能一见到非空就返回（否则拿到的是半份日志）。
fn wait_for_log(store: &HistoryStore, id: &str, ready: impl Fn(&[u8]) -> bool) -> Vec<u8> {
    for _ in 0..100 {
        let got = store.read_tail(id);
        if ready(&got) {
            return got;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    store.read_tail(id)
}

#[test]
fn prepare_seeds_new_writer_with_old_history() {
    let tmp = tempfile::tempdir().unwrap();
    let store = store_at(&tmp.path().join("history"));
    // 先落一份「旧会话」日志
    let writer = store
        .start_writer("old", b"$ pwd\r\n/neeko\r\n".to_vec())
        .unwrap();
    writer.record(b"");
    drop(writer);
    // 等写线程落盘（异步），prepare 才能读到旧日志
    wait_for_log(&store, "old", |b| b.ends_with(b"/neeko\r\n"));
    // prepare 读回旧日志，作为新会话的 seed + 回放载荷
    let plan = store.prepare(Some("old")).unwrap();
    assert_eq!(plan.seed_for_test(), b"$ pwd\r\n/neeko\r\n");
    assert!(plan.replay().starts_with(b"$ pwd"));
    assert!(replay_payload(plan.seed_for_test()) == plan.replay());
}

#[test]
fn prepare_without_resume_or_for_agent_tui_is_empty() {
    let tmp = tempfile::tempdir().unwrap();
    let store = store_at(&tmp.path().join("history"));
    assert!(store.prepare(None).unwrap().replay().is_empty());
    assert!(store.prepare(Some("ghost")).unwrap().replay().is_empty());
}

#[test]
fn writer_persists_sanitized_text_and_stops_on_drop() {
    let tmp = tempfile::tempdir().unwrap();
    let store = store_at(&tmp.path().join("history"));
    let writer = store.start_writer("s1", Vec::new()).unwrap();
    writer.record(b"\x1b[32mhello\x1b[0m\r\nworld");
    drop(writer);
    let got = wait_for_log(&store, "s1", |b| b.ends_with(b"world\r\n"));
    assert_eq!(String::from_utf8(got).unwrap(), "hello\r\nworld\r\n");
    assert!(!tmp.path().join("history/s1.log.tmp").exists());
}

#[test]
fn writer_caps_the_log_at_the_configured_tail() {
    let tmp = tempfile::tempdir().unwrap();
    let store = store_at(&tmp.path().join("history"));
    let writer = store.start_writer("s2", Vec::new()).unwrap();
    for _ in 0..8 {
        writer.record(&vec![b'x'; 64 * 1024]);
    }
    drop(writer);
    let got = wait_for_log(&store, "s2", |b| b.ends_with(b"x\r\n"));
    assert!(got.len() <= MAX_LOG_BYTES, "len = {}", got.len());
    assert!(got.ends_with(b"x\r\n"), "尾部窗口必须以本行收尾");
}

#[test]
fn lifecycle_events_keep_files_in_sync_with_cursors() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("history");
    let store = store_at(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("old.log"), b"history").unwrap();
    std::fs::write(dir.join("orphan.log"), b"orphan").unwrap();
    std::fs::write(dir.join("kept.log"), b"kept").unwrap();
    std::fs::write(dir.join("stale.log.tmp"), b"").unwrap();

    // adopt 失败 ⇒ 不调 on_adopt ⇒ 旧文件还在
    assert!(dir.join("old.log").exists());
    store.on_adopt("old", "new");
    assert!(!dir.join("old.log").exists(), "adopt 成功后旧文件必须回收");
    // 新日志由 prepare 的 seed 生成（不再是 copy），这里模拟它已存在
    std::fs::write(dir.join("new.log"), b"history").unwrap();

    let live: HashSet<String> = ["new", "kept"].into_iter().map(String::from).collect();
    store.prune(&live);
    assert!(dir.join("new.log").exists());
    assert!(dir.join("kept.log").exists());
    assert!(!dir.join("orphan.log").exists(), "孤儿日志必须被清理");
    assert!(!dir.join("stale.log.tmp").exists(), "残留 tmp 必须被清理");

    store.on_unregister("new");
    assert!(!dir.join("new.log").exists());
}

#[test]
fn unsafe_session_ids_never_touch_the_filesystem() {
    let tmp = tempfile::tempdir().unwrap();
    let store = store_at(&tmp.path().join("history"));
    for bad in ["", "../escape", "a/b", "..", "id\x00", "id with space"] {
        assert!(!HistoryStore::is_safe_session_id(bad), "{bad:?} 必须被拒");
        assert!(store.read_tail(bad).is_empty());
        assert!(store.start_writer(bad, Vec::new()).is_none());
    }
    assert!(HistoryStore::is_safe_session_id("9f8e-7d6c_5b4a"));
    store.on_adopt("../escape", "into");
    store.on_unregister("../escape");
    assert!(!tmp.path().join("history/into.log").exists());
}

#[test]
fn missing_or_legacy_log_degrades_to_empty() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("does-not-exist");
    let store = store_at(&dir);
    assert!(store.read_tail("ghost").is_empty());
    assert!(replay_payload(&store.read_tail("ghost")).is_empty());

    let dir = tmp.path().join("history");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("legacy.log"), b"%    \r\n\r\ntomgs % \r\n").unwrap();
    let store = store_at(&dir);
    assert!(store.read_tail("legacy").is_empty(), "旧格式不得回放垃圾");
}

#[test]
fn magic_roundtrip_keeps_body_intact() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("history");
    let store = store_at(&dir);
    let writer = store
        .start_writer("s", b"$ pwd\r\n/neeko\r\n".to_vec())
        .unwrap();
    writer.record(b"\r\n");
    drop(writer);
    let got = wait_for_log(&store, "s", |b| b.ends_with(b"/neeko\r\n"));
    assert!(got.starts_with(b"$ pwd\r\n/neeko\r\n"), "{got:?}");
}

// ── 真实接线：回放顺序 / 载荷上限 ──────────────────────────────────────

/// 钉住 `spawn_pty_pipeline` 的顺序契约：回放字节在 drain 创建后 push，
/// reader 输出随后 push，前端 `take_and_rearm` 拿到的第一批必须是
/// [历史 | 分隔线 | 本次输出]。空日志时不 push 任何东西。
#[test]
fn replay_bytes_precede_reader_output_in_one_drain() {
    let drain = SessionDrain::default();
    let replay = replay_payload(b"$ echo hi\r\nhi\r\n");
    assert!(drain.push(&replay, || {}), "空缓冲必须接收回放载荷");
    assert!(drain.push(b"\x1b[?2004hnew-shell$ ", || {}));

    let first = drain.take_and_rearm(|| {});
    let text = String::from_utf8(first).unwrap();
    assert!(text.starts_with("$ echo hi"), "{text:?}");
    let marker = std::str::from_utf8(REPLAY_SEPARATOR)
        .expect("separator utf8")
        .trim();
    let sep = text.find(marker).expect("分隔线缺失");
    let shell = text.find("new-shell").expect("reader 输出缺失");
    assert!(sep < shell, "回放必须排在 reader 之前：{text:?}");

    let empty = SessionDrain::default();
    assert!(replay_payload(&[]).is_empty());
    assert!(empty.take_and_rearm(|| {}).is_empty());
}

#[test]
fn replay_payload_fits_the_drain_capacity() {
    let huge = vec![b'x'; MAX_LOG_BYTES];
    let payload = replay_payload(&tail(&[], &huge));
    assert!(payload.len() < 512 * 1024, "len = {}", payload.len());
    let drain = SessionDrain::default();
    assert!(drain.push(&payload, || {}));
}

/// 回归护栏：`HistoryStore` 的目录由构造方注入，模块内部**永远不**自行解析
/// `terminal_history_dir()`（除 `at_default_dir`）。曾因 `boot::restore` 直接调
/// `prune_orphans(terminal_history_dir())`，单测把真实用户日志全删了。
#[test]
fn store_never_touches_the_real_user_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("isolated");
    let store = store_at(&dir);
    // 造一份文件，再让所有生命周期事件跑一遍
    let writer = store.start_writer("keep", b"x\r\n".to_vec()).unwrap();
    writer.record(b"y\r\n");
    drop(writer);
    wait_for_log(&store, "keep", |b| b.ends_with(b"y\r\n"));
    let live: HashSet<String> = ["keep"].into_iter().map(String::from).collect();
    store.prune(&live);
    assert!(dir.join("keep.log").exists());
    // 该目录是 tempdir 子目录，不可能是 ~/.neeko/terminal_history
    assert!(dir.starts_with(tmp.path()));
}
