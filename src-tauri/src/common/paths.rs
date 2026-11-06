//! 应用数据目录与**版本化 SQLite 库**的路径解析。
//!
//! 两件事必须分开看，混在一起就会踩坑：
//!
//! | 状态 | 目录 | 会不会让旧 checkout 启动失败 |
//! | --- | --- | --- |
//! | `config.json` / `sessions.json` / 冷启动索引 / skills 仓库 / 用户工程 worktree | [`app_dir`] | 不会（无版本门禁） |
//! | `neeko.db`、`agent_sessions.db` | [`db_dir`] | **会**（`user_version` 只增不减） |
//!
//! `user_version` 是**整个文件一个整数**，所以它不能协商：某个 build 把库迁到 v14 之后，早于它的
//! checkout 必须拒绝打开（否则旧代码写新 schema 会静默损坏数据 —— `common/db/migrations.rs` 的
//! fail-closed 判据）。于是「两个 worktree 共用 `~/.neeko/neeko.db`」就变成互相踢出局：
//! 2026-10-30 实测 `multi-agent` worktree 的**未提交**迁移把库升到 14，main 一启动就 panic
//! （`Failed to create library store: Database schema version (14) is newer than this app supports (13)`）。
//!
//! [`db_dir`] 的 `NEEKO_DB_DIR` 覆写就是为此存在的隔离旋钮：给一个 worktree / dev 会话 / CI
//! 单独的库目录，两边互不影响。
//!
//! **为什么只覆盖库目录、不覆盖整个 `~/.neeko/`**：`worktrees/` 里是用户工程的真实 git worktree，
//! 路径已写进各自仓库与 session 记录；把整根目录搬走会让它们落在「预期根之外」，触发路径守卫
//! （红线 8 的同源校验）。带版本门禁的只有库，也只需要隔离库。

use std::path::PathBuf;

/// 覆写库目录的环境变量名。
pub const DB_DIR_ENV: &str = "NEEKO_DB_DIR";

/// 应用数据根目录：`~/.neeko/`（无库隔离语义）。
///
/// 只放**没有 schema 版本门禁**的状态。需要隔离版本化库时用 [`db_dir`]。
#[must_use]
pub fn app_dir() -> PathBuf {
    dirs::home_dir()
        .map(|home| home.join(".neeko"))
        .unwrap_or_else(|| PathBuf::from(".neeko"))
}

/// 版本化 SQLite 库所在目录。默认 [`app_dir`]，可用 [`DB_DIR_ENV`] 指向别处。
///
/// 覆写值必须是**绝对路径**：相对路径会随 cwd 漂移，同一个进程换个工作目录就能建出第二个库 ——
/// 那不是隔离，是随机。空值 / 相对路径一律当作未设置（fail-safe：认不出覆写值就退回默认，
/// 绝不因为一个打错的变量把库放到意料之外的地方）。
#[must_use]
pub fn db_dir() -> PathBuf {
    resolve_db_dir(std::env::var(DB_DIR_ENV).ok().as_deref(), app_dir())
}

/// `neeko.db` 的绝对路径（library + cache，`common/db/migrations.rs` 的单一迁移链）。
#[must_use]
pub fn library_db_path() -> PathBuf {
    db_dir().join("neeko.db")
}

/// `agent_sessions.db` 的绝对路径（agent chat 会话，私有迁移链）。
///
/// 与 [`library_db_path`] 同目录：隔离单位是目录 —— 只隔离一个文件会让两个库的
/// `user_version` 分别漂移，反而更难排查。
#[must_use]
pub fn agent_sessions_db_path() -> PathBuf {
    db_dir().join("agent_sessions.db")
}

/// [`db_dir`] 的纯函数内核：脱离进程环境直测（`env::set_var` 在测试里是全局副作用）。
#[must_use]
fn resolve_db_dir(override_value: Option<&str>, fallback: PathBuf) -> PathBuf {
    let Some(raw) = override_value else {
        return fallback;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return fallback;
    }
    let candidate = PathBuf::from(trimmed);
    if candidate.is_absolute() {
        return candidate;
    }
    log::warn!("[paths] {DB_DIR_ENV} 不是绝对路径（{trimmed:?}），已忽略并回退到默认库目录");
    fallback
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::testing::abs_fixture;

    #[test]
    fn db_dir_defaults_to_app_dir_when_override_is_absent() {
        let (_tmp, fallback) = abs_fixture("app-dir");
        assert_eq!(resolve_db_dir(None, fallback.clone()), fallback);
    }

    #[test]
    fn db_dir_honours_absolute_override_and_trims_whitespace() {
        let (_tmp, expected) = abs_fixture("db-dev");
        let (_fallback_tmp, fallback) = abs_fixture("app-dir");
        let padded = format!("  {}  ", expected.display());
        assert_eq!(resolve_db_dir(Some(&padded), fallback), expected);
    }

    #[test]
    fn db_dir_ignores_relative_and_blank_overrides() {
        let (_tmp, fallback) = abs_fixture("app-dir");
        for bad in ["relative/dir", "", "   ", "."] {
            assert_eq!(
                resolve_db_dir(Some(bad), fallback.clone()),
                fallback,
                "覆写值 {bad:?} 必须回退到默认目录"
            );
        }
    }

    #[test]
    fn versioned_db_paths_share_one_directory() {
        assert_eq!(
            library_db_path().parent(),
            agent_sessions_db_path().parent(),
            "两个版本化库必须同目录：隔离单位是目录，不是单个文件"
        );
    }
}
