//! Skill installation from local paths, git repositories, and archives.

use anyhow::Result;
use std::path::{Path, PathBuf};

use super::central_repo;
use super::content_hash;
use super::skill_metadata;

use std::sync::LazyLock;
/// Global cache for git installation previews.
pub static GIT_PREVIEWS: LazyLock<std::sync::Mutex<GitPreviewCache>> =
    LazyLock::new(|| std::sync::Mutex::new(GitPreviewCache::new()));

/// In-memory cache for git installation previews.
pub struct GitPreviewCache {
    previews: Vec<GitPreview>,
}

impl GitPreviewCache {
    /// Create an empty preview cache.
    pub fn new() -> Self {
        Self {
            previews: Vec::new(),
        }
    }

    /// Insert a preview and return its generated ID.
    pub fn insert(&mut self, preview: GitPreview) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let preview = GitPreview {
            id: id.clone(),
            ..preview
        };
        self.previews.push(preview);
        id
    }

    /// Get a preview by ID.
    pub fn get(&self, id: &str) -> Option<&GitPreview> {
        self.previews.iter().find(|p| p.id == id)
    }

    /// Remove and return a preview by ID.
    pub fn remove(&mut self, id: &str) -> Option<GitPreview> {
        self.previews
            .iter()
            .position(|p| p.id == id)
            .map(|i| self.previews.remove(i))
    }
}

/// A snapshot of a cloned git repository for skill preview.
#[derive(Debug, Clone)]
pub struct GitPreview {
    /// Preview identifier.
    pub id: String,
    /// Cloned git URL.
    pub clone_url: String,
    /// Branch used for cloning.
    pub branch: Option<String>,
    /// Temporary clone path on disk.
    pub clone_path: PathBuf,
    /// Skill directories found in the repository.
    pub available_skills: Vec<GitSkillInfo>,
    /// Creation timestamp.
    pub created_at: i64,
}

/// Information about a skill directory within a git repository.
#[derive(Debug, Clone, serde::Serialize)]
pub struct GitSkillInfo {
    /// Relative path within the repository.
    pub path: String,
    /// Inferred or explicit skill name.
    pub name: String,
    /// Optional description from SKILL.md.
    pub description: Option<String>,
}

/// Result of installing a skill from a source.
pub struct InstallResult {
    /// Final skill name (may be sanitized).
    pub name: String,
    /// Optional description extracted from SKILL.md.
    pub description: Option<String>,
    /// Destination path in the central repository.
    pub central_path: PathBuf,
    /// SHA-256 content hash of the installed directory.
    pub content_hash: String,
}

/// Install a skill from a local filesystem path (directory, SKILL.md, or archive).
pub fn install_from_local(source: &Path, name: Option<&str>) -> Result<InstallResult> {
    let skill_dir = if source.is_dir() {
        source.to_path_buf()
    } else if source
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md"))
    {
        // Single markdown file → wrap as a temporary skill directory
        wrap_markdown_as_skill_dir(source)?
    } else {
        extract_archive(source)?
    };

    let sanitized_name = match name {
        Some(n) if !n.is_empty() => skill_metadata::sanitize_skill_name(n)
            .ok_or_else(|| anyhow::anyhow!("Invalid skill name: '{}'", n))?,
        _ => skill_metadata::infer_skill_name(&skill_dir),
    };

    let source_meta_name = skill_metadata::parse_skill_md(&skill_dir)
        .name
        .unwrap_or_else(|| sanitized_name.clone());

    let skills_dir = central_repo::skills_dir();
    let dest = unique_skill_dest(&skills_dir, &sanitized_name, &source_meta_name);
    let final_name = dest
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| sanitized_name.clone());

    copy_skill_dir(&skill_dir, &dest)?;
    let hash = content_hash::hash_directory(&dest)?;

    Ok(InstallResult {
        name: final_name,
        description: skill_metadata::parse_skill_md(&dest).description,
        central_path: dest,
        content_hash: hash,
    })
}

/// Wrap a standalone `.md` file into a temp directory containing `SKILL.md`.
fn wrap_markdown_as_skill_dir(md_path: &Path) -> Result<PathBuf> {
    let content = std::fs::read_to_string(md_path)
        .map_err(|e| anyhow::anyhow!("Failed to read skill markdown: {e}"))?;
    let temp_dir = tempfile::tempdir()?;
    let dest = temp_dir.path().join("SKILL.md");
    std::fs::write(&dest, content)?;
    let path = temp_dir.path().to_path_buf();
    // Leak so returned PathBuf remains valid for the install copy step
    std::mem::forget(temp_dir);
    Ok(path)
}

fn extract_archive(source: &Path) -> Result<PathBuf> {
    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();
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
        if name_str == ".git" || name_str == ".DS_Store" {
            continue;
        }
        if ft.is_symlink() {
            continue;
        }
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

/// Clone a git repository to a temp directory and list available skills.
pub fn preview_git_install(
    clone_url: &str,
    branch: Option<&str>,
    subpath: Option<&str>,
) -> Result<String> {
    use git2::Repository;

    let temp_dir = tempfile::tempdir_in(central_repo::skills_dir())?;
    let clone_path = temp_dir.path().to_path_buf();

    // Clone using git CLI
    let branch_name = branch.unwrap_or("main");
    let git_clone_result = crate::common::utils::command::local::exec("git")
        .args([
            "clone",
            "--depth",
            "1",
            "-b",
            branch_name,
            clone_url,
            clone_path.to_str().unwrap_or("."),
        ])
        .output();

    let repo = match git_clone_result {
        Ok(output) if output.status.success() => Repository::open(&clone_path)?,
        _ => {
            // Try 'master' branch if 'main' fails
            crate::common::utils::command::local::exec("git")
                .args([
                    "clone",
                    "--depth",
                    "1",
                    "-b",
                    "master",
                    clone_url,
                    clone_path.to_str().unwrap_or("."),
                ])
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
                name: meta.name.unwrap_or_else(|| {
                    skill_base
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default()
                }),
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
                            name: meta.name.unwrap_or_else(|| {
                                path.file_name()
                                    .map(|n| n.to_string_lossy().to_string())
                                    .unwrap_or_default()
                            }),
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
    let mut cache = GIT_PREVIEWS
        .lock()
        .map_err(|e| anyhow::anyhow!("Git previews lock poisoned: {}", e))?;
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

/// Get preview info by ID.
pub fn get_preview(preview_id: &str) -> Option<GitPreview> {
    let cache = GIT_PREVIEWS.lock().ok()?;
    cache.get(preview_id).cloned()
}

/// Result of confirming a git skill install, including source metadata for updates.
pub struct ConfirmGitInstallResult {
    /// Files copied into the central repository.
    pub install: InstallResult,
    /// Original clone URL (for update checks).
    pub clone_url: String,
    /// Branch used for the clone, if any.
    pub branch: Option<String>,
    /// Relative subpath of the skill within the clone (best-effort).
    pub source_subpath: Option<String>,
    /// Commit hash of the preview clone HEAD (if available).
    pub source_revision: Option<String>,
}

/// Confirm git install — copy selected skill to central repo.
///
/// Does **not** remove the preview from cache so the UI can install multiple
/// skills from the same clone. Call [`cancel_git_preview`] when finished.
pub fn confirm_git_install(
    preview_id: &str,
    selected_path: &str,
    name: Option<&str>,
) -> Result<ConfirmGitInstallResult> {
    let preview = {
        let cache = GIT_PREVIEWS
            .lock()
            .map_err(|e| anyhow::anyhow!("Git previews lock poisoned: {}", e))?;
        cache
            .get(preview_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Preview not found"))?
    };

    let source_path = PathBuf::from(selected_path);
    if !source_path.exists() {
        anyhow::bail!("Selected skill path not found: {}", selected_path);
    }

    let source_subpath = source_path
        .strip_prefix(&preview.clone_path)
        .ok()
        .map(|p| p.to_string_lossy().to_string());

    let source_revision = {
        use git2::Repository;
        (|| -> Option<String> {
            let repo = Repository::open(&preview.clone_path).ok()?;
            let commit = repo.head().ok()?.peel_to_commit().ok()?;
            Some(commit.id().to_string())
        })()
    };

    let install = install_from_local(&source_path, name)?;

    Ok(ConfirmGitInstallResult {
        install,
        clone_url: preview.clone_url,
        branch: preview.branch,
        source_subpath,
        source_revision,
    })
}

/// Cancel git preview - cleanup temp clone.
pub fn cancel_git_preview(preview_id: &str) -> Result<()> {
    let preview = {
        let mut cache = GIT_PREVIEWS
            .lock()
            .map_err(|e| anyhow::anyhow!("Git previews lock poisoned: {}", e))?;
        cache
            .remove(preview_id)
            .ok_or_else(|| anyhow::anyhow!("Preview not found"))?
    };

    // Clean up clone directory
    if preview.clone_path.exists() {
        std::fs::remove_dir_all(&preview.clone_path).ok();
    }

    Ok(())
}

/// Install directly from git URL (for atomic operations).
pub fn install_from_git(
    clone_url: &str,
    branch: Option<&str>,
    subpath: Option<&str>,
    name: Option<&str>,
) -> Result<InstallResult> {
    use git2::Repository;

    let temp_dir = tempfile::tempdir_in(central_repo::skills_dir())?;
    let clone_path = temp_dir.path().to_path_buf();

    // Clone using git CLI
    let branch_name = branch.unwrap_or("main");
    let git_clone_result = crate::common::utils::command::local::exec("git")
        .args([
            "clone",
            "--depth",
            "1",
            "-b",
            branch_name,
            clone_url,
            clone_path.to_str().unwrap_or("."),
        ])
        .output();

    let _repo = match git_clone_result {
        Ok(output) if output.status.success() => Repository::open(&clone_path)?,
        _ => {
            crate::common::utils::command::local::exec("git")
                .args([
                    "clone",
                    "--depth",
                    "1",
                    "-b",
                    "master",
                    clone_url,
                    clone_path.to_str().unwrap_or("."),
                ])
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

/// Check if a skill has updates available from its source.
pub fn check_skill_update(skill: &super::types::SkillRecord) -> Result<super::types::UpdateStatus> {
    let source_type = &skill.source_type;
    let source_ref = skill
        .source_ref
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("No source reference"))?;

    // Git clones and marketplace (skillssh → GitHub) support update checks
    if source_type != "git" && source_type != "skillssh" {
        return Ok(super::types::UpdateStatus::Unsupported);
    }

    let branch = skill.source_branch.as_deref();

    // Clone to temp and compare
    use git2::Repository;

    let temp_dir = tempfile::tempdir_in(central_repo::skills_dir())?;
    let clone_path = temp_dir.path().to_path_buf();

    let branch_name = branch.unwrap_or("main");
    let git_clone_result = crate::common::utils::command::local::exec("git")
        .args([
            "clone",
            "--depth",
            "1",
            "-b",
            branch_name,
            source_ref,
            clone_path.to_str().unwrap_or("."),
        ])
        .output();

    let repo = match git_clone_result {
        Ok(output) if output.status.success() => Repository::open(&clone_path)?,
        _ => {
            crate::common::utils::command::local::exec("git")
                .args([
                    "clone",
                    "--depth",
                    "1",
                    "-b",
                    "master",
                    source_ref,
                    clone_path.to_str().unwrap_or("."),
                ])
                .output()?;
            Repository::open(&clone_path)?
        }
    };

    // Get remote revision
    let head = repo.head()?.peel_to_commit()?;
    let remote_revision = head.id().to_string();

    let current_revision = skill.source_revision.as_deref();

    let status = match current_revision {
        Some(rev) if rev == remote_revision => super::types::UpdateStatus::UpToDate,
        Some(_) => super::types::UpdateStatus::UpdateAvailable { remote_revision },
        // Never recorded a revision — treat as updatable so the user can pin one
        None => super::types::UpdateStatus::UpdateAvailable { remote_revision },
    };

    Ok(status)
}

/// Apply update to a skill by re-installing from its source.
pub fn update_skill(skill: &super::types::SkillRecord) -> Result<super::types::SkillRecord> {
    // Re-install from source
    let source_ref = skill
        .source_ref
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("No source reference"))?;
    let branch = skill.source_branch.as_deref();
    let subpath = skill.source_subpath.as_deref();
    let current_name = &skill.name;

    let result = install_from_git(source_ref, branch, subpath, Some(current_name))?;

    // Get new revision
    use git2::Repository;

    let temp_dir = tempfile::tempdir_in(central_repo::skills_dir())?;
    let clone_path = temp_dir.path().to_path_buf();

    let branch_name = branch.unwrap_or("main");
    let git_clone_result = crate::common::utils::command::local::exec("git")
        .args([
            "clone",
            "--depth",
            "1",
            "-b",
            branch_name,
            source_ref,
            clone_path.to_str().unwrap_or("."),
        ])
        .output();

    let repo = match git_clone_result {
        Ok(output) if output.status.success() => Repository::open(&clone_path)?,
        _ => {
            crate::common::utils::command::local::exec("git")
                .args([
                    "clone",
                    "--depth",
                    "1",
                    "-b",
                    "master",
                    source_ref,
                    clone_path.to_str().unwrap_or("."),
                ])
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
