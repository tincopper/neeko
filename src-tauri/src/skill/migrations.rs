use anyhow::{bail, Context, Result};
use rusqlite::Connection;

/// Current schema version. Bump this when adding a new migration.
const LATEST_VERSION: u32 = 3;

/// Run all pending migrations on the database.
pub fn run_migrations(conn: &Connection) -> Result<()> {
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
        conn.execute_batch("BEGIN EXCLUSIVE")?;
        match migrate_step(conn, version) {
            Ok(()) => {
                conn.pragma_update(None, "user_version", version + 1)?;
                conn.execute_batch("COMMIT")?;
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(e).with_context(|| {
                    format!("migration from version {version} to {} failed", version + 1)
                });
            }
        }
    }

    Ok(())
}

/// Execute a single migration step: version N -> N+1.
fn migrate_step(conn: &Connection, from_version: u32) -> Result<()> {
    match from_version {
        0 => migrate_v0_to_v1(conn),
        1 => migrate_v1_to_v2(conn),
        2 => migrate_v2_to_v3(conn),
        _ => bail!("unknown migration version: {from_version}"),
    }
}

/// v0 -> v1: Initial schema.
fn migrate_v0_to_v1(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS skills (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            source_type TEXT NOT NULL,
            source_ref TEXT,
            source_ref_resolved TEXT,
            source_subpath TEXT,
            source_branch TEXT,
            source_revision TEXT,
            remote_revision TEXT,
            central_path TEXT NOT NULL UNIQUE,
            content_hash TEXT,
            enabled INTEGER DEFAULT 1,
            status TEXT DEFAULT 'ok',
            update_status TEXT DEFAULT 'unknown',
            last_checked_at INTEGER,
            last_check_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);

        CREATE TABLE IF NOT EXISTS skill_targets (
            id TEXT PRIMARY KEY,
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            tool TEXT NOT NULL,
            target_path TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'copy',
            status TEXT DEFAULT 'ok',
            synced_at INTEGER,
            last_error TEXT,
            UNIQUE(skill_id, tool)
        );

        CREATE TABLE IF NOT EXISTS skill_tags (
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            PRIMARY KEY(skill_id, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_skill_tags_tag ON skill_tags(tag);

        CREATE TABLE IF NOT EXISTS tag_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            icon TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tag_group_skills (
            tag_group_id TEXT NOT NULL REFERENCES tag_groups(id) ON DELETE CASCADE,
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            added_at INTEGER,
            sort_order INTEGER DEFAULT 0,
            PRIMARY KEY(tag_group_id, skill_id)
        );

        CREATE TABLE IF NOT EXISTS tag_group_skill_tools (
            tag_group_id TEXT NOT NULL REFERENCES tag_groups(id) ON DELETE CASCADE,
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            tool TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(tag_group_id, skill_id, tool)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )?;
    Ok(())
}

/// v1 -> v2: Add project_tag_groups table for project-level tag binding.
fn migrate_v1_to_v2(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS project_tag_groups (
            project_id TEXT NOT NULL,
            tag_group_id TEXT NOT NULL REFERENCES tag_groups(id) ON DELETE CASCADE,
            added_at INTEGER NOT NULL,
            PRIMARY KEY(project_id, tag_group_id)
        );
        ",
    )?;
    Ok(())
}

/// v2 -> v3: Add skillssh_cache table for marketplace caching.
fn migrate_v2_to_v3(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS skillssh_cache (
            cache_key TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
        );
        ",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fresh_database_migrates_to_latest() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        run_migrations(&conn).unwrap();

        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, LATEST_VERSION);

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"skills".to_string()));
        assert!(tables.contains(&"skill_targets".to_string()));
        assert!(tables.contains(&"skill_tags".to_string()));
        assert!(tables.contains(&"tag_groups".to_string()));
        assert!(tables.contains(&"tag_group_skills".to_string()));
        assert!(tables.contains(&"tag_group_skill_tools".to_string()));
        assert!(tables.contains(&"settings".to_string()));
        assert!(tables.contains(&"skillssh_cache".to_string()));
    }

    #[test]
    fn test_idempotent_migration() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();

        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, LATEST_VERSION);
    }

    #[test]
    fn test_newer_schema_rejected() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", LATEST_VERSION + 1)
            .unwrap();

        let err = run_migrations(&conn).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("newer than this app supports"));
    }
}
