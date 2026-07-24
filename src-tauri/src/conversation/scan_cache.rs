//! Process-local scan parse cache (fingerprint + optional JSONL resume).
//!
//! Design goals:
//! - High cohesion: all mtime/size reuse lives here (not in UI or adapters).
//! - Low coupling: adapters keep parse semantics; manager / bulk adapters
//!   ask this module whether a source is unchanged.
//! - Extensible: file meta, bulk (SQLite) meta, and JSONL line resume share
//!   the same signature primitive.
//!
//! This is intentionally **not** a disk index (cold start still rescans).
//! Unchanged sources on rescan should be near I/O-free.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::SystemTime;

use anyhow::{Context, Result};

use crate::conversation::adapter::ParsedMeta;

/// Soft cap so a long-lived process does not retain unbounded parse results.
const MAX_FILE_META_ENTRIES: usize = 4096;
const MAX_BULK_META_ENTRIES: usize = 32;
const MAX_JSONL_ENTRIES: usize = 256;

/// Filesystem fingerprint used as a cache key component.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceSignature {
    /// File size in bytes.
    pub len: u64,
    /// Last modification time from the filesystem.
    pub modified: SystemTime,
}

/// Snapshot of a source file (len + mtime). Returns `None` if unreadable.
#[must_use]
pub fn source_signature(path: &Path) -> Option<SourceSignature> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    Some(SourceSignature {
        len: meta.len(),
        modified,
    })
}

#[derive(Debug, Clone)]
struct FileMetaEntry {
    signature: SourceSignature,
    meta: ParsedMeta,
}

#[derive(Debug, Clone)]
struct BulkMetaEntry {
    signature: SourceSignature,
    sessions: Vec<(ParsedMeta, PathBuf)>,
}

#[derive(Debug, Clone)]
struct JsonlEntry {
    signature: SourceSignature,
    /// Absolute byte offset just past the last fully consumed `\n`-terminated line.
    consumed_bytes: u64,
    entries: Vec<serde_json::Value>,
}

/// Process-local caches for conversation scanning.
#[derive(Default)]
struct ScanParseCache {
    /// Per session file (JSONL / JSON) → last parsed list meta.
    file_meta: HashMap<PathBuf, FileMetaEntry>,
    /// Per bulk source (e.g. OpenCode DB) → last parsed session metas.
    bulk_meta: HashMap<PathBuf, BulkMetaEntry>,
    /// Per JSONL path → lines + resume point for append-only growth.
    jsonl: HashMap<PathBuf, JsonlEntry>,
}

static SCAN_PARSE_CACHE: LazyLock<Mutex<ScanParseCache>> =
    LazyLock::new(|| Mutex::new(ScanParseCache::default()));

fn with_cache<T>(f: impl FnOnce(&mut ScanParseCache) -> T) -> T {
    let mut guard = SCAN_PARSE_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    f(&mut guard)
}

/// Clear all scan caches (tests only).
#[cfg(test)]
pub fn reset_scan_parse_cache_for_tests() {
    with_cache(|c| {
        c.file_meta.clear();
        c.bulk_meta.clear();
        c.jsonl.clear();
    });
}

fn touch_insert<K: Eq + std::hash::Hash + Clone, V>(map: &mut HashMap<K, V>, key: K, value: V, max: usize) {
    // Refresh recency: remove then re-insert so eviction drops oldest insert order.
    map.remove(&key);
    map.insert(key, value);
    while map.len() > max {
        if let Some(oldest) = map.keys().next().cloned() {
            map.remove(&oldest);
        } else {
            break;
        }
    }
}

/// Return cached `ParsedMeta` when `path` still matches `signature`.
#[must_use]
pub fn get_cached_file_meta(path: &Path, signature: &SourceSignature) -> Option<ParsedMeta> {
    with_cache(|c| {
        let entry = c.file_meta.get(path)?;
        if &entry.signature == signature {
            Some(entry.meta.clone())
        } else {
            None
        }
    })
}

/// Store list meta for a session file under its current signature.
pub fn put_cached_file_meta(path: PathBuf, signature: SourceSignature, meta: ParsedMeta) {
    with_cache(|c| {
        touch_insert(
            &mut c.file_meta,
            path,
            FileMetaEntry { signature, meta },
            MAX_FILE_META_ENTRIES,
        );
    });
}

/// Return cached bulk session list when the bulk source fingerprint matches.
#[must_use]
pub fn get_cached_bulk_metas(
    source_path: &Path,
    signature: &SourceSignature,
) -> Option<Vec<(ParsedMeta, PathBuf)>> {
    with_cache(|c| {
        let entry = c.bulk_meta.get(source_path)?;
        if &entry.signature == signature {
            Some(entry.sessions.clone())
        } else {
            None
        }
    })
}

/// Store bulk parse results (OpenCode DB, etc.).
pub fn put_cached_bulk_metas(
    source_path: PathBuf,
    signature: SourceSignature,
    sessions: Vec<(ParsedMeta, PathBuf)>,
) {
    with_cache(|c| {
        touch_insert(
            &mut c.bulk_meta,
            source_path,
            BulkMetaEntry {
                signature,
                sessions,
            },
            MAX_BULK_META_ENTRIES,
        );
    });
}

/// Read a JSONL file with process-local mtime/size reuse and append resume.
///
/// - Unchanged signature → clone cached lines (no disk read).
/// - File only grew → read bytes from the last complete-line offset and append.
/// - Shrink / non-monotonic change → full re-parse.
pub fn read_jsonl_cached(path: &Path) -> Result<Vec<serde_json::Value>> {
    let signature = source_signature(path).with_context(|| {
        format!("Failed to stat JSONL for scan cache: {}", path.display())
    })?;

    // Snapshot prior entry without holding the lock across I/O.
    let prior = with_cache(|c| c.jsonl.get(path).cloned());

    if let Some(entry) = prior.as_ref() {
        if entry.signature == signature {
            return Ok(entry.entries.clone());
        }

        // Append-only growth: same or newer mtime, strictly larger size, resume valid.
        let can_resume = signature.len > entry.signature.len
            && signature.modified >= entry.signature.modified
            && entry.consumed_bytes <= entry.signature.len
            && entry.consumed_bytes < signature.len
            && is_valid_resume_boundary(path, entry.consumed_bytes).unwrap_or(false);

        if can_resume {
            match read_jsonl_from_offset(path, entry.consumed_bytes) {
                Ok((new_lines, new_consumed)) => {
                    let mut merged = entry.entries.clone();
                    merged.extend(new_lines);
                    with_cache(|c| {
                        touch_insert(
                            &mut c.jsonl,
                            path.to_path_buf(),
                            JsonlEntry {
                                signature,
                                consumed_bytes: new_consumed,
                                entries: merged.clone(),
                            },
                            MAX_JSONL_ENTRIES,
                        );
                    });
                    return Ok(merged);
                }
                Err(e) => {
                    log::debug!(
                        "JSONL resume failed for {}: {e:#}; falling back to full read",
                        path.display()
                    );
                }
            }
        }
    }

    let (entries, consumed) = read_jsonl_from_offset(path, 0)?;
    with_cache(|c| {
        touch_insert(
            &mut c.jsonl,
            path.to_path_buf(),
            JsonlEntry {
                signature,
                consumed_bytes: consumed,
                entries: entries.clone(),
            },
            MAX_JSONL_ENTRIES,
        );
    });
    Ok(entries)
}

/// True when `offset == 0` or the previous byte is a line terminator.
fn is_valid_resume_boundary(path: &Path, offset: u64) -> Result<bool> {
    if offset == 0 {
        return Ok(true);
    }
    let mut file = File::open(path)
        .with_context(|| format!("Failed to open for resume check: {}", path.display()))?;
    file.seek(SeekFrom::Start(offset - 1))
        .with_context(|| format!("Failed to seek resume boundary: {}", path.display()))?;
    let mut prev = [0_u8; 1];
    file.read_exact(&mut prev)
        .with_context(|| format!("Failed to read resume boundary: {}", path.display()))?;
    Ok(prev[0] == b'\n' || prev[0] == b'\r')
}

/// Parse complete JSONL lines starting at `byte_offset`.
///
/// Returns `(entries, consumed_through)` where `consumed_through` is the absolute
/// byte offset just past the last complete line (trailing unterminated bytes are
/// left unconsumed so the next resume does not split a line).
pub fn read_jsonl_from_offset(
    path: &Path,
    byte_offset: u64,
) -> Result<(Vec<serde_json::Value>, u64)> {
    let mut file = File::open(path)
        .with_context(|| format!("Failed to open JSONL: {}", path.display()))?;
    file.seek(SeekFrom::Start(byte_offset))
        .with_context(|| format!("Failed to seek JSONL: {}", path.display()))?;

    let mut reader = BufReader::new(file);
    let mut entries = Vec::new();
    let mut consumed = byte_offset;
    let mut line_buf = Vec::new();

    loop {
        line_buf.clear();
        let read = reader
            .read_until(b'\n', &mut line_buf)
            .with_context(|| format!("Failed to read JSONL line: {}", path.display()))?;
        if read == 0 {
            break;
        }

        let had_newline = line_buf.last().copied() == Some(b'\n');
        if !had_newline {
            // Incomplete trailing line: do not advance consumed past its start.
            break;
        }

        let line_bytes = read as u64;
        // Strip trailing \n and optional \r
        if line_buf.last() == Some(&b'\n') {
            line_buf.pop();
        }
        if line_buf.last() == Some(&b'\r') {
            line_buf.pop();
        }

        consumed = consumed.saturating_add(line_bytes);

        let line = match std::str::from_utf8(&line_buf) {
            Ok(s) => s,
            Err(e) => {
                log::debug!("Skipping non-UTF8 JSONL line: {e}");
                continue;
            }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let cleaned = trimmed.strip_suffix(',').unwrap_or(trimmed);
        match serde_json::from_str::<serde_json::Value>(cleaned) {
            Ok(v) => entries.push(v),
            Err(e) => {
                log::debug!("Failed to parse JSONL line: {e}: {line}");
            }
        }
    }

    Ok((entries, consumed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Seek, Write};
    use tempfile::NamedTempFile;

    fn write_lines(file: &mut NamedTempFile, lines: &[&str]) {
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
        file.flush().unwrap();
    }

    #[test]
    fn should_reuse_jsonl_when_signature_unchanged() {
        reset_scan_parse_cache_for_tests();
        let mut tmp = NamedTempFile::new().unwrap();
        write_lines(&mut tmp, &[r#"{"type":"user","text":"hi"}"#]);

        let first = read_jsonl_cached(tmp.path()).unwrap();
        assert_eq!(first.len(), 1);

        // Second read must not depend on rewriting the file.
        let second = read_jsonl_cached(tmp.path()).unwrap();
        assert_eq!(second, first);
    }

    #[test]
    fn should_resume_jsonl_on_append() {
        reset_scan_parse_cache_for_tests();
        let mut tmp = NamedTempFile::new().unwrap();
        write_lines(&mut tmp, &[r#"{"n":1}"#]);

        let first = read_jsonl_cached(tmp.path()).unwrap();
        assert_eq!(first.len(), 1);

        // Append a second complete line.
        writeln!(tmp, r#"{{"n":2}}"#).unwrap();
        tmp.flush().unwrap();

        let second = read_jsonl_cached(tmp.path()).unwrap();
        assert_eq!(second.len(), 2);
        assert_eq!(second[0]["n"], 1);
        assert_eq!(second[1]["n"], 2);
    }

    #[test]
    fn should_full_reread_when_jsonl_shrinks() {
        reset_scan_parse_cache_for_tests();
        let mut tmp = NamedTempFile::new().unwrap();
        write_lines(
            &mut tmp,
            &[r#"{"n":1}"#, r#"{"n":2}"#, r#"{"n":3}"#],
        );
        let first = read_jsonl_cached(tmp.path()).unwrap();
        assert_eq!(first.len(), 3);

        // Truncate and rewrite smaller content.
        tmp.as_file_mut().set_len(0).unwrap();
        tmp.seek(SeekFrom::Start(0)).unwrap();
        write_lines(&mut tmp, &[r#"{"n":9}"#]);

        let second = read_jsonl_cached(tmp.path()).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0]["n"], 9);
    }

    #[test]
    fn should_cache_file_meta_by_signature() {
        reset_scan_parse_cache_for_tests();
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();
        let sig = source_signature(&path).unwrap();

        let meta = ParsedMeta {
            native_session_id: "s1".into(),
            title: Some("t".into()),
            first_user_message: None,
            recent_messages: vec![],
            model: None,
            started_at: 1,
            updated_at: 2,
            message_count: 3,
            project_path: None,
        };
        put_cached_file_meta(path.clone(), sig, meta.clone());

        let hit = get_cached_file_meta(&path, &sig).unwrap();
        assert_eq!(hit.native_session_id, "s1");
        assert_eq!(hit.message_count, 3);

        // Different signature must miss.
        let mut other = sig;
        other.len = sig.len.saturating_add(1);
        assert!(get_cached_file_meta(&path, &other).is_none());
    }

    #[test]
    fn should_cache_bulk_metas_by_signature() {
        reset_scan_parse_cache_for_tests();
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();
        let sig = source_signature(&path).unwrap();

        let meta = ParsedMeta {
            native_session_id: "bulk-1".into(),
            title: None,
            first_user_message: None,
            recent_messages: vec![],
            model: None,
            started_at: 0,
            updated_at: 0,
            message_count: 0,
            project_path: Some("/p".into()),
        };
        put_cached_bulk_metas(
            path.clone(),
            sig,
            vec![(meta, PathBuf::from("syn#bulk-1"))],
        );

        let hit = get_cached_bulk_metas(&path, &sig).unwrap();
        assert_eq!(hit.len(), 1);
        assert_eq!(hit[0].0.native_session_id, "bulk-1");
    }

    #[test]
    fn should_leave_unterminated_trailing_line_unconsumed() {
        reset_scan_parse_cache_for_tests();
        let mut tmp = NamedTempFile::new().unwrap();
        // One complete line + incomplete trailing payload without newline.
        write!(tmp, "{}\n{}", r#"{"n":1}"#, r#"{"n":2"#).unwrap();
        tmp.flush().unwrap();

        let (entries, consumed) = read_jsonl_from_offset(tmp.path(), 0).unwrap();
        assert_eq!(entries.len(), 1);
        // consumed should stop after the first line's newline, not include trailing junk.
        let content = std::fs::read(tmp.path()).unwrap();
        assert_eq!(consumed as usize, content.iter().position(|&b| b == b'\n').unwrap() + 1);

        // Completing the second line should resume correctly.
        writeln!(tmp).unwrap(); // finish with newline — incomplete object still fails parse
        // Write a proper second line by rewriting file cleanly then appending after first read pattern:
        tmp.as_file_mut().set_len(0).unwrap();
        tmp.seek(SeekFrom::Start(0)).unwrap();
        write_lines(&mut tmp, &[r#"{"n":1}"#]);
        let (_e, offset) = read_jsonl_from_offset(tmp.path(), 0).unwrap();
        writeln!(tmp, r#"{{"n":2}}"#).unwrap();
        tmp.flush().unwrap();
        let (more, _) = read_jsonl_from_offset(tmp.path(), offset).unwrap();
        assert_eq!(more.len(), 1);
        assert_eq!(more[0]["n"], 2);
    }
}
