//! Discover runnable / debuggable application entry points in a project.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// One discoverable entry (Go package main, Rust binary, …).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPoint {
    /// Stable id, e.g. `go:cmd/agent` or `rust:main`.
    pub id: String,
    /// UI label.
    pub name: String,
    /// `go` | `rust`.
    pub language: String,
    /// Absolute program path (Go package dir or Rust binary path hint).
    pub program: String,
    /// launch.json-friendly program template with `${workspaceFolder}`.
    pub program_template: String,
    /// Shell command for Run without debugger.
    pub run_command: String,
    /// Suggested launch config name.
    pub config_name: String,
    /// DAP adapter type: `go` | `lldb`.
    pub adapter_type: String,
    /// Go mode / unused for rust.
    pub mode: Option<String>,
    /// Optional preLaunchTask (e.g. cargo build for rust debug).
    pub pre_launch_task: Option<String>,
}

/// Scan project root for common Go / Rust entry layouts.
pub fn discover_entries(project_path: &Path) -> Vec<EntryPoint> {
    let mut out = Vec::new();
    if !project_path.is_dir() {
        return out;
    }
    discover_go(project_path, &mut out);
    discover_rust(project_path, &mut out);
    out
}

fn discover_go(root: &Path, out: &mut Vec<EntryPoint>) {
    if root.join("main.go").is_file() {
        out.push(EntryPoint {
            id: "go:main".into(),
            name: "main".into(),
            language: "go".into(),
            program: root.to_string_lossy().into_owned(),
            program_template: "${workspaceFolder}".into(),
            run_command: "go run .".into(),
            config_name: "Debug main".into(),
            adapter_type: "go".into(),
            mode: Some("debug".into()),
            pre_launch_task: None,
        });
    }

    let cmd_dir = root.join("cmd");
    if !cmd_dir.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(&cmd_dir) else {
        return;
    };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    for dir in dirs {
        if !dir.join("main.go").is_file() {
            continue;
        }
        let name = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("app")
            .to_string();
        let rel = format!("cmd/{name}");
        out.push(EntryPoint {
            id: format!("go:{rel}"),
            name: rel.clone(),
            language: "go".into(),
            program: dir.to_string_lossy().into_owned(),
            program_template: format!("${{workspaceFolder}}/{rel}"),
            run_command: format!("go run ./{rel}"),
            config_name: format!("Debug {rel}"),
            adapter_type: "go".into(),
            mode: Some("debug".into()),
            pre_launch_task: None,
        });
    }
}

fn discover_rust(root: &Path, out: &mut Vec<EntryPoint>) {
    let cargo = root.join("Cargo.toml");
    if !cargo.is_file() {
        return;
    }
    let pkg_name = parse_cargo_package_name(&cargo).unwrap_or_else(|| {
        root.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("app")
            .to_string()
    });

    if root.join("src/main.rs").is_file() {
        let bin_path = root.join("target/debug").join(&pkg_name);
        out.push(EntryPoint {
            id: "rust:main".into(),
            name: pkg_name.clone(),
            language: "rust".into(),
            program: bin_path.to_string_lossy().into_owned(),
            program_template: format!("${{workspaceFolder}}/target/debug/{pkg_name}"),
            run_command: "cargo run".into(),
            config_name: format!("Debug {pkg_name}"),
            adapter_type: "lldb".into(),
            mode: None,
            pre_launch_task: Some("cargo build".into()),
        });
    }

    let bin_dir = root.join("src/bin");
    if !bin_dir.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(&bin_dir) else {
        return;
    };
    let mut bins: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e == "rs")
        })
        .collect();
    bins.sort();
    for bin in bins {
        let name = bin
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("bin")
            .to_string();
        let bin_path = root.join("target/debug").join(&name);
        out.push(EntryPoint {
            id: format!("rust:bin:{name}"),
            name: name.clone(),
            language: "rust".into(),
            program: bin_path.to_string_lossy().into_owned(),
            program_template: format!("${{workspaceFolder}}/target/debug/{name}"),
            run_command: format!("cargo run --bin {name}"),
            config_name: format!("Debug {name}"),
            adapter_type: "lldb".into(),
            mode: None,
            pre_launch_task: Some(format!("cargo build --bin {name}")),
        });
    }
}

fn parse_cargo_package_name(cargo_toml: &Path) -> Option<String> {
    let text = fs::read_to_string(cargo_toml).ok()?;
    let mut in_package = false;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_package = t == "[package]";
            continue;
        }
        if in_package {
            if let Some(rest) = t.strip_prefix("name") {
                let rest = rest.trim().trim_start_matches('=').trim();
                let name = rest.trim_matches(|c| c == '"' || c == '\'');
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            }
        }
    }
    None
}

/// Build a launch config from a discovered entry.
pub fn entry_to_launch_config(entry: &EntryPoint) -> super::types::LaunchConfig {
    super::types::LaunchConfig {
        name: entry.config_name.clone(),
        type_: entry.adapter_type.clone(),
        request: "launch".into(),
        program: Some(entry.program_template.clone()),
        cwd: Some("${workspaceFolder}".into()),
        args: vec![],
        mode: entry.mode.clone(),
        pre_launch_task: entry.pre_launch_task.clone(),
        stop_on_entry: Some(true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn should_discover_go_cmd_main() {
        let dir = tempdir().unwrap();
        let cmd = dir.path().join("cmd/agent");
        fs::create_dir_all(&cmd).unwrap();
        fs::write(cmd.join("main.go"), "package main\nfunc main() {}\n").unwrap();
        let entries = discover_entries(dir.path());
        assert!(entries.iter().any(|e| e.id == "go:cmd/agent"));
        let e = entries.iter().find(|e| e.id == "go:cmd/agent").unwrap();
        assert_eq!(e.adapter_type, "go");
        assert!(e.program_template.contains("cmd/agent"));
    }

    #[test]
    fn should_discover_rust_main() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        let mut cargo = fs::File::create(dir.path().join("Cargo.toml")).unwrap();
        writeln!(cargo, "[package]\nname = \"demo\"\nversion = \"0.1.0\"").unwrap();
        let entries = discover_entries(dir.path());
        assert!(entries.iter().any(|e| e.id == "rust:main"));
        let e = entries.iter().find(|e| e.id == "rust:main").unwrap();
        assert!(e.program_template.contains("target/debug/demo"));
        assert_eq!(e.pre_launch_task.as_deref(), Some("cargo build"));
    }
}
