//! The single migration chain for `neeko.db`.
//!
//! `user_version` is one integer per database file, so a database can only
//! have one version chain — it lives here, and only here. Each step's SQL
//! still belongs to the domain that owns the tables: this module decides
//! which domain runs which version range and nothing more.
//!
//! That split is what keeps `cache_entries` out of `library/migrations.rs`.
//! Putting it there would also work at runtime, but the cache domain would
//! then depend on the library domain to evolve its own tables.

use anyhow::{bail, Context, Result};
use rusqlite::{Connection, TransactionBehavior};

/// Last implemented `migrate_step` input. Add a new match arm and bump this
/// in the same commit as the migration SQL that creates the change.
const LIBRARY_MIGRATION_LAST: u32 = 11;
const CACHE_MIGRATION_STEP: u32 = LIBRARY_MIGRATION_LAST + 1;
/// 团队协调基质与统一任务中心的持久化步骤（13..=23，逐版本一步）。
///
/// 版本号是**已发布的事实**，不可重排：一个版本号一旦进过用户的库，就只能继续往后加。
/// 这段区间内两个域交替出现（team 五次 + work_items 一次 + team 四次），分派见 [`persist_step`]。
const TEAM_MIGRATION_FIRST: u32 = CACHE_MIGRATION_STEP + 1;
const TEAM_MIGRATION_LAST: u32 = 23;
/// Current schema version = last implemented step + 1.
pub const LATEST_VERSION: u32 = TEAM_MIGRATION_LAST + 1;

/// Run all pending migrations on the database.
pub fn run_migrations(conn: &mut Connection) -> Result<()> {
    let current: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if current > LATEST_VERSION {
        bail!(
            "Database schema version ({current}) is newer than this app supports ({LATEST_VERSION}). \
             Please upgrade the application."
        );
    }

    if current == LATEST_VERSION {
        return Ok(());
    }

    for version in current..LATEST_VERSION {
        // EXCLUSIVE, not the default IMMEDIATE: during a migration no other
        // connection may read either, or it observes a half-migrated schema.
        let tx = conn.transaction_with_behavior(TransactionBehavior::Exclusive)?;
        migrate_step(&tx, version).with_context(|| {
            format!("migration from version {version} to {} failed", version + 1)
        })?;
        tx.pragma_update(None, "user_version", version + 1)?;
        tx.commit()?;
    }

    Ok(())
}

/// Dispatch one migration step to the domain that owns those tables.
fn migrate_step(conn: &Connection, from_version: u32) -> Result<()> {
    match from_version {
        0..=LIBRARY_MIGRATION_LAST => crate::library::migrations::step(conn, from_version),
        version if version == CACHE_MIGRATION_STEP => crate::common::cache::v12_to_v13(conn),
        version if (TEAM_MIGRATION_FIRST..=TEAM_MIGRATION_LAST).contains(&version) => {
            persist_step(conn, version)
        }
        _ => bail!("unknown migration version: {from_version}"),
    }
}

/// 团队 / 任务中心的持久化步骤分派。
///
/// 与 `library` / `cache` 的边界同形（见模块头）：本模块只回答「哪个版本归谁」，
/// 建表 SQL 仍留在各自域里。步骤编号是已发布事实，禁止换序或复用。
fn persist_step(conn: &Connection, from_version: u32) -> Result<()> {
    match from_version {
        13 => crate::agent::team::store::v13_to_v14(conn),
        14 => crate::agent::team::store::v14_to_v15(conn),
        15 => crate::agent::team::store::v15_to_v16(conn),
        16 => crate::agent::team::store::v16_to_v17(conn),
        17 => crate::work_items::store::v17_to_v18(conn),
        18 => crate::agent::team::store::v18_to_v19(conn),
        19 => crate::agent::team::store::v19_to_v20(conn),
        20 => crate::agent::team::store::v20_to_v21(conn),
        21 => crate::agent::team::store::v21_to_v22(conn),
        22 => crate::agent::team::store::v22_to_v23(conn),
        23 => crate::agent::team::store::v23_to_v24(conn),
        _ => bail!("unknown persistence migration version: {from_version}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_version(conn: &Connection) -> u32 {
        conn.pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap()
    }

    fn table_names(conn: &Connection) -> Vec<String> {
        conn.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    #[test]
    fn fresh_database_migrates_to_latest() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        assert_eq!(user_version(&conn), LATEST_VERSION);

        let tables = table_names(&conn);
        for needed in [
            "skills",
            "skill_targets",
            "skill_tags",
            "tag_groups",
            "tag_group_skills",
            "tag_group_skill_tools",
            "settings",
            "project_tag_groups",
            "skillssh_cache",
            "prompts",
            "actions",
            "mcp_servers",
            "mcp_tag_groups",
            "mcp_tag_group_servers",
            "mcp_tag_group_server_agents",
            "project_mcp_tag_groups",
            "mcp_server_targets",
            "team",
            "team_member",
            "team_task",
            "team_event",
            "team_role",
            "work_item",
            "work_item_run",
        ] {
            assert!(
                tables.contains(&needed.to_string()),
                "missing table: {needed}"
            );
        }
    }

    #[test]
    fn migration_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();
        run_migrations(&mut conn).unwrap();

        assert_eq!(user_version(&conn), LATEST_VERSION);
    }

    #[test]
    fn newer_schema_rejected() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", LATEST_VERSION + 1)
            .unwrap();

        let err = run_migrations(&mut conn).unwrap_err();
        assert!(err.to_string().contains("newer than this app supports"));
    }

    #[test]
    fn no_migration_step_at_latest_version() {
        let conn = Connection::open_in_memory().unwrap();
        let err = migrate_step(&conn, LATEST_VERSION).unwrap_err();
        assert!(err.to_string().contains("unknown migration version"));
    }
}

#[cfg(test)]
mod atomicity_tests {
    use super::*;
    use rusqlite::Connection;

    /// One failing step must leave the schema and the version exactly as they
    /// were: `user_version` only advances after the step's SQL committed.
    ///
    /// Without this, a half-applied migration stamps a version that claims
    /// work the database never got, and the next boot skips it forever.
    #[test]
    fn failed_step_rolls_back_and_keeps_version() {
        let mut conn = Connection::open_in_memory().unwrap();

        // A step that creates a table and then fails.
        let result: Result<()> = (|| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Exclusive)?;
            tx.execute_batch("CREATE TABLE half_done (id INTEGER);")?;
            bail!("injected failure");
            #[allow(unreachable_code)]
            Ok(())
        })();

        assert!(result.is_err());
        drop(result);

        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 0, "a failed step must not advance user_version");

        let has_table: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='half_done'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(has_table, 0, "a failed step must not leave a table behind");
    }
}

#[cfg(test)]
mod upgrade_tests {
    use super::*;
    use rusqlite::Connection;

    /// A database written by the previous release (v12) must upgrade in
    /// place, gain the cache table, and keep every existing row.
    ///
    /// This is the test that makes the migration chain move safe: the chain
    /// was relocated between modules, so "did the library data survive" is
    /// exactly the question a relocate can break.
    #[test]
    fn upgrades_v12_database_preserving_library_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("neeko.db");

        // Build a v12 database by running the old chain to completion.
        {
            let mut conn = Connection::open(&path).unwrap();
            conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
            for version in 0..12u32 {
                let tx = conn
                    .transaction_with_behavior(TransactionBehavior::Exclusive)
                    .unwrap();
                crate::library::migrations::step(&tx, version).unwrap();
                tx.pragma_update(None, "user_version", version + 1).unwrap();
                tx.commit().unwrap();
            }
            let v: u32 = conn
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .unwrap();
            assert_eq!(v, 12, "fixture must be at v12 before the upgrade");

            // Library data that must survive untouched.
            conn.execute(
                "INSERT INTO skills (id, name, description, source_type, central_path, status,
                 created_at, updated_at) VALUES ('s1', 'Skill One', 'desc', 'local',
                 '/central/s1', 'ready', 1, 1)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO prompts (id, name, content, created_at, updated_at)
                 VALUES ('p1', 'Prompt One', 'body', 1, 1)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO mcp_servers (id, name, command, created_at, updated_at)
                 VALUES ('m1', 'MCP One', 'node', 1, 1)",
                [],
            )
            .unwrap();
        }

        let before = snapshot_library_rows(&path);

        // Run the full chain: v12 -> v13.
        {
            let mut conn = Connection::open(&path).unwrap();
            run_migrations(&mut conn).unwrap();
            let v: u32 = conn
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .unwrap();
            // 版本号只在这里断言一次：第二个字面量会随每次 bump 变成一条需要手工追的债。
            assert_eq!(v, LATEST_VERSION);
        }

        let conn = Connection::open(&path).unwrap();
        let has_cache: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='cache_entries'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(has_cache, 1, "cache_entries must exist after the upgrade");

        let has_team: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='team_task'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(has_team, 1, "team_task must exist after the upgrade");

        // v17→v18 走的是同一条升级链路：它必须也在「从旧库升上来」的路径上建好表，
        // 而不是只在新库首建时跑一次。
        let has_work_item: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='work_item'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(has_work_item, 1, "work_item must exist after the upgrade");

        assert_eq!(
            snapshot_library_rows(&path),
            before,
            "library rows must be byte-identical after the upgrade"
        );
    }

    fn snapshot_library_rows(path: &std::path::Path) -> Vec<String> {
        let conn = Connection::open(path).unwrap();
        let mut out = Vec::new();
        for sql in [
            "SELECT id || '|' || name || '|' || description FROM skills ORDER BY id",
            "SELECT id || '|' || name || '|' || content FROM prompts ORDER BY id",
            "SELECT id || '|' || name || '|' || command FROM mcp_servers ORDER BY id",
        ] {
            let mut stmt = conn.prepare(sql).unwrap();
            let rows: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            out.extend(rows);
        }
        out
    }

    /// The upgraded database still works: a library write and a cache write
    /// coexist, which proves the new step did not break the existing schema.
    #[test]
    fn upgraded_database_accepts_writes_to_both_domains() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        conn.execute(
            "INSERT INTO cache_entries (namespace, key, value, version, at)
             VALUES ('test', 'k', 'v', 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
"INSERT INTO skills (id, name, description, source_type, central_path, status,
             created_at, updated_at) VALUES ('s9', 'S9', 'd', 'local', '/central/s9', 'ready', 1, 1)",
            [],
        )
        .unwrap();

        let cache_count: i64 = conn
            .query_row("SELECT count(*) FROM cache_entries", [], |row| row.get(0))
            .unwrap();
        let skill_count: i64 = conn
            .query_row("SELECT count(*) FROM skills", [], |row| row.get(0))
            .unwrap();
        assert_eq!((cache_count, skill_count), (1, 1));
    }
}
