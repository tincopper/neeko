//! Database connection and migration utilities.

use rusqlite::Connection;
use std::path::Path;

/// Open a SQLite database at `db_path` with WAL journal mode and foreign keys enabled.
pub fn open(db_path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    Ok(conn)
}

/// Open an in-memory SQLite database with WAL journal mode and foreign keys enabled.
pub fn open_in_memory() -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    Ok(conn)
}
