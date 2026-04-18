use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use super::central_repo;
use super::content_hash;
use super::skill_metadata;

pub struct InstallResult {
    pub name: String,
    pub description: Option<String>,
    pub central_path: PathBuf,
    pub content_hash: String,
}

pub fn install_from_local(source: &Path, name: Option<&str>) -> Result<InstallResult> {
    let skill_dir = if source.is_dir() {
        source.to_path_buf()
    } else {
        extract_archive(source)?
    };

    let sanitized_name = match name {
        Some(n) if !n.is_empty() => {
            skill_metadata::sanitize_skill_name(n).ok_or_else(|| anyhow::anyhow!("Invalid skill name: '{}'", n))?
        }
        _ => skill_metadata::infer_skill_name(&skill_dir),
    };

    let source_meta_name = skill_metadata::parse_skill_md(&skill_dir)
        .name.unwrap_or_else(|| sanitized_name.clone());

    let skills_dir = central_repo::skills_dir();
    let dest = unique_skill_dest(&skills_dir, &sanitized_name, &source_meta_name);
    let final_name = dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| sanitized_name.clone());

    copy_skill_dir(&skill_dir, &dest)?;
    let hash = content_hash::hash_directory(&dest)?;

    Ok(InstallResult {
        name: final_name,
        description: skill_metadata::parse_skill_md(&dest).description,
        central_path: dest,
        content_hash: hash,
    })
}

fn extract_archive(source: &Path) -> Result<PathBuf> {
    let ext = source.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
    if ext != "zip" && ext != "skill" {
        anyhow::bail!("Unsupported archive format: {}", ext);
    }
    let temp_dir = tempfile::tempdir()?;
    let file = std::fs::File::open(source)?;
    let mut archive = zip::ZipArchive::new(file)?;
    safe_extract(&mut archive, temp_dir.path())?;
    // Leak temp dir so PathBuf remains valid (caller manages lifecycle)
    let path = temp_dir.path().to_path_buf();
    std::mem::forget(temp_dir);
    Ok(path)
}

fn safe_extract(archive: &mut zip::ZipArchive<std::fs::File>, dest: &Path) -> Result<()> {
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let entry_path = match entry.enclosed_name() {
            Some(name) => dest.join(name),
            None => continue,
        };
        if !entry_path.starts_with(dest) {
            continue;
        }
        if entry.is_dir() {
            std::fs::create_dir_all(&entry_path)?;
        } else {
            if let Some(parent) = entry_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut outfile = std::fs::File::create(&entry_path)?;
            std::io::copy(&mut entry, &mut outfile)?;
        }
    }
    Ok(())
}

fn unique_skill_dest(parent: &Path, sanitized_name: &str, source_meta_name: &str) -> PathBuf {
    for i in 1u32.. {
        let candidate = if i == 1 {
            parent.join(sanitized_name)
        } else {
            parent.join(format!("{}-{}", sanitized_name, i))
        };
        if !candidate.exists() {
            return candidate;
        }
        let existing_meta_name = skill_metadata::parse_skill_md(&candidate).name;
        if existing_meta_name.as_deref() == Some(source_meta_name) {
            return candidate;
        }
    }
    parent.join(sanitized_name)
}

fn copy_skill_dir(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == ".git" || name_str == ".DS_Store" { continue; }
        if ft.is_symlink() { continue; }
        let dest_path = dst.join(&name);
        if ft.is_dir() {
            copy_skill_dir(&entry.path(), &dest_path)?;
        } else {
            std::fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn unique_dest_returns_base_when_free() {
        let tmp = tempdir().unwrap();
        let dest = unique_skill_dest(tmp.path(), "my-skill", "my-skill");
        assert_eq!(dest, tmp.path().join("my-skill"));
    }

    #[test]
    fn unique_dest_uses_suffix_for_collision() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("my-skill");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), "---\nname: different\n---\n").unwrap();
        let dest = unique_skill_dest(tmp.path(), "my-skill", "my-skill");
        assert_eq!(dest, tmp.path().join("my-skill-2"));
    }

    #[test]
    fn copy_skill_dir_skips_git() {
        let tmp = tempdir().unwrap();
        let src = tmp.path().join("src");
        fs::create_dir_all(src.join(".git")).unwrap();
        fs::write(src.join(".git/config"), "git").unwrap();
        fs::write(src.join("SKILL.md"), "content").unwrap();
        let dst = tmp.path().join("dst");
        copy_skill_dir(&src, &dst).unwrap();
        assert!(dst.join("SKILL.md").exists());
        assert!(!dst.join(".git").exists());
    }
}
