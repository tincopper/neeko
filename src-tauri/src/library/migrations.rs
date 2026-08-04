//! Unified database migrations for the library system.
//!
//! Combines the old `skill` migrations (v0-v9) and `mcp` migrations (v9-v10)
//! into a single linear chain. This eliminates the version conflict that
//! occurred when both modules tried to manage `user_version` independently.
//!
//! Version history:
//! - v0 -> v1: Initial schema (skills, targets, tags, tag_groups, settings).
//! - v1 -> v2: Add project_tag_groups.
//! - v2 -> v3: Add skillssh_cache.
//! - v3 -> v4: Add prompts table.
//! - v4 -> v5: Add actions table.
//! - v5 -> v6: Add agent_plugins table.
//! - v6 -> v7: Add mcp_servers table and kind column to prompts.
//! - v7 -> v8: Add MCP Registry source tracking columns.
//! - v8 -> v9: Add url column to mcp_servers.
//! - v9 -> v10: Add MCP tag groups, project bindings, deployment targets.

use anyhow::{bail, Context, Result};
use rusqlite::Connection;

/// Current schema version. Bump this when adding a new migration.
pub const LATEST_VERSION: u32 = 10;

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
        3 => migrate_v3_to_v4(conn),
        4 => migrate_v4_to_v5(conn),
        5 => migrate_v5_to_v6(conn),
        6 => migrate_v6_to_v7(conn),
        7 => migrate_v7_to_v8(conn),
        8 => migrate_v8_to_v9(conn),
        9 => migrate_v9_to_v10(conn),
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

/// v3 -> v4: Add prompts table for the Resource Library.
fn migrate_v3_to_v4(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS prompts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            content TEXT NOT NULL,
            slash TEXT,
            tags_json TEXT NOT NULL DEFAULT '[]',
            scope TEXT NOT NULL DEFAULT 'global',
            project_id TEXT,
            variables_json TEXT NOT NULL DEFAULT '[]',
            kind TEXT NOT NULL DEFAULT 'prompt',
            favorite INTEGER NOT NULL DEFAULT 0,
            usage_count INTEGER NOT NULL DEFAULT 0,
            last_used_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prompts_slash ON prompts(slash);
        CREATE INDEX IF NOT EXISTS idx_prompts_updated ON prompts(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_prompts_scope_project ON prompts(scope, project_id);
        CREATE INDEX IF NOT EXISTS idx_prompts_kind ON prompts(kind);
        ",
    )?;
    Ok(())
}

/// v4 -> v5: Add actions table for the Resource Library.
fn migrate_v4_to_v5(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS actions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            \"group\" TEXT NOT NULL DEFAULT 'custom',
            payload_json TEXT NOT NULL,
            shortcut TEXT,
            tags_json TEXT NOT NULL DEFAULT '[]',
            enabled INTEGER NOT NULL DEFAULT 1,
            usage_count INTEGER NOT NULL DEFAULT 0,
            last_used_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_actions_updated ON actions(updated_at DESC);
        ",
    )?;
    Ok(())
}

/// v5 -> v6: Add agent_plugins table for the Agent Plugin System.
fn migrate_v5_to_v6(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS agent_plugins (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT,
            description TEXT,
            version TEXT NOT NULL DEFAULT '1.0',
            is_builtin INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            execution_json TEXT NOT NULL,
            configuration_json TEXT NOT NULL,
            capabilities_json TEXT NOT NULL,
            paths_json TEXT NOT NULL,
            lifecycle_json TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        ",
    )?;
    Ok(())
}

/// v6 -> v7: Add mcp_servers table and kind column to prompts.
fn migrate_v6_to_v7(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS mcp_servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            command TEXT NOT NULL,
            args_json TEXT NOT NULL DEFAULT '[]',
            env_json TEXT NOT NULL DEFAULT '{}',
            transport TEXT NOT NULL DEFAULT 'stdio',
            scope TEXT NOT NULL DEFAULT 'global',
            project_id TEXT,
            tags_json TEXT NOT NULL DEFAULT '[]',
            enabled INTEGER NOT NULL DEFAULT 1,
            usage_count INTEGER NOT NULL DEFAULT 0,
            last_used_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name);
        ",
    )?;
    Ok(())
}

/// v7 -> v8: Add MCP Registry source tracking columns to mcp_servers.
fn migrate_v7_to_v8(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        ALTER TABLE mcp_servers ADD COLUMN source_registry TEXT;
        ALTER TABLE mcp_servers ADD COLUMN source_ref TEXT;
        ",
    )?;
    Ok(())
}

/// v8 -> v9: Add url column to mcp_servers for remote (http/sse) transport.
fn migrate_v8_to_v9(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        ALTER TABLE mcp_servers ADD COLUMN url TEXT;
        ",
    )?;
    Ok(())
}

/// v9 -> v10: Add MCP tag groups, project bindings, and deployment targets.
fn migrate_v9_to_v10(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS mcp_tag_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            icon TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS mcp_tag_group_servers (
            tag_group_id TEXT NOT NULL REFERENCES mcp_tag_groups(id) ON DELETE CASCADE,
            server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
            added_at INTEGER,
            sort_order INTEGER DEFAULT 0,
            PRIMARY KEY(tag_group_id, server_id)
        );

        CREATE TABLE IF NOT EXISTS mcp_tag_group_server_agents (
            tag_group_id TEXT NOT NULL REFERENCES mcp_tag_groups(id) ON DELETE CASCADE,
            server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(tag_group_id, server_id, agent_id)
        );

        CREATE TABLE IF NOT EXISTS project_mcp_tag_groups (
            project_id TEXT NOT NULL,
            tag_group_id TEXT NOT NULL REFERENCES mcp_tag_groups(id) ON DELETE CASCADE,
            added_at INTEGER NOT NULL,
            PRIMARY KEY(project_id, tag_group_id)
        );

        CREATE TABLE IF NOT EXISTS mcp_server_targets (
            id TEXT PRIMARY KEY,
            server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL,
            target_path TEXT NOT NULL,
            status TEXT DEFAULT 'ok',
            deployed_at INTEGER,
            last_error TEXT,
            UNIQUE(server_id, agent_id)
        );
        ",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_database_migrates_to_latest() {
        let conn = Connection::open_in_memory().unwrap();
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
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

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
            "agent_plugins",
            "mcp_servers",
            "mcp_tag_groups",
            "mcp_tag_group_servers",
            "mcp_tag_group_server_agents",
            "project_mcp_tag_groups",
            "mcp_server_targets",
        ] {
            assert!(
                tables.contains(&needed.to_string()),
                "missing table: {needed}"
            );
        }
    }

    #[test]
    fn migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();

        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, LATEST_VERSION);
    }

    #[test]
    fn newer_schema_rejected() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", LATEST_VERSION + 1)
            .unwrap();

        let err = run_migrations(&conn).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("newer than this app supports"));
    }
}
