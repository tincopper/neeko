use anyhow::Result;
use sha2::{Digest, Sha256};
use std::path::Path;
use walkdir::WalkDir;

const IGNORED: &[&str] = &[".git", ".DS_Store", "Thumbs.db", ".gitignore"];

pub fn hash_directory(dir: &Path) -> Result<String> {
    let mut hasher = Sha256::new();
    let mut entries: Vec<_> = WalkDir::new(dir)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !IGNORED.contains(&name.as_ref())
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .collect();

    entries.sort_by(|a, b| a.path().cmp(b.path()));

    for entry in entries {
        let rel = entry.path().strip_prefix(dir).unwrap_or(entry.path()).to_string_lossy();
        hasher.update(rel.as_bytes());
        if let Ok(content) = std::fs::read(entry.path()) {
            hasher.update(&content);
        }
    }

    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn hash_deterministic_same_content() {
        let tmp1 = tempdir().unwrap();
        fs::write(tmp1.path().join("a.txt"), "hello").unwrap();
        fs::write(tmp1.path().join("b.txt"), "world").unwrap();
        let tmp2 = tempdir().unwrap();
        fs::write(tmp2.path().join("a.txt"), "hello").unwrap();
        fs::write(tmp2.path().join("b.txt"), "world").unwrap();
        assert_eq!(hash_directory(tmp1.path()).unwrap(), hash_directory(tmp2.path()).unwrap());
    }

    #[test]
    fn hash_ignores_dot_git() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "content").unwrap();
        let h1 = hash_directory(tmp.path()).unwrap();
        fs::create_dir_all(tmp.path().join(".git")).unwrap();
        fs::write(tmp.path().join(".git/config"), "git stuff").unwrap();
        assert_eq!(h1, hash_directory(tmp.path()).unwrap());
    }

    #[test]
    fn hash_empty_directory() {
        let tmp = tempdir().unwrap();
        let h = hash_directory(tmp.path()).unwrap();
        assert_eq!(h, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }
}
