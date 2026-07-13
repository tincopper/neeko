# 实施计划：Git Provider 检测

## 概览

| 步骤 | 文件 | 操作 | 验证方式 |
|---|---|---|---|
| 1 | `src-tauri/src/common/types.rs` | 添加 `GitProvider` 枚举 + `GitInfo.git_provider` | `cargo check` |
| 2 | `src-tauri/src/project/model.rs` | 同步 `GitInfo.git_provider` | `cargo check` |
| 3 | `src-tauri/src/common/git/provider.rs` | 新建：检测逻辑 | `cargo test` |
| 4 | `src-tauri/src/common/git/mod.rs` | 注册 `provider` 模块 | `cargo check` |
| 5 | `src-tauri/src/common/git/local.rs` | 在 `get_git_info` 中接入检测 | `cargo test` |
| 6 | `src-tauri/src/common/git/operations.rs` | 在 `get_git_info_shell` 中接入检测 | `cargo test` |
| 7 | `src-tauri/src/common/git/remote.rs` | 在 `get_remote_git_info` 中接入检测 | `cargo test` |
| 8 | `src/features/git/types.ts` | 添加 `gitProvider` 到 `GitInfo` | `pnpm type-check` |

## 详细步骤

### Step 1: `src-tauri/src/common/types.rs`

在 `Worktree` struct 之后、`GitInfo` struct 之前添加：

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum GitProvider {
    GitHub,
    Gitee,
    GitLab,
    Unknown,
}
```

修改 `GitInfo` struct，追加字段：

```rust
pub struct GitInfo {
    pub current_branch: String,
    pub branches: Vec<String>,
    pub worktrees: Vec<Worktree>,
    pub changed_files: Vec<FileChange>,
    pub is_clean: bool,
    pub git_provider: GitProvider,  // ← 新增
}
```

### Step 2: `src-tauri/src/project/model.rs`

两个 `GitInfo` 结构体内容相同。同步追加 `git_provider: GitProvider`。

### Step 3: `src-tauri/src/common/git/provider.rs`（新建）

```rust
use anyhow::Result;
use std::path::Path;

use crate::common::types::GitProvider;

/// 从 remote URL 检测 Git 提供商
pub fn detect_provider(remote_url: &str) -> GitProvider {
    let url = remote_url.trim().to_lowercase();
    if url.contains("github.com") {
        GitProvider::GitHub
    } else if url.contains("gitee.com") {
        GitProvider::Gitee
    } else if url.contains("gitlab.") {
        GitProvider::GitLab
    } else {
        GitProvider::Unknown
    }
}

/// 执行 git remote get-url origin（同步，local 使用）
pub fn get_git_provider(repo_path: &Path) -> Result<GitProvider> {
    let output = std::process::Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output()?;
    if output.status.success() {
        let url = String::from_utf8_lossy(&output.stdout);
        Ok(detect_provider(&url))
    } else {
        Ok(GitProvider::Unknown)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_github_ssh() {
        assert_eq!(
            detect_provider("git@github.com:user/repo.git"),
            GitProvider::GitHub
        );
    }

    #[test]
    fn test_detect_github_https() {
        assert_eq!(
            detect_provider("https://github.com/user/repo.git"),
            GitProvider::GitHub
        );
    }

    #[test]
    fn test_detect_gitee() {
        assert_eq!(
            detect_provider("git@gitee.com:user/repo.git"),
            GitProvider::Gitee
        );
    }

    #[test]
    fn test_detect_gitlab_com() {
        assert_eq!(
            detect_provider("git@gitlab.com:user/repo.git"),
            GitProvider::GitLab
        );
    }

    #[test]
    fn test_detect_gitlab_self_hosted() {
        assert_eq!(
            detect_provider("git@gitlab.example.com:user/repo.git"),
            GitProvider::GitLab
        );
    }

    #[test]
    fn test_detect_unknown() {
        assert_eq!(
            detect_provider("git@bitbucket.org:user/repo.git"),
            GitProvider::Unknown
        );
    }

    #[test]
    fn test_detect_empty() {
        assert_eq!(detect_provider(""), GitProvider::Unknown);
    }
}
```

### Step 4: `src-tauri/src/common/git/mod.rs`

追加两行：
```rust
pub mod provider;
// ...
pub use provider::*;
```

### Step 5: `src-tauri/src/common/git/local.rs`

在 `get_git_info` 函数中，`Repository` 已打开，直接复用：

```rust
pub fn get_git_info(repo_path: &Path) -> Result<GitInfo> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;
    let branch_info = get_git_branch_info_from_repo(&repo)?;
    let changed_files = get_changed_files_from_repo(&repo)?;
    let is_clean = changed_files.is_empty();

    // 检测 Git 提供商
    let git_provider = repo
        .find_remote("origin")
        .ok()
        .and_then(|r| r.url().map(|u| u.to_string()))
        .map(|u| crate::common::git::provider::detect_provider(&u))
        .unwrap_or(GitProvider::Unknown);

    Ok(GitInfo {
        current_branch: branch_info.current_branch,
        branches: branch_info.branches,
        worktrees: branch_info.worktrees,
        changed_files,
        is_clean,
        git_provider,  // ← 新增
    })
}
```

### Step 6: `src-tauri/src/common/git/operations.rs`

在 `get_git_info_shell` 函数末尾添加 provider 检测。注：已存在的 `get_remote_url` 是私有函数（第 1046 行），需要改为 `pub(crate)` 或直接内联。

```rust
pub async fn get_git_info_shell(transport: &GitTransport, work_dir: &str) -> Result<GitInfo> {
    // ... 现有逻辑 ...

    // 检测 Git 提供商
    let remote_url = transport
        .run_git(&["remote", "get-url", "origin"], work_dir)
        .await
        .unwrap_or_default();
    let git_provider = if remote_url.trim().is_empty() {
        GitProvider::Unknown
    } else {
        crate::common::git::provider::detect_provider(&remote_url)
    };

    Ok(GitInfo {
        current_branch: branch_info.current_branch,
        branches: branch_info.branches,
        worktrees: branch_info.worktrees,
        changed_files: files,
        is_clean,
        git_provider,
    })
}
```

### Step 7: `src-tauri/src/common/git/remote.rs`

在 `get_remote_git_info` 中添加独立的 SSH 调用来获取 remote URL：

```rust
pub async fn get_remote_git_info(
    host: &str, port: u16, username: &str, auth: &AuthMethod, project_path: &str,
) -> Result<GitInfo> {
    let sp = safe_path(project_path);
    // ... 现有组合命令 ...

    // 额外的 remote URL 检测（独立 SSH 调用）
    let remote_url_cmd = format!(
        "cd '{sp}' && git remote get-url origin 2>/dev/null || true"
    );
    let remote_url = exec_command(host, port, username, auth, &remote_url_cmd).await
        .unwrap_or_default();
    let git_provider = crate::common::git::provider::detect_provider(&remote_url);

    let mut info = parse_git_info_output(&output);
    info.git_provider = git_provider;
    Ok(info)
}
```

### Step 8: `src/features/git/types.ts`

```typescript
export interface GitInfo {
  current_branch: string;
  branches: string[];
  worktrees: Worktree[];
  changed_files: FileChange[];
  is_clean: boolean;
  gitProvider: 'github' | 'gitee' | 'gitlab' | 'unknown';  // ← 新增
}
```

## 验证清单

```bash
# 1. Rust 编译
cargo check --manifest-path src-tauri/Cargo.toml

# 2. Rust 测试（含新加的 detect_provider 单元测试）
cargo test --manifest-path src-tauri/Cargo.toml

# 3. 前端类型检查
pnpm type-check

# 4. Lint
pnpm lint
```
