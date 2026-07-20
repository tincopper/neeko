//! Java main-entry discovery for Run tasks.
//!
//! Supports Maven / Gradle / Spring Boot and a shallow scan of
//! `src/main/java` for `public static void main`. Keeps classpath concerns
//! inside tool-native commands (`mvn exec:java`, `./gradlew bootRun`).

use std::fs;
use std::path::{Path, PathBuf};

use super::DiscoveredTask;

const GROUP: &str = "Java entry points";
const MAX_MAIN_CLASSES: usize = 16;
const MAX_JAVA_FILES_SCAN: usize = 200;

/// Append Java-related discovered tasks into `out`.
pub fn discover_java(root: &Path, out: &mut Vec<DiscoveredTask>) {
    let has_pom = root.join("pom.xml").is_file();
    let gradle_build = find_gradle_build(root);
    let has_gradle = gradle_build.is_some();
    if !has_pom && !has_gradle {
        // Plain single-file style project
        discover_plain_java(root, out);
        return;
    }

    let spring = is_spring_boot_project(root, has_pom, gradle_build.as_deref());
    let wrapper = gradle_wrapper_cmd(root);

    if spring {
        if has_pom {
            out.push(DiscoveredTask {
                id: "run:java:spring-boot:mvn".into(),
                name: "Spring Boot (Maven)".into(),
                command: "mvn -q spring-boot:run".into(),
                source: "main_entry".into(),
                group: GROUP.into(),
                description: Some("pom.xml · spring-boot".into()),
                priority: 98,
            });
        }
        if has_gradle {
            out.push(DiscoveredTask {
                id: "run:java:spring-boot:gradle".into(),
                name: "Spring Boot (Gradle)".into(),
                command: format!("{wrapper} bootRun"),
                source: "main_entry".into(),
                group: GROUP.into(),
                description: Some("build.gradle · spring-boot".into()),
                priority: 98,
            });
        }
    }

    // Explicit mainClass from build files
    if has_pom {
        if let Some(main) = parse_maven_main_class(&root.join("pom.xml")) {
            push_maven_main(out, &main, 97);
        }
    }
    if let Some(gb) = gradle_build.as_ref() {
        if let Some(main) = parse_gradle_main_class(gb) {
            push_gradle_main(out, &wrapper, &main, 97);
        }
    }

    // Scan source tree for main methods
    let java_src = root.join("src/main/java");
    let mains = if java_src.is_dir() {
        find_main_classes(&java_src)
    } else {
        Vec::new()
    };

    for fqcn in mains {
        if has_pom {
            push_maven_main(out, &fqcn, 95);
        }
        if has_gradle && !spring {
            // Spring already has bootRun; still offer class-specific via Gradle JavaExec-style
            // when not Spring, use `run` with -P or classes+java fallback.
            push_gradle_main(out, &wrapper, &fqcn, 95);
        } else if has_gradle && spring {
            // Optional: class-specific still useful for non-boot mains in multi-module-ish trees
            push_gradle_main(out, &wrapper, &fqcn, 90);
        }
    }

    // If Gradle application plugin style without discovered FQCN
    if has_gradle && !spring && out.iter().all(|t| !t.id.starts_with("run:java:gradle:")) {
        out.push(DiscoveredTask {
            id: "run:java:gradle:run".into(),
            name: "Gradle run".into(),
            command: format!("{wrapper} run"),
            source: "main_entry".into(),
            group: GROUP.into(),
            description: Some("application plugin".into()),
            priority: 92,
        });
    }
}

fn push_maven_main(out: &mut Vec<DiscoveredTask>, fqcn: &str, priority: i32) {
    let id = format!("run:java:mvn:{fqcn}");
    if out.iter().any(|t| t.id == id) {
        return;
    }
    out.push(DiscoveredTask {
        id,
        name: format!("Run {fqcn}"),
        command: format!("mvn -q -DskipTests compile exec:java -Dexec.mainClass={fqcn}"),
        source: "main_entry".into(),
        group: GROUP.into(),
        description: Some(fqcn.to_string()),
        priority,
    });
}

fn push_gradle_main(out: &mut Vec<DiscoveredTask>, wrapper: &str, fqcn: &str, priority: i32) {
    let id = format!("run:java:gradle:{fqcn}");
    if out.iter().any(|t| t.id == id) {
        return;
    }
    // Compile then run with main-class on the production classpath (no deps resolution).
    // Prefer tool-native run when single app; still give a concrete class command.
    out.push(DiscoveredTask {
        id,
        name: format!("Run {fqcn}"),
        command: format!(
            "{wrapper} -q classes && java -cp \"build/classes/java/main:build/resources/main\" {fqcn}"
        ),
        source: "main_entry".into(),
        group: GROUP.into(),
        description: Some(fqcn.to_string()),
        priority,
    });
}

fn discover_plain_java(root: &Path, out: &mut Vec<DiscoveredTask>) {
    for name in ["Main.java", "App.java", "Application.java"] {
        let path = root.join(name);
        if path.is_file() && file_has_main_method(&path) {
            let stem = name.trim_end_matches(".java");
            out.push(DiscoveredTask {
                id: format!("run:java:plain:{stem}"),
                name: format!("Run {stem}"),
                command: format!("javac {name} && java {stem}"),
                source: "main_entry".into(),
                group: GROUP.into(),
                description: Some(name.to_string()),
                priority: 94,
            });
        }
    }
}

fn find_gradle_build(root: &Path) -> Option<PathBuf> {
    for name in ["build.gradle.kts", "build.gradle"] {
        let p = root.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn gradle_wrapper_cmd(root: &Path) -> String {
    if root.join("gradlew").is_file() || root.join("gradlew.bat").is_file() {
        // Portable: shell on Unix; users on Windows often have git-bash or use gradlew.bat via shell.
        if cfg!(windows) && root.join("gradlew.bat").is_file() {
            ".\\gradlew.bat".into()
        } else {
            "./gradlew".into()
        }
    } else {
        "gradle".into()
    }
}

fn is_spring_boot_project(root: &Path, has_pom: bool, gradle_build: Option<&Path>) -> bool {
    if has_pom {
        if let Ok(text) = fs::read_to_string(root.join("pom.xml")) {
            if text.contains("spring-boot") {
                return true;
            }
        }
    }
    if let Some(gb) = gradle_build {
        if let Ok(text) = fs::read_to_string(gb) {
            if text.contains("org.springframework.boot") || text.contains("spring-boot") {
                return true;
            }
        }
    }
    false
}

/// Extract mainClass from common Maven locations (properties / plugin config).
fn parse_maven_main_class(pom: &Path) -> Option<String> {
    let text = fs::read_to_string(pom).ok()?;
    // <start-class>…</start-class> or <mainClass>…</mainClass>
    for tag in ["start-class", "mainClass"] {
        if let Some(v) = extract_xml_tag(&text, tag) {
            if is_valid_fqcn(&v) {
                return Some(v);
            }
        }
    }
    None
}

fn extract_xml_tag(text: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&close)? + start;
    let val = text[start..end].trim().to_string();
    if val.is_empty() {
        None
    } else {
        Some(val)
    }
}

fn parse_gradle_main_class(build_file: &Path) -> Option<String> {
    let text = fs::read_to_string(build_file).ok()?;
    // Groovy: mainClassName = 'com.foo.App'  or mainClass = '…'
    // Kotlin DSL: mainClass.set("com.foo.App") or mainClass = "…"
    for line in text.lines() {
        let t = line.trim();
        if let Some(v) = parse_gradle_assignment(t, "mainClassName") {
            if is_valid_fqcn(&v) {
                return Some(v);
            }
        }
        if let Some(v) = parse_gradle_assignment(t, "mainClass") {
            if is_valid_fqcn(&v) {
                return Some(v);
            }
        }
        // mainClass.set("com.foo.App")
        if let Some(rest) = t.strip_prefix("mainClass.set(") {
            let v = rest
                .trim_end_matches(')')
                .trim()
                .trim_matches(|c| c == '"' || c == '\'')
                .to_string();
            if is_valid_fqcn(&v) {
                return Some(v);
            }
        }
    }
    None
}

fn parse_gradle_assignment(line: &str, key: &str) -> Option<String> {
    let line = line.trim();
    let prefixes = [format!("{key} ="), format!("{key}="), format!("{key}.set(")];
    for p in &prefixes {
        if let Some(rest) = line.strip_prefix(p.as_str()) {
            let v = rest
                .trim()
                .trim_end_matches(')')
                .trim()
                .trim_matches(|c| c == '"' || c == '\'')
                .to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

fn is_valid_fqcn(s: &str) -> bool {
    if s.is_empty() || s.len() > 256 {
        return false;
    }
    let ok_chars = s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '$');
    if !ok_chars {
        return false;
    }
    // No empty package segments (e.g. "com..App")
    !s.split('.').any(|p| p.is_empty())
}

/// Walk `src/main/java` and return FQCNs that look like they declare main.
fn find_main_classes(java_root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    collect_java_files(java_root, &mut files, 0);
    files.sort();
    let mut out = Vec::new();
    for file in files.into_iter().take(MAX_JAVA_FILES_SCAN) {
        if !file_has_main_method(&file) {
            continue;
        }
        if let Some(fqcn) = path_to_fqcn(java_root, &file) {
            if !out.contains(&fqcn) {
                out.push(fqcn);
            }
        }
        if out.len() >= MAX_MAIN_CLASSES {
            break;
        }
    }
    out
}

fn collect_java_files(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 12 || out.len() >= MAX_JAVA_FILES_SCAN {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut paths: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
    paths.sort();
    for path in paths {
        if path.is_dir() {
            // Skip build / hidden
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with('.') || name == "target" || name == "build" {
                continue;
            }
            collect_java_files(&path, out, depth + 1);
        } else if path.extension().and_then(|e| e.to_str()) == Some("java") {
            out.push(path);
            if out.len() >= MAX_JAVA_FILES_SCAN {
                return;
            }
        }
    }
}

fn file_has_main_method(path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(path) else {
        return false;
    };
    // Loose match: public static void main( / static void main(
    text.contains("void main(")
        && (text.contains("static void main") || text.contains("static\n    void main"))
}

fn path_to_fqcn(java_root: &Path, file: &Path) -> Option<String> {
    let rel = file.strip_prefix(java_root).ok()?;
    let mut parts: Vec<String> = rel
        .components()
        .filter_map(|c| c.as_os_str().to_str().map(|s| s.to_string()))
        .collect();
    if parts.is_empty() {
        return None;
    }
    let last = parts.pop()?;
    let class = last.strip_suffix(".java")?;
    parts.push(class.to_string());
    let fqcn = parts.join(".");
    if is_valid_fqcn(&fqcn) {
        Some(fqcn)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn should_discover_maven_main_from_scan() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("pom.xml"), "<project></project>\n").unwrap();
        let pkg = dir.path().join("src/main/java/com/example");
        fs::create_dir_all(&pkg).unwrap();
        fs::write(
            pkg.join("App.java"),
            "package com.example;\npublic class App {\n  public static void main(String[] args) {}\n}\n",
        )
        .unwrap();

        let mut out = Vec::new();
        discover_java(dir.path(), &mut out);
        assert!(
            out.iter().any(|t| t.id == "run:java:mvn:com.example.App"),
            "{out:?}"
        );
        let t = out
            .iter()
            .find(|t| t.id == "run:java:mvn:com.example.App")
            .unwrap();
        assert!(t.command.contains("exec.mainClass=com.example.App"));
        assert!(t.command.starts_with("mvn"));
    }

    #[test]
    fn should_discover_spring_boot_maven() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("pom.xml"),
            r#"<project><dependency>spring-boot-starter</dependency></project>"#,
        )
        .unwrap();
        let mut out = Vec::new();
        discover_java(dir.path(), &mut out);
        assert!(out.iter().any(|t| t.command.contains("spring-boot:run")));
    }

    #[test]
    fn should_parse_gradle_main_class() {
        let dir = tempdir().unwrap();
        let mut f = fs::File::create(dir.path().join("build.gradle")).unwrap();
        writeln!(f, "application {{").unwrap();
        writeln!(f, "  mainClass = 'com.demo.Main'").unwrap();
        writeln!(f, "}}").unwrap();
        fs::write(dir.path().join("gradlew"), "#!/bin/sh\n").unwrap();

        let mut out = Vec::new();
        discover_java(dir.path(), &mut out);
        assert!(
            out.iter().any(|t| t.description.as_deref() == Some("com.demo.Main")),
            "{out:?}"
        );
    }

    #[test]
    fn should_discover_plain_main_java() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("Main.java"),
            "public class Main { public static void main(String[] a) {} }\n",
        )
        .unwrap();
        let mut out = Vec::new();
        discover_java(dir.path(), &mut out);
        assert!(out.iter().any(|t| t.command.contains("javac Main.java")));
    }

    #[test]
    fn should_validate_fqcn() {
        assert!(is_valid_fqcn("com.example.App"));
        assert!(is_valid_fqcn("Main"));
        assert!(!is_valid_fqcn("com.example; rm -rf"));
        assert!(!is_valid_fqcn(""));
    }
}
