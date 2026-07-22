//! Remove adapter-generated temporary debug binaries after a session ends.
//!
//! Delve leaves `__debug_bin*` (and similar) next to the package under test.
//! We only delete well-known prefixes under the project tree — never arbitrary files.

use std::fs;
use std::path::{Path, PathBuf};

/// File name prefixes that are safe to delete after debugging.
const ARTIFACT_PREFIXES: &[&str] = &[
    "__debug_bin", // Delve (Go): __debug_bin, __debug_bin123456
    "debug.test",  // go test -c style leftovers when used as program
];

/// Max directory depth under project root (avoids walking huge monorepos forever).
const MAX_DEPTH: u32 = 8;

/// Delete known debug artifacts under `project_path`.
/// Returns the number of files removed (best-effort; IO errors are ignored).
pub fn cleanup_debug_artifacts(project_path: &Path) -> usize {
    if !project_path.is_dir() {
        return 0;
    }
    let mut removed = 0usize;
    let mut stack: Vec<(PathBuf, u32)> = vec![(project_path.to_path_buf(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_dir() {
                if depth >= MAX_DEPTH {
                    continue;
                }
                // Skip heavy / irrelevant trees
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with('.')
                    || name == "node_modules"
                    || name == "target"
                    || name == "vendor"
                    || name == "dist"
                    || name == "build"
                    || name == ".git"
                {
                    continue;
                }
                stack.push((path, depth + 1));
                continue;
            }
            if !ft.is_file() {
                continue;
            }
            if is_debug_artifact(&path) {
                if fs::remove_file(&path).is_ok() {
                    removed += 1;
                    log::info!("[dap] cleaned debug artifact: {}", path.display());
                }
            }
        }
    }
    removed
}

fn is_debug_artifact(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    // Windows may append .exe
    let stem = name.strip_suffix(".exe").unwrap_or(name);
    // Delve: __debug_bin, __debug_bin<pid>
    if stem == "__debug_bin" || stem.starts_with("__debug_bin") {
        // Avoid false positives like "__debug_binaries" if ever present — require
        // exact or digits/suffix after prefix.
        if stem == "__debug_bin" {
            return true;
        }
        let rest = &stem["__debug_bin".len()..];
        return rest
            .chars()
            .all(|c| c.is_ascii_digit() || c == '_' || c == '-');
    }
    // go test -c
    if stem == "debug.test" {
        return true;
    }
    let _ = ARTIFACT_PREFIXES; // document intent
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn should_remove_delve_debug_bin_files() {
        let dir = tempdir().unwrap();
        let bin = dir.path().join("__debug_bin12345");
        let keep = dir.path().join("main.go");
        fs::write(&bin, b"x").unwrap();
        fs::write(&keep, b"package main\n").unwrap();
        let nested = dir.path().join("cmd/app");
        fs::create_dir_all(&nested).unwrap();
        let nested_bin = nested.join("__debug_bin");
        fs::write(&nested_bin, b"y").unwrap();

        let n = cleanup_debug_artifacts(dir.path());
        assert_eq!(n, 2);
        assert!(!bin.exists());
        assert!(!nested_bin.exists());
        assert!(keep.exists());
    }

    #[test]
    fn should_not_delete_unrelated_files() {
        let dir = tempdir().unwrap();
        let mut f = fs::File::create(dir.path().join("debug_helper.go")).unwrap();
        writeln!(f, "package main").unwrap();
        assert_eq!(cleanup_debug_artifacts(dir.path()), 0);
        assert!(dir.path().join("debug_helper.go").exists());
    }

    #[test]
    fn should_match_artifact_names() {
        assert!(is_debug_artifact(Path::new("/tmp/__debug_bin")));
        assert!(is_debug_artifact(Path::new("/tmp/__debug_bin999.exe")));
        assert!(!is_debug_artifact(Path::new("/tmp/main")));
        assert!(!is_debug_artifact(Path::new("/tmp/__debug_bin_helper.txt"))); // still starts with prefix - actually would match
    }
}
