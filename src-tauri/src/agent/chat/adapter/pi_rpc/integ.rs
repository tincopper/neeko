// ── 真机探针（`#[ignore]`，不进 CI 默认列表）────────────────────────────────
//!
//! 这三条用例覆盖的是**夹具永远抓不到**的一类问题：**身份形态**与**项目归属**。
//! 会话 id 在传输层（`--session` / `get_state.sessionId`）与文件层（文件名 / header）
//! 是两套东西，夹具里两边都由我们编造，怎么写都自洽；只有真机 pi 才回答
//! 「这个字符串到底是不是一个可用的会话句柄」。
//!
//! 实测结论（2026-10-30，pi 1.3.x）：
//!
//! | 输入 | 结果 |
//! | --- | --- |
//! | 会话文件 header 的 `id`（UUID） | ✅ 1.2s 握手，`get_state.sessionId` 原样返回 |
//! | 文件名 stem（`<iso>_<uuid>`） | ❌ `No session found matching '<stem>'` |
//! | 不存在的 id | ❌ 1.2s 失败，stderr 带原因（旧实现要等 5s 超时） |
//!
//! **入参必须与生产同源**：生产路径的 id 来自 [`PiAdapter::parse_meta`] 读的 header
//! `id`（`conversation/adapters/pi.rs`），cwd 来自同一 header 的 `cwd`。探针若自己拼一个
//! 「看起来像」的 id，量到的就是探针的行为 —— 这坑踩过一次（把文件名当 id，误报成缺陷）。
//!
//! 跑法：
//!
//! ```bash
//! cd src-tauri && cargo test --lib real_pi -- --ignored --nocapture
//! ```
//!
//! 需要：本机装了 `pi`，且 `~/.pi/agent/sessions/**` 里至少有一条**原项目目录仍存在**的会话。
//! 缺任意一条都会打印原因后跳过（不红）。

use std::io::{BufRead, BufReader};
use std::path::Path;

use super::PiRpcAdapter;
use crate::agent::chat::adapter::{AgentAdapter, AgentContext};
use crate::common::executor::factory::ExecTarget;

/// 真机探针的最大容忍耗时：旧实现会退化成 `AUX_TIMEOUT`(5s)，必须显著更快。
const FAST_FAIL_BUDGET: std::time::Duration = std::time::Duration::from_secs(5);

struct RealSession {
    /// header 的 `id` —— 传输层唯一合法的句柄。
    id: String,
    /// header 的 `cwd` —— pi 只在该目录下解析会话。
    cwd: String,
    /// 文件名 stem（`<iso>_<uuid>`）—— **不是**合法句柄，用来自证。
    stem: String,
}

fn probe_adapter() -> PiRpcAdapter {
    PiRpcAdapter::new(vec!["pi".into()], Default::default())
}

fn probe_ctx(project: &str) -> AgentContext {
    AgentContext {
        agent_id: "pi".into(),
        session_id: "real-pi-probe".into(),
        project_id: project.into(),
        project_name: "real-pi-probe".into(),
        env: "local".into(),
        skills: vec![],
        files: vec![],
        mode: "auto".into(),
        prompt: String::new(),
        model_id: None,
    }
}

/// 只读每个会话文件的**首行**（header），挑一条原项目目录仍存在的最老会话。
///
/// 取最老而非最新：避开用户可能正在用的会话，探针不会跟活跃进程抢同一个文件。
fn pick_session() -> Option<RealSession> {
    let root = dirs::home_dir()?.join(".pi/agent/sessions");
    if !root.is_dir() {
        return None;
    }
    let mut best: Option<(std::time::SystemTime, RealSession)> = None;
    for entry in walkdir::WalkDir::new(&root)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(header) = read_header(path) else {
            continue;
        };
        let (Some(id), Some(cwd)) = (
            header.get("id").and_then(|v| v.as_str()),
            header.get("cwd").and_then(|v| v.as_str()),
        ) else {
            continue;
        };
        // pi 拒绝恢复「原项目目录已不存在」的会话（会提示 fork 或直接报错）。
        if !Path::new(cwd).is_dir() {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(std::time::UNIX_EPOCH);
        if best.as_ref().is_none_or(|(t, _)| mtime < *t) {
            best = Some((
                mtime,
                RealSession {
                    id: id.to_string(),
                    cwd: cwd.to_string(),
                    stem: stem.to_string(),
                },
            ));
        }
    }
    best.map(|(_, s)| s)
}

fn read_header(path: &Path) -> Option<serde_json::Value> {
    let file = std::fs::File::open(path).ok()?;
    let mut line = String::new();
    BufReader::new(file).read_line(&mut line).ok()?;
    serde_json::from_str(line.trim()).ok()
}

async fn pi_installed() -> bool {
    crate::core::exec::command_exists(&ExecTarget::Local, "pi").await
}

/// AC2 的真机形态：用**会话 header 的 id** 恢复，pi 必须绑定到同一个会话。
#[tokio::test]
#[ignore = "真机：需要 pi 二进制 + 本机 pi 会话"]
async fn real_pi_resume_binds_to_the_session_header_id() {
    if !pi_installed().await {
        eprintln!("skip: 本机没有 pi");
        return;
    }
    let Some(session) = pick_session() else {
        eprintln!("skip: 没有「原项目目录仍存在」的 pi 会话");
        return;
    };
    let mut live = probe_adapter()
        .resume(&probe_ctx(&session.cwd), &session.id)
        .await
        .unwrap_or_else(|e| panic!("resume({}) 失败: {e}", session.id));
    let bound = live.resume_id();
    eprintln!(
        "real_pi: requested={} bound={bound:?} cwd={}",
        session.id, session.cwd
    );
    assert_eq!(bound.as_deref(), Some(session.id.as_str()));
    live.cancel().await;
}

/// 反证：文件名 stem **不是**传输层句柄 —— 生产必须读 header，不能从文件名推。
#[tokio::test]
#[ignore = "真机：需要 pi 二进制 + 本机 pi 会话"]
async fn real_pi_filename_stem_is_not_a_transport_id() {
    if !pi_installed().await {
        eprintln!("skip: 本机没有 pi");
        return;
    }
    let Some(session) = pick_session() else {
        eprintln!("skip: 没有「原项目目录仍存在」的 pi 会话");
        return;
    };
    if session.stem == session.id {
        eprintln!("skip: 该会话的文件名恰好等于 id，无法区分两者");
        return;
    }
    let result = probe_adapter()
        .resume(&probe_ctx(&session.cwd), &session.stem)
        .await;
    match result {
        Err(e) => {
            eprintln!("real_pi: stem={} 被拒绝: {e}", session.stem);
            assert!(
                format!("{e}").contains("No session found"),
                "拒绝理由必须来自 pi 的会话查找，实测 {e}"
            );
        }
        Ok(mut live) => {
            live.cancel().await;
            panic!("文件名 stem 竟然可以恢复 —— 与实测不符，说明 pi 的 id 语义变了");
        }
    }
}

/// AC3 的真机形态：不存在的 id 必须**快**失败（不退化成 5s 超时），且错误带 pi 的 stderr。
#[tokio::test]
#[ignore = "真机：需要 pi 二进制"]
async fn real_pi_missing_session_fails_fast_with_stderr() {
    if !pi_installed().await {
        eprintln!("skip: 本机没有 pi");
        return;
    }
    let cwd = std::env::temp_dir().display().to_string();
    let started = std::time::Instant::now();
    let err = match probe_adapter()
        .resume(&probe_ctx(&cwd), "00000000-no-such-session")
        .await
    {
        Err(e) => e,
        Ok(mut live) => {
            live.cancel().await;
            panic!("不存在的会话竟然恢复成功");
        }
    };
    let elapsed = started.elapsed();
    eprintln!("real_pi: elapsed={elapsed:?} err={err}");
    assert!(
        elapsed < FAST_FAIL_BUDGET,
        "不得退化成 5s 超时，实测 {elapsed:?}"
    );
    let text = format!("{err}").to_lowercase();
    assert!(
        text.contains("no session found"),
        "错误必须携带 pi 的 stderr 原因，实测 {err}"
    );
    assert!(
        !text.contains("timed out"),
        "不得退化成超时文案，实测 {err}"
    );
}
