//! Extensible project task discovery.
//!
//! Each ecosystem implements [`TaskSource`]. The registry runs all sources and
//! merges results. New detectors (Cargo, Makefile, Just, …) only need a new
//! module + a line in [`builtin_sources`] — no changes to orchestration or IPC.

mod java;
mod main_entry;
mod package_json;

use std::path::Path;

use serde::{Deserialize, Serialize};

pub use main_entry::MainEntrySource;
pub use package_json::PackageJsonSource;

/// One auto-discovered runnable task (not yet persisted unless imported).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredTask {
    /// Stable id across scans, e.g. `pkg:dev`. Safe to use as saved TaskConfig.id.
    pub id: String,
    /// Short label for the UI.
    pub name: String,
    /// Shell command to execute in the project cwd.
    pub command: String,
    /// Source plugin id, e.g. `package_json`.
    pub source: String,
    /// UI group heading, e.g. `npm scripts (pnpm)`.
    pub group: String,
    /// Optional detail (script body or path).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Higher = preferred (dev/test/build). Used for stable sort only.
    pub priority: i32,
}

/// Pluggable detector. Implementations must be pure and side-effect free
/// aside from reading files under `project_path`.
pub trait TaskSource: Send + Sync {
    /// Stable plugin id (`package_json`, `cargo`, …).
    fn id(&self) -> &'static str;

    /// Scan `project_path` and return zero or more discovered tasks.
    fn discover(&self, project_path: &Path) -> Vec<DiscoveredTask>;
}

/// Built-in sources. Append new detectors here only.
fn builtin_sources() -> Vec<Box<dyn TaskSource>> {
    vec![
        Box::new(PackageJsonSource),
        Box::new(MainEntrySource),
        // Future: MakefileSource, JustfileSource, …
    ]
}

/// Run all registered sources and return a de-duplicated, priority-sorted list.
pub fn discover_tasks(project_path: &Path) -> Vec<DiscoveredTask> {
    if !project_path.is_dir() {
        return Vec::new();
    }

    let mut out: Vec<DiscoveredTask> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for source in builtin_sources() {
        for task in source.discover(project_path) {
            if seen.insert(task.id.clone()) {
                out.push(task);
            }
        }
    }

    out.sort_by(|a, b| {
        b.priority
            .cmp(&a.priority)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.id.cmp(&b.id))
    });
    out
}

/// Convert a discovered task into a project-scoped persisted config.
pub fn to_task_config(task: &DiscoveredTask, project_id: Option<String>) -> super::TaskConfig {
    super::TaskConfig {
        id: task.id.clone(),
        name: task.name.clone(),
        command: task.command.clone(),
        scope: "project".into(),
        project_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn should_discover_package_json_scripts_via_registry() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{ "name": "demo", "scripts": { "dev": "vite", "test": "vitest" } }"#,
        )
        .unwrap();
        fs::write(
            dir.path().join("pnpm-lock.yaml"),
            "lockfileVersion: '9.0'\n",
        )
        .unwrap();

        let tasks = discover_tasks(dir.path());
        assert!(tasks.iter().any(|t| t.id == "pkg:dev"));
        assert!(tasks.iter().any(|t| t.id == "pkg:test"));
        let dev = tasks.iter().find(|t| t.id == "pkg:dev").unwrap();
        assert_eq!(dev.command, "pnpm run dev");
        assert_eq!(dev.source, "package_json");
        // dev has higher priority than arbitrary scripts
        assert!(dev.priority >= 90);
    }

    #[test]
    fn should_return_empty_for_non_project_dir() {
        let dir = tempdir().unwrap();
        assert!(discover_tasks(dir.path()).is_empty());
    }

    #[test]
    fn should_map_discovered_to_task_config() {
        let t = DiscoveredTask {
            id: "pkg:build".into(),
            name: "build".into(),
            command: "npm run build".into(),
            source: "package_json".into(),
            group: "npm scripts".into(),
            description: None,
            priority: 80,
        };
        let cfg = to_task_config(&t, Some("proj-1".into()));
        assert_eq!(cfg.id, "pkg:build");
        assert_eq!(cfg.scope, "project");
        assert_eq!(cfg.project_id.as_deref(), Some("proj-1"));
    }

    #[test]
    fn should_discover_main_entries_via_registry() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        fs::write(
            dir.path().join("Cargo.toml"),
            "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();

        let tasks = discover_tasks(dir.path());
        assert!(
            tasks.iter().any(|t| t.id == "run:rust:main"),
            "expected rust main in {tasks:?}"
        );
        let t = tasks.iter().find(|t| t.id == "run:rust:main").unwrap();
        assert_eq!(t.command, "cargo run");
        assert_eq!(t.source, "main_entry");
    }
}
