//! 真机探针：**真实 opencode 库**上的「布局判据 + 计数同源 + 首条用户消息」。
//!
//! 夹具保证的是「逻辑自洽」；这里保证的是「真实存储形态还对得上」：
//! 表名 / 列名 / `data` JSON 的形状都是 opencode 自己决定的，夹具只能复刻我们**以为**的形状。
//! 上一轮事故（v2 升级后只显示 5 周前历史）正是「夹具全绿、真机全错」的形态。
//!
//! 布局无关：只断言「判据选出的那条读取路径能把这份库读通、且徽标与正文条数相等」，
//! 因此在 v1 库（未升级的机器）与 v2 库上都能跑。
//!
//! 跑法：
//!
//! ```bash
//! cd src-tauri && cargo test --lib real_opencode -- --ignored --nocapture
//! ```
//!
//! 需要本机存在 opencode 库（`~/.local/share/opencode/opencode*.db`，或 `OPENCODE_CONFIG_DIR`
//! 指向的目录）。没有则打印原因后跳过（不红）。

use std::path::PathBuf;

use super::super::common::matches_db_pattern;
use super::super::store::{self, Store};
use super::super::OpenCodeAdapter;
use super::super::{v1, v2};
use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage, ParsedMeta};
use crate::conversation::adapters::opencode::common::SYNTHETIC_SEP;

/// 抽查多少个会话的「徽标 vs 正文条数」——足够覆盖分页/空回合等形态，又不至于让探针变慢。
const SAMPLE_SIZE: usize = 40;

fn db_candidates() -> Vec<PathBuf> {
    // 与生产同源：`session_root()` 支持 `OPENCODE_CONFIG_DIR`，探针不自己拼 `~`。
    let root = OpenCodeAdapter.session_root();
    if !root.is_dir() {
        return Vec::new();
    }
    let mut dbs: Vec<PathBuf> = walkdir::WalkDir::new(&root)
        .min_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.path().is_file())
        .filter(|e| {
            e.path()
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(matches_db_pattern)
        })
        .map(|e| e.into_path())
        .collect();
    dbs.sort();
    dbs
}

fn read_all(
    store: Store,
    conn: &rusqlite::Connection,
    db: &std::path::Path,
) -> Vec<(ParsedMeta, PathBuf)> {
    match store {
        Store::V1 => v1::parse_opencode_db(conn, db, None).expect("v1 读取真机库"),
        Store::V2 => v2::parse_db(conn, db, None).expect("v2 读取真机库"),
    }
}

fn read_messages(store: Store, conn: &rusqlite::Connection, id: &str) -> Vec<ParsedMessage> {
    match store {
        Store::V1 => v1::parse_messages_v1(conn, id).expect("v1 解析正文"),
        Store::V2 => v2::parse_messages(conn, id).expect("v2 解析正文"),
    }
}

#[test]
#[ignore = "真机：需要本机存在 opencode 库"]
fn real_opencode_database_reads_through_the_detected_layout() {
    let dbs = db_candidates();
    if dbs.is_empty() {
        eprintln!("skip: 没有找到 opencode*.db（可用 OPENCODE_CONFIG_DIR 指定）");
        return;
    }

    for db in dbs {
        let (conn, store) = store::open_detected(&db).expect("打开真机库");
        let all = read_all(store, &conn, &db);
        let scoped = match store {
            Store::V1 => v1::parse_opencode_db(&conn, &db, Some("/")).unwrap_or_default(),
            Store::V2 => v2::parse_db(&conn, &db, Some("/")).unwrap_or_default(),
        };
        let newest = all.iter().map(|(m, _)| m.updated_at).max().unwrap_or(0);
        eprintln!(
            "real_opencode: db={} store={store:?} sessions={} (under / : {}) newest_ms={newest}",
            db.display(),
            all.len(),
            scoped.len()
        );

        // 判据必须落到有数据的那套表：读出来 0 条但库里其实有会话，就是判据错了。
        assert!(
            !all.is_empty(),
            "库 {} 判成 {store:?} 却读出 0 条会话 —— 布局判据或列名与真实 schema 不符",
            db.display()
        );
        assert!(
            all.windows(2)
                .all(|w| w[0].0.updated_at >= w[1].0.updated_at),
            "列表必须按 updated_at 倒序"
        );

        // §4.6.3：徽标（列表聚合）与正文（逐条解析）必须同源。
        let mut checked = 0;
        let mut null_titles_with_first_user = 0;
        for (meta, synthetic) in all.iter() {
            if meta.message_count == 0 {
                continue;
            }
            let parsed = read_messages(store, &conn, &meta.native_session_id);
            assert_eq!(
                meta.message_count,
                u32::try_from(parsed.len()).expect("条数不会超过 u32"),
                "会话 {}（{}）徽标 {} ≠ 正文 {}",
                meta.native_session_id,
                synthetic.display(),
                meta.message_count,
                parsed.len()
            );
            if meta.title.is_none() && meta.first_user_message.is_some() {
                null_titles_with_first_user += 1;
            }
            checked += 1;
            if checked >= SAMPLE_SIZE {
                break;
            }
        }
        assert!(checked > 0, "库 {} 里没有一条带正文的会话？", db.display());
        eprintln!(
            "real_opencode: count==parsed 抽查 {checked} 条通过；空标题靠首条用户消息补上 {null_titles_with_first_user} 条"
        );

        // 合成路径契约：面板点一行 → `parse_meta(<db>#<id>)` 必须走同一条读取路径。
        let (meta, synthetic) = &all[0];
        let via_path = OpenCodeAdapter
            .parse_meta(synthetic)
            .expect("合成路径 parse_meta");
        assert_eq!(via_path.message_count, meta.message_count);
        assert_eq!(via_path.native_session_id, meta.native_session_id);
        assert!(synthetic
            .to_string_lossy()
            .contains(&format!("{SYNTHETIC_SEP}{}", meta.native_session_id)));
    }
}
