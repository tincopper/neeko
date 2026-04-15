use anyhow::Result;
use std::path::PathBuf;

/// Base directory for the skill management system: ~/.neeko/
pub fn base_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Cannot determine home directory")
        .join(".neeko")
}

/// Skills central repository: ~/.neeko/skills/
pub fn skills_dir() -> PathBuf {
    base_dir().join("skills")
}

/// Database path: ~/.neeko/skills.db
pub fn db_path() -> PathBuf {
    base_dir().join("skills.db")
}

/// Ensure all required directories exist.
pub fn ensure_central_repo() -> Result<()> {
    std::fs::create_dir_all(skills_dir())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_under_neeko_dir() {
        let base = base_dir();
        assert!(base.ends_with(".neeko"));
        assert!(skills_dir().ends_with(".neeko/skills"));
        assert!(db_path().ends_with(".neeko/skills.db"));
    }

    #[test]
    fn ensure_central_repo_creates_skills_dir() {
        let dir = skills_dir();
        // Clean up before testing
        if dir.exists() {
            // Only remove if empty or we don't care (it's under home dir)
            // Just test that the function doesn't error
        }
        ensure_central_repo().expect("should create directories");
        assert!(dir.exists(), "skills dir should exist after ensure");
    }
}