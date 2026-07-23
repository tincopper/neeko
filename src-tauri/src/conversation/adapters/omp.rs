//! OMP (oh-my-pi) session adapter.
//!
//! Storage layout: `~/.omp/agent/sessions/<sanitized-cwd>/<timestamp>_<uuid>.jsonl`
//! Main sessions are **only** JSONL files directly under the sanitized directory.
//! Trace/sidecar JSONL under `.../<sessionId>/` subdirectories is ignored (D3).
//!
//! Wire format is close to Pi: `session` / `title` / `message` tree rows.

use std::path::{Path, PathBuf};

use anyhow::{bail, Result};

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage, ParsedMeta};
use crate::conversation::adapters::{
    linearize_tree_entries, parse_timestamp, read_jsonl, recent_messages_from, strip_ansi,
};
use crate::conversation::types::MessageBlock;

/// OMP CLI session adapter.
///
/// Production uses the default home-relative root. Tests inject a temp root via
/// [`OmpAdapter::with_root`] so main-session filtering is the same path as production.
#[derive(Debug, Default)]
pub struct OmpAdapter {
    root_override: Option<PathBuf>,
}

impl OmpAdapter {
    /// Production adapter (`~/.omp/agent/sessions`).
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Adapter with an explicit session root (fixtures / tests).
    #[must_use]
    pub fn with_root(root: PathBuf) -> Self {
        Self {
            root_override: Some(root),
        }
    }
}

/// True when `path` is a main session file relative to `session_root`:
/// `<root>/<sanitized>/<file>.jsonl` (exactly one directory segment, then the file).
fn is_main_session_file(session_root: &Path, file_path: &Path) -> bool {
    let Ok(rel) = file_path.strip_prefix(session_root) else {
        return false;
    };
    let mut comps = rel.components();
    // sanitized project dir
    if comps.next().is_none() {
        return false;
    }
    // file name
    let file = comps.next();
    // no deeper segments (trace lives under <sanitized>/<sessionDir>/...)
    comps.next().is_none()
        && file.is_some()
        && file_path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("jsonl"))
}

fn extract_text_from_message_content(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(parts) => {
            let mut out = String::new();
            for part in parts {
                if part.get("type").and_then(|v| v.as_str()) == Some("text") {
                    if let Some(t) = part.get("text").and_then(|v| v.as_str()) {
                        if !out.is_empty() {
                            out.push('\n');
                        }
                        out.push_str(t);
                    }
                }
            }
            out
        }
        _ => String::new(),
    }
}

impl AgentSessionAdapter for OmpAdapter {
    fn agent_id(&self) -> &str {
        "omp"
    }

    fn session_root(&self) -> PathBuf {
        if let Some(root) = &self.root_override {
            return root.clone();
        }
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("~"))
            .join(".omp")
            .join("agent")
            .join("sessions")
    }

    fn file_pattern(&self) -> &str {
        // Basename-only; Manager prefixes `**/`. Main-session depth filter in parse_meta.
        "*.jsonl"
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        let root = self.session_root();
        if !is_main_session_file(&root, file_path) {
            // Intentional noise filter — Manager treats `skip:` as silent.
            bail!("skip: OMP non-main session path {}", file_path.display());
        }

        let entries = read_jsonl(file_path)?;
        if entries.is_empty() {
            bail!("OMP session file is empty");
        }

        let session_entry = entries
            .iter()
            .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("session"));

        let native_session_id = session_entry
            .and_then(|e| e.get("id").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .or_else(|| {
                file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .and_then(|stem| stem.split('_').next_back().map(|s| s.to_string()))
            })
            .unwrap_or_else(|| {
                file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string()
            });

        let title = entries
            .iter()
            .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("title"))
            .and_then(|e| e.get("title").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        let started_at = session_entry
            .and_then(|e| e.get("timestamp").and_then(parse_timestamp))
            .or_else(|| {
                entries
                    .first()
                    .and_then(|e| e.get("timestamp").and_then(parse_timestamp))
            })
            .unwrap_or(0);

        let updated_at = entries
            .iter()
            .rev()
            .find_map(|e| e.get("timestamp").and_then(parse_timestamp))
            .or_else(|| {
                entries
                    .iter()
                    .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("title"))
                    .and_then(|e| e.get("updatedAt").and_then(parse_timestamp))
            })
            .unwrap_or(started_at);

        let project_path = session_entry
            .and_then(|e| e.get("cwd").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        let model = entries
            .iter()
            .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("model_change"))
            .and_then(|e| e.get("model").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        let linearized = linearize_tree_entries(&entries, "id", "parentId", "type", None);
        let mut first_user_message: Option<String> = None;
        let mut pairs: Vec<(String, String)> = Vec::new();
        let mut message_count: u32 = 0;

        for (idx, _seq) in &linearized {
            let entry = &entries[*idx];
            if entry.get("type").and_then(|v| v.as_str()) != Some("message") {
                continue;
            }
            let role = entry
                .pointer("/message/role")
                .and_then(|v| v.as_str())
                .unwrap_or("user")
                .to_string();
            let raw = entry
                .pointer("/message/content")
                .map(extract_text_from_message_content)
                .unwrap_or_default();
            let cleaned = strip_ansi(&raw);
            if cleaned.trim().is_empty() {
                continue;
            }
            message_count += 1;
            if first_user_message.is_none() && role == "user" {
                first_user_message = Some(cleaned.clone());
            }
            pairs.push((role, cleaned));
        }

        let recent_messages = recent_messages_from(pairs);

        Ok(ParsedMeta {
            native_session_id,
            title,
            first_user_message,
            recent_messages,
            model,
            started_at,
            updated_at,
            message_count,
            project_path,
        })
    }

    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
        let entries = read_jsonl(file_path)?;
        let linearized = linearize_tree_entries(&entries, "id", "parentId", "type", None);

        let mut messages = Vec::new();
        for (idx, seq) in &linearized {
            let entry = &entries[*idx];
            if entry.get("type").and_then(|v| v.as_str()) != Some("message") {
                continue;
            }

            let role = entry
                .pointer("/message/role")
                .and_then(|v| v.as_str())
                .unwrap_or("user")
                .to_string();

            let raw = entry
                .pointer("/message/content")
                .map(extract_text_from_message_content)
                .unwrap_or_default();
            let cleaned = strip_ansi(&raw);
            if cleaned.trim().is_empty() {
                continue;
            }

            let timestamp = entry
                .get("timestamp")
                .and_then(parse_timestamp)
                .unwrap_or(0);

            messages.push(ParsedMessage {
                role,
                content: cleaned.clone(),
                blocks: vec![MessageBlock::Text { text: cleaned }],
                model: None,
                timestamp,
                seq: *seq,
            });
        }

        Ok(messages)
    }

    fn extract_session_id(&self, file_path: &Path) -> Option<String> {
        let content = std::fs::read_to_string(file_path).ok()?;
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                if val.get("type").and_then(|v| v.as_str()) == Some("session") {
                    if let Some(id) = val.get("id").and_then(|v| v.as_str()) {
                        return Some(id.to_string());
                    }
                }
            }
        }
        file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    }

    fn resume_command(&self, native_session_id: &str, _project_path: &str) -> Option<Vec<String>> {
        Some(vec![format!("--resume={native_session_id}")])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation::manager::ConversationManager;
    use tempfile::TempDir;

    fn write_main_session(dir: &Path, sanitized: &str, filename: &str) -> PathBuf {
        let d = dir.join(sanitized);
        std::fs::create_dir_all(&d).unwrap();
        let path = d.join(filename);
        let content = r#"{"type":"title","v":1,"title":"Fix gh.rs","source":"auto","updatedAt":"2026-07-13T13:42:39.571Z"}
{"type":"session","version":3,"id":"019f5bb5-892b-7000-81f0-17bad4822cf8","timestamp":"2026-07-13T13:40:51.628Z","cwd":"/Users/tomgs/RustroverProjects/neeko"}
{"type":"model_change","id":"m1","parentId":null,"timestamp":"2026-07-13T13:40:51.679Z","model":"deepseek/deepseek-v4-pro"}
{"type":"message","id":"u1","parentId":null,"timestamp":"2026-07-13T13:41:37.693Z","message":{"role":"user","content":[{"type":"text","text":"hello"}],"timestamp":1783950097683}}
{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-07-13T13:41:40.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Hi!"}],"timestamp":1783950100000}}
"#;
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn should_parse_meta_and_messages_for_main_session() {
        let dir = TempDir::new().unwrap();
        let path = write_main_session(
            dir.path(),
            "-RustroverProjects-neeko",
            "2026-07-13T13-40-51-628Z_019f5bb5-892b-7000-81f0-17bad4822cf8.jsonl",
        );

        let adapter = OmpAdapter::with_root(dir.path().to_path_buf());
        let meta = adapter.parse_meta(&path).unwrap();
        assert_eq!(meta.native_session_id, "019f5bb5-892b-7000-81f0-17bad4822cf8");
        assert_eq!(meta.title.as_deref(), Some("Fix gh.rs"));
        assert_eq!(
            meta.project_path.as_deref(),
            Some("/Users/tomgs/RustroverProjects/neeko")
        );
        assert_eq!(meta.message_count, 2);
        assert_eq!(meta.model.as_deref(), Some("deepseek/deepseek-v4-pro"));

        let messages = adapter.parse_messages(&path).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert!(messages[0].content.contains("hello"));
        assert_eq!(messages[1].role, "assistant");
    }

    #[test]
    fn should_return_resume_flag() {
        let cmd = OmpAdapter::new().resume_command("019f5bb5-892b-7000-81f0-17bad4822cf8", "/p");
        assert_eq!(
            cmd,
            Some(vec![
                "--resume=019f5bb5-892b-7000-81f0-17bad4822cf8".to_string()
            ])
        );
    }

    #[test]
    fn is_main_session_file_rejects_nested_trace() {
        let root = PathBuf::from("/home/u/.omp/agent/sessions");
        let main = root.join("sanitized").join("sess.jsonl");
        let nested = root
            .join("sanitized")
            .join("sess-dir")
            .join("Frontend.jsonl");
        assert!(is_main_session_file(&root, &main));
        assert!(!is_main_session_file(&root, &nested));
    }

    #[test]
    fn should_skip_nested_trace_in_parse_meta() {
        let dir = TempDir::new().unwrap();
        let nested = dir
            .path()
            .join("-RustroverProjects-neeko")
            .join("sess-dir");
        std::fs::create_dir_all(&nested).unwrap();
        let path = nested.join("Frontend.jsonl");
        std::fs::write(&path, "{}\n").unwrap();

        let adapter = OmpAdapter::with_root(dir.path().to_path_buf());
        let err = adapter.parse_meta(&path).unwrap_err().to_string();
        assert!(err.starts_with("skip:"), "expected intentional skip, got {err}");
    }

    #[test]
    fn should_scan_only_main_via_manager_using_production_filter() {
        let dir = TempDir::new().unwrap();
        write_main_session(
            dir.path(),
            "-RustroverProjects-neeko",
            "2026-07-13T13-40-51-628Z_019f5bb5-892b-7000-81f0-17bad4822cf8.jsonl",
        );
        // nested trace should not be counted even if pattern matches
        let nested = dir
            .path()
            .join("-RustroverProjects-neeko")
            .join("2026-07-13T13-40-51-628Z_019f5bb5-892b-7000-81f0-17bad4822cf8");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("FrontendCommitPRTrace.jsonl"), "{}\n").unwrap();

        // Same production adapter type — only root is injected for fixtures.
        let manager = ConversationManager::new(vec![Box::new(OmpAdapter::with_root(
            dir.path().to_path_buf(),
        ))]);
        let reports = manager.scan_all().unwrap();
        assert_eq!(
            reports[0].sessions_found, 1,
            "nested trace must be silent-skipped; errors={:?}",
            reports[0].errors
        );
        assert!(
            reports[0].errors.is_empty(),
            "intentional skip must not flood errors: {:?}",
            reports[0].errors
        );
    }
}
