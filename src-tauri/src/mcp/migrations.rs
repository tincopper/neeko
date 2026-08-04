//! Database migrations for MCP (Model Context Protocol) tables.
//!
//! MCP tables share the same SQLite database as skill tables. Skill migrations
//! occupy versions 0-5; MCP migrations continue at version 6-10.
//!
//! Version history:
//! - v6 -> v7: Add mcp_servers table.
//! - v7 -> v8: Add MCP Registry source tracking columns to mcp_servers.
//! - v8 -> v9: Add url column to mcp_servers for remote (http/sse) transport.
//! - v9 -> v10: Add MCP tag groups, project bindings, and deployment targets.

use anyhow::{bail, Context, Result};
use rusqlite::Connection;

/// Current MCP schema version (continues from skill migrations at v5).
pub const LATEST_MCP_VERSION: u32 = 10;

/// Run all MCP migrations on the database.
///
/// MCP migrations start at version 6 (skill migrations occupy 0-5).
/// If skill migrations haven't run yet, they will be executed first.
pub fn run_migrations(conn: &Connection) -> Result<()> {
    let current: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    
    // MCP migrations start at version 6 (skill migrations occupy 0-5)
    if current >= LATEST_MCP_VERSION {
        return Ok(());
    }
    
    // If current is less than 6, run skill migrations first
    if current < 6 {
        crate::library::skill::migrations::run_migrations(conn)?;
    }
    
    // Start MCP migrations from version 6
    migrate_from(conn, 6)
}

fn migrate_from(conn: &Connection, from_version: u32) -> Result<()> {
    for v in from_version..LATEST_MCP_VERSION {
        migrate_step(conn, v)?;
    }
    conn.pragma_update(None, "user_version", LATEST_MCP_VERSION)?;
    Ok(())
}

fn migrate_step(conn: &Connection, from_version: u32) -> Result<()> {
    match from_version {
        6 => migrate_v6_to_v7(conn),
        7 => migrate_v7_to_v8(conn),
        8 => migrate_v8_to_v9(conn),
        9 => migrate_v9_to_v10(conn),
        v => bail!("Unknown MCP schema version: {v}"),
    }
}

/// v6 -> v7: Add mcp_servers table.
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
    fn test_mcp_tables_created() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        
        run_migrations(&conn).unwrap();

        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, LATEST_MCP_VERSION);

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"mcp_servers".to_string()));
        assert!(tables.contains(&"mcp_tag_groups".to_string()));
        assert!(tables.contains(&"mcp_tag_group_servers".to_string()));
        assert!(tables.contains(&"mcp_tag_group_server_agents".to_string()));
        assert!(tables.contains(&"project_mcp_tag_groups".to_string()));
        assert!(tables.contains(&"mcp_server_targets".to_string()));
    }

    #[test]
    fn test_mcp_migration_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap(); // Second run should be a no-op

        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, LATEST_MCP_VERSION);
    }
}
