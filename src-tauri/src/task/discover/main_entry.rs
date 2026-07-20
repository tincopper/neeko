//! Discover common application main entry points as runnable tasks.
//!
//! - Go / Rust: reuses [`crate::dap::discover`] (single source of truth for layout).
//! - Java: [`super::java`] (Maven / Gradle / Spring Boot / main scan).
//! - Python / Node: lightweight local heuristics.
//!
//! This module only maps “how to run”; debug launch configs stay in the DAP layer.

use std::fs;
use std::path::Path;

use super::java::discover_java;
use super::{DiscoveredTask, TaskSource};

pub struct MainEntrySource;

impl TaskSource for MainEntrySource {
    fn id(&self) -> &'static str {
        "main_entry"
    }

    fn discover(&self, project_path: &Path) -> Vec<DiscoveredTask> {
        let mut out = Vec::new();
        map_dap_entries(project_path, &mut out);
        discover_java(project_path, &mut out);
        discover_python(project_path, &mut out);
        discover_node_entry(project_path, &mut out);
        out
    }
}

fn map_dap_entries(project_path: &Path, out: &mut Vec<DiscoveredTask>) {
    for entry in crate::dap::discover::discover_entries(project_path) {
        let lang = entry.language.to_lowercase();
        let group = match lang.as_str() {
            "go" => "Go entry points".to_string(),
            "rust" => "Rust entry points".to_string(),
            other => format!("{other} entry points"),
        };
        out.push(DiscoveredTask {
            // Prefix avoids clashing with future debug-only ids in UI state.
            id: format!("run:{}", entry.id),
            name: format!("Run {}", entry.name),
            command: entry.run_command.clone(),
            source: "main_entry".into(),
            group,
            description: Some(entry.program_template.clone()),
            priority: entry_priority(&lang, &entry.id),
        });
    }
}

fn entry_priority(lang: &str, id: &str) -> i32 {
    // Prefer root main over nested bins; still below package.json "dev" (100).
    let base = match lang {
        "go" | "rust" => 96,
        "java" => 95,
        "python" => 94,
        "node" | "javascript" | "typescript" => 93,
        _ => 90,
    };
    if id.ends_with(":main") || id == "go:main" || id == "rust:main" {
        base + 2
    } else {
        base
    }
}

fn discover_python(root: &Path, out: &mut Vec<DiscoveredTask>) {
    const CANDIDATES: &[&str] = &[
        "main.py",
        "app.py",
        "src/main.py",
        "src/app.py",
        "__main__.py",
    ];

    for rel in CANDIDATES {
        let path = root.join(rel);
        if !path.is_file() {
            continue;
        }
        // Prefer python3 when available at runtime is shell's job; use portable name.
        let command = if *rel == "__main__.py" {
            "python3 -m .".to_string()
        } else if rel.starts_with("src/") {
            format!("python3 {rel}")
        } else {
            format!("python3 {rel}")
        };
        out.push(DiscoveredTask {
            id: format!("run:python:{rel}"),
            name: format!("Run {rel}"),
            command,
            source: "main_entry".into(),
            group: "Python entry points".into(),
            description: Some(rel.to_string()),
            priority: if *rel == "main.py" { 96 } else { 94 },
        });
    }
}

/// Node entry file only when no package.json scripts would already cover run
/// (still useful when scripts are empty / missing start).
fn discover_node_entry(root: &Path, out: &mut Vec<DiscoveredTask>) {
    let pkg = root.join("package.json");
    if pkg.is_file() {
        if let Ok(text) = fs::read_to_string(&pkg) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                // If start/dev scripts exist, skip bare node entry to reduce noise.
                if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
                    if scripts.contains_key("start") || scripts.contains_key("dev") {
                        return;
                    }
                }
                if let Some(main) = json.get("main").and_then(|v| v.as_str()) {
                    if is_safe_rel_path(main) && root.join(main).is_file() {
                        out.push(DiscoveredTask {
                            id: format!("run:node:main:{main}"),
                            name: format!("Run {main}"),
                            command: format!("node {main}"),
                            source: "main_entry".into(),
                            group: "Node entry points".into(),
                            description: Some(main.to_string()),
                            priority: 93,
                        });
                        return;
                    }
                }
            }
        }
    }

    for rel in ["index.js", "index.mjs", "src/index.js", "src/main.js"] {
        if root.join(rel).is_file() {
            out.push(DiscoveredTask {
                id: format!("run:node:{rel}"),
                name: format!("Run {rel}"),
                command: format!("node {rel}"),
                source: "main_entry".into(),
                group: "Node entry points".into(),
                description: Some(rel.to_string()),
                priority: 92,
            });
            break;
        }
    }
}

fn is_safe_rel_path(p: &str) -> bool {
    if p.is_empty() || p.contains("..") || p.starts_with('/') || p.contains('\\') {
        return false;
    }
    p.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '/' | '-' | '_' | '@'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn should_map_go_and_rust_entries_from_dap() {
        let dir = tempdir().unwrap();
        let cmd = dir.path().join("cmd/agent");
        fs::create_dir_all(&cmd).unwrap();
        fs::write(cmd.join("main.go"), "package main\nfunc main() {}\n").unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        let mut cargo = fs::File::create(dir.path().join("Cargo.toml")).unwrap();
        writeln!(cargo, "[package]\nname = \"demo\"\nversion = \"0.1.0\"").unwrap();

        let tasks = MainEntrySource.discover(dir.path());
        assert!(tasks.iter().any(|t| t.id == "run:go:cmd/agent"));
        assert!(tasks.iter().any(|t| t.id == "run:rust:main"));
        let go = tasks.iter().find(|t| t.id == "run:go:cmd/agent").unwrap();
        assert!(go.command.contains("go run"));
        assert_eq!(go.group, "Go entry points");
    }

    #[test]
    fn should_discover_python_main() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("main.py"), "print('hi')\n").unwrap();
        let tasks = MainEntrySource.discover(dir.path());
        assert!(tasks.iter().any(|t| t.id == "run:python:main.py"));
        let t = tasks.iter().find(|t| t.id == "run:python:main.py").unwrap();
        assert_eq!(t.command, "python3 main.py");
    }

    #[test]
    fn should_skip_node_main_when_dev_script_exists() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{ "main": "index.js", "scripts": { "dev": "vite" } }"#,
        )
        .unwrap();
        fs::write(dir.path().join("index.js"), "console.log(1)\n").unwrap();
        let tasks = MainEntrySource.discover(dir.path());
        assert!(!tasks.iter().any(|t| t.id.contains("run:node")));
    }

    #[test]
    fn should_discover_node_main_without_scripts() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{ "main": "index.js" }"#,
        )
        .unwrap();
        fs::write(dir.path().join("index.js"), "console.log(1)\n").unwrap();
        let tasks = MainEntrySource.discover(dir.path());
        assert!(tasks.iter().any(|t| t.command == "node index.js"));
    }

    #[test]
    fn should_discover_java_maven_main_via_source() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("pom.xml"), "<project></project>\n").unwrap();
        let pkg = dir.path().join("src/main/java/com/demo");
        fs::create_dir_all(&pkg).unwrap();
        fs::write(
            pkg.join("Hello.java"),
            "package com.demo;\npublic class Hello {\n  public static void main(String[] args) {}\n}\n",
        )
        .unwrap();
        let tasks = MainEntrySource.discover(dir.path());
        assert!(
            tasks.iter().any(|t| t.id == "run:java:mvn:com.demo.Hello"),
            "{tasks:?}"
        );
        assert!(tasks.iter().any(|t| t.group == "Java entry points"));
    }
}
