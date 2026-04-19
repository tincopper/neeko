use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

use super::central_repo;
use super::content_hash;
use super::skill_metadata;

/// Preview cache for git installations
use std::sync::LazyLock;
pub static GIT_PREVIEWS: LazyLock<std::sync::Mutex<GitPreviewCache>> = LazyLock::new(|| std::sync::Mutex::new(GitPreviewCache::new()));

pub struct GitPreviewCache {
    previews: Vec<GitPreview>,
}

impl GitPreviewCache {
    pub fn new() -> Self {
        Self { previews: Vec::new() }
    }

    pub fn insert(&mut self, preview: GitPreview) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let preview = GitPreview { id: id.clone(), ..preview };
        self.previews.push(preview);
        id
    }

    pub fn get(&self, id: &str) -> Option<&GitPreview> {
        self.previews.iter().find(|p| p.id == id)
    }

    pub fn remove(&mut self, id: &str) -> Option<GitPreview> {
        self.previews.iter().position(|p| p.id == id).map(|i| self.previews.remove(i))
    }
}

#[derive(Debug, Clone)]
pub struct GitPreview {
    pub id: String,
    pub clone_url: String,
    pub branch: Option<String>,
    pub clone_path: PathBuf,
    pub available_skills: Vec<GitSkillInfo>,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitSkillInfo {
    pub path: String,
    pub name: String,
    pub description: Option<String>,
}

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

/// Clone a git repository to a temp directory and list available skills
pub fn preview_git_install(clone_url: &str, branch: Option<&str>, subpath: Option<&str>) -> Result<String> {
    use git2::Repository;
    use std::process::Command;

    let temp_dir = tempfile::tempdir_in(central_repo::skills_dir())?;
    let clone_path = temp_dir.path().to_path_buf();

    // Clone using git CLI
    let branch_name = branch.unwrap_or("main");
    let git_clone_result = Command::new("git")
        .args(["clone", "--depth", "1", "-b", branch_name, clone_url, clone_path.to_str().unwrap_or(".")])
        .output();

    let repo = match git_clone_result {
        Ok(output) if output.status.success() => Repository::open(&clone_path)?,
        _ => {
            // Try 'master' branch if 'main' fails
            Command::new("git")
                .args(["clone", "--depth", "1", "-b", "master", clone_url, clone_path.to_str().unwrap_or(".")])
                .output()?;
            Repository::open(&clone_path)?
        }
    };

    // Determine effective path
    let skill_base = if let Some(p) = subpath {
        clone_path.join(p)
    } else {
        clone_path.clone()
    };

    // Scan for skill directories
    let mut available_skills = Vec::new();
    if skill_base.is_dir() {
        if skill_metadata::is_valid_skill_dir(&skill_base) {
            let meta = skill_metadata::parse_skill_md(&skill_base);
            available_skills.push(GitSkillInfo {
                path: skill_base.to_string_lossy().to_string(),
                name: meta.name.unwrap_or_else(|| skill_base.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default()),
                description: meta.description,
            });
        } else {
            // Scan subdirectories
            if let Ok(entries) = std::fs::read_dir(&skill_base) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() && skill_metadata::is_valid_skill_dir(&path) {
                        let meta = skill_metadata::parse_skill_md(&path);
                        available_skills.push(GitSkillInfo {
                            path: path.to_string_lossy().to_string(),
                            name: meta.name.unwrap_or_else(|| path.file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default()),
                            description: meta.description,
                        });
                    }
                }
            }
        }
    }

    // Get the current commit hash
    let head = repo.head()?;
    let _commit = head.peel_to_commit()?;

    let now = chrono::Utc::now().timestamp_millis();
    let clone_path_for_preview = clone_path.clone();

    // Store in global cache
    let mut cache = GIT_PREVIEWS.lock().unwrap();
    let preview_id = cache.insert(GitPreview {
        id: String::new(),
        clone_url: clone_url.to_string(),
        branch: branch.map(String::from),
        clone_path: clone_path_for_preview,
        available_skills,
        created_at: now,
    });

    Ok(preview_id)
}

/// Get preview info by ID
pub fn get_preview(preview_id: &str) -> Option<GitPreview> {
    let cache = GIT_PREVIEWS.lock().unwrap();
    cache.get(preview_id).cloned()
}

/// Confirm git install - copy selected skill to central repo
pub fn confirm_git_install(preview_id: &str, selected_path: &str, name: Option<&str>) -> Result<InstallResult> {
    let _preview = {
        let mut cache = GIT_PREVIEWS.lock().unwrap();
        cache.remove(preview_id).ok_or_else(|| anyhow::anyhow!("Preview not found"))?
    };

    // Find selected skill path
    let source_path = PathBuf::from(selected_path);
    if !source_path.exists() {
        anyhow::bail!("Selected skill path not found: {}", selected_path);
    }

    // Install from the selected path
    let result = install_from_local(&source_path, name)?;

    Ok(result)
}

/// Cancel git preview - cleanup temp clone
pub fn cancel_git_preview(preview_id: &str) -> Result<()> {
    let preview = {
        let mut cache = GIT_PREVIEWS.lock().unwrap();
        cache.remove(preview_id).ok_or_else(|| anyhow::anyhow!("Preview not found"))?
    };

    // Clean up clone directory
    if preview.clone_path.exists() {
        std::fs::remove_dir_all(&preview.clone_path).ok();
    }

    Ok(())
}

/// Install directly from git URL (for atomic operations)
pub fn install_from_git(clone_url: &str, branch: Option<&str>, subpath: Option<&str>, name: Option<&str>) -> Result<InstallResult> {
    use git2::Repository;
    use std::process::Command;

    let temp_dir = tempfile::tempdir_in(central_repo::skills_dir())?;
    let clone_path = temp_dir.path().to_path_buf();

    // Clone using git CLI
    let branch_name = branch.unwrap_or("main");
    let git_clone_result = Command::new("git")
        .args(["clone", "--depth", "1", "-b", branch_name, clone_url, clone_path.to_str().unwrap_or(".")])
        .output();

    let repo = match git_clone_result {
        Ok(output) if output.status.success() => Repository::open(&clone_path)?,
        _ => {
            Command::new("git")
                .args(["clone", "--depth", "1", "-b", "master", clone_url, clone_path.to_str().unwrap_or(".")])
                .output()?;
            Repository::open(&clone_path)?
        }
    };

    // Determine effective path
    let skill_base = if let Some(p) = subpath {
        clone_path.join(p)
    } else {
        clone_path.clone()
    };

    // Install from the directory
    let result = install_from_local(&skill_base, name)?;

    // Cleanup temp directory
    std::fs::remove_dir_all(&clone_path).ok();

    Ok(result)
}

/// Check if a skill has updates available
pub fn check_skill_update(
    skill: &super::types::SkillRecord,
) -> Result<super::types::UpdateStatus> {
    let source_type = &skill.source_type;
    let source_ref = skill.source_ref.as_deref().ok_or_else(|| anyhow::anyhow!("No source reference"))?;

    // Only supports git source for now
    if source_type != "git" {
        return Ok(super::types::UpdateStatus::Unsupported);
    }

    let branch = skill.source_branch.as_deref();
    let subpath = skill.source_subpath.as_deref();

    // Clone to temp and compare
    use git2::Repository;
    use std::process::Command;

    let temp_dir = tempfile::tempdir_in(central_repo::skills_dir())?;
    let clone_path = temp_dir.path().to_path_buf();

    let branch_name = branch.unwrap_or("main");
    let git_clone_result = Command::new("git")
        .args(["clone", "--depth", "1", "-b", branch_name, source_ref, clone_path.to_str().unwrap_or(".")])
        .output();

    let repo = match git_clone_result {
        Ok(output) if output.status.success() => Repository::open(&clone_path)?,
        _ => {
            Command::new("git")
                .args(["clone", "--depth", "1", "-b", "master", source_ref, clone_path.to_str().unwrap_or(".")])
                .output()?;
            Repository::open(&clone_path)?
        }
    };

    // Get remote revision
    let head = repo.head()?.peel_to_commit()?;
    let remote_revision = head.id().to_string();

    let current_revision = skill.source_revision.as_deref();

    if current_revision.is_none() {
        // No previous revision, can't detect update
        return Ok(super::types::UpdateStatus::Unknown);
    }

    let status = if current_revision == Some(&remote_revision) {
        super::types::UpdateStatus::UpToDate
    } else {
        super::types::UpdateStatus::UpdateAvailable { remote_revision }
    };

    Ok(status)
}

/// Apply update to a skill
pub fn update_skill(
    skill: &super::types::SkillRecord,
) -> Result<super::types::SkillRecord> {
    // Re-install from source
    let source_ref = skill.source_ref.as_deref().ok_or_else(|| anyhow::anyhow!("No source reference"))?;
    let branch = skill.source_branch.as_deref();
    let subpath = skill.source_subpath.as_deref();
    let current_name = &skill.name;

    let result = install_from_git(source_ref, branch, subpath, Some(current_name))?;

    // Get new revision
    use git2::Repository;
    use std::process::Command;

    let temp_dir = tempfile::tempdir_in(central_repo::skills_dir())?;
    let clone_path = temp_dir.path().to_path_buf();

    let branch_name = branch.unwrap_or("main");
    let git_clone_result = Command::new("git")
        .args(["clone", "--depth", "1", "-b", branch_name, source_ref, clone_path.to_str().unwrap_or(".")])
        .output();

    let repo = match git_clone_result {
        Ok(output) if output.status.success() => Repository::open(&clone_path)?,
        _ => {
            Command::new("git")
                .args(["clone", "--depth", "1", "-b", "master", source_ref, clone_path.to_str().unwrap_or(".")])
                .output()?;
            Repository::open(&clone_path)?
        }
    };

    let head = repo.head()?.peel_to_commit()?;
    let new_revision = head.id().to_string();

    // Return updated record
    let now = chrono::Utc::now().timestamp_millis();
    Ok(super::types::SkillRecord {
        id: skill.id.clone(),
        name: result.name,
        description: result.description,
        source_type: skill.source_type.clone(),
        source_ref: skill.source_ref.clone(),
        source_ref_resolved: skill.source_ref_resolved.clone(),
        source_subpath: skill.source_subpath.clone(),
        source_branch: skill.source_branch.clone(),
        source_revision: Some(new_revision.clone()),
        remote_revision: Some(new_revision),
        central_path: result.central_path.to_string_lossy().to_string(),
        content_hash: Some(result.content_hash),
        enabled: skill.enabled,
        status: "ok".to_string(),
        update_status: "up_to_date".to_string(),
        last_checked_at: Some(now),
        last_check_error: None,
        created_at: skill.created_at,
        updated_at: now,
    })
}
