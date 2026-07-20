//! Discover npm/pnpm/yarn/bun scripts from package.json.
//!
//! Isolation: only this module knows about package.json shape and lockfiles.
//! Other sources must not import package-manager helpers from here.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde_json::Value;

use super::{DiscoveredTask, TaskSource};

/// Discoverer for npm/pnpm/yarn/bun scripts from package.json.
pub struct PackageJsonSource;

impl TaskSource for PackageJsonSource {
    fn id(&self) -> &'static str {
        "package_json"
    }

    fn discover(&self, project_path: &Path) -> Vec<DiscoveredTask> {
        discover_package_json_tasks(project_path)
    }
}

/// Lifecycle / publish hooks that are rarely useful as one-click Run tasks.
const SKIP_SCRIPTS: &[&str] = &[
    "preinstall",
    "install",
    "postinstall",
    "prepublish",
    "prepublishOnly",
    "publish",
    "postpublish",
    "prepack",
    "postpack",
    "prepare",
    "preprepare",
    "postprepare",
    "dependencies",
    "predependencies",
    "postdependencies",
];

fn discover_package_json_tasks(project_path: &Path) -> Vec<DiscoveredTask> {
    let pkg_path = project_path.join("package.json");
    if !pkg_path.is_file() {
        return Vec::new();
    }
    let Ok(text) = fs::read_to_string(&pkg_path) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<Value>(&text) else {
        return Vec::new();
    };
    let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) else {
        return Vec::new();
    };

    let pm = detect_package_manager(project_path, &json);
    let group = format!("npm scripts ({pm})");

    let mut out = Vec::new();
    // BTreeMap for stable iteration in tests when priorities tie.
    let mut ordered: BTreeMap<String, String> = BTreeMap::new();
    for (name, body) in scripts {
        if !is_valid_script_name(name) || should_skip_script(name) {
            continue;
        }
        let body_str = body.as_str().unwrap_or("").to_string();
        ordered.insert(name.clone(), body_str);
    }

    for (name, body) in ordered {
        let command = format!("{pm} run {name}");
        out.push(DiscoveredTask {
            id: format!("pkg:{name}"),
            name: name.clone(),
            command,
            source: "package_json".into(),
            group: group.clone(),
            description: if body.is_empty() { None } else { Some(body) },
            priority: script_priority(&name),
        });
    }
    out
}

fn should_skip_script(name: &str) -> bool {
    SKIP_SCRIPTS.iter().any(|s| *s == name)
}

/// Allow common npm script characters; reject shell-metacharacter names.
fn is_valid_script_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 128 {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.' | '/' | '@'))
}

fn script_priority(name: &str) -> i32 {
    match name {
        "dev" | "start" | "serve" => 100,
        "test" | "test:unit" | "test:run" => 90,
        "build" | "build:prod" => 80,
        "lint" | "lint:fix" | "typecheck" | "type-check" | "check" => 70,
        "format" | "fmt" => 60,
        n if n.starts_with("pre") || n.starts_with("post") => 20,
        _ => 50,
    }
}

/// Prefer explicit packageManager field, then lockfiles, then npm.
fn detect_package_manager(project_path: &Path, package_json: &Value) -> &'static str {
    if let Some(pm_field) = package_json.get("packageManager").and_then(|v| v.as_str()) {
        let tool = pm_field.split('@').next().unwrap_or(pm_field).trim();
        match tool {
            "pnpm" => return "pnpm",
            "yarn" => return "yarn",
            "bun" => return "bun",
            "npm" => return "npm",
            _ => {}
        }
    }

    if project_path.join("pnpm-lock.yaml").is_file() {
        return "pnpm";
    }
    if project_path.join("yarn.lock").is_file() {
        return "yarn";
    }
    if project_path.join("bun.lockb").is_file() || project_path.join("bun.lock").is_file() {
        return "bun";
    }
    if project_path.join("package-lock.json").is_file() {
        return "npm";
    }
    "npm"
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn should_skip_lifecycle_scripts() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{
              "scripts": {
                "dev": "vite",
                "postinstall": "husky",
                "prepare": "husky"
              }
            }"#,
        )
        .unwrap();
        let tasks = discover_package_json_tasks(dir.path());
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "pkg:dev");
    }

    #[test]
    fn should_prefer_yarn_lock() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{ "scripts": { "build": "tsc" } }"#,
        )
        .unwrap();
        fs::write(dir.path().join("yarn.lock"), "# yarn\n").unwrap();
        let tasks = discover_package_json_tasks(dir.path());
        assert_eq!(tasks[0].command, "yarn run build");
        assert!(tasks[0].group.contains("yarn"));
    }

    #[test]
    fn should_honor_package_manager_field() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{ "packageManager": "pnpm@9.12.2", "scripts": { "lint": "eslint ." } }"#,
        )
        .unwrap();
        // Conflicting lock should still lose to packageManager field
        fs::write(dir.path().join("package-lock.json"), "{}\n").unwrap();
        let tasks = discover_package_json_tasks(dir.path());
        assert_eq!(tasks[0].command, "pnpm run lint");
    }

    #[test]
    fn should_reject_invalid_script_names() {
        assert!(!is_valid_script_name("foo;rm -rf /"));
        assert!(!is_valid_script_name(""));
        assert!(is_valid_script_name("test:unit"));
        assert!(is_valid_script_name("@scope/cmd"));
    }
}
