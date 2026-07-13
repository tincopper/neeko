# 实施计划：Git Provider 检测 & PR 后端接口化

## Phase 1: Git Provider 检测（已完成 ✅）

| 步骤 | 文件 | 状态 | 提交 |
|---|---|---|---|
| 1 | `src-tauri/src/common/types.rs` | ✅ `GitProvider` 枚举 + `GitInfo.git_provider` | `dc65746` |
| 2 | `src-tauri/src/project/model.rs` | ✅ 同步 `GitInfo.git_provider` | `dc65746` |
| 3 | `src-tauri/src/common/git/provider.rs` | ✅ 新建：检测逻辑 + 单元测试 | `dc65746` |
| 4 | `src-tauri/src/common/git/mod.rs` | ✅ 注册 `provider` 模块 | `dc65746` |
| 5 | `src-tauri/src/common/git/local.rs` | ✅ 在 `get_git_info` 中接入检测 | `dc65746` |
| 6 | `src-tauri/src/common/git/operations.rs` | ✅ 在 `get_git_info_shell` 中接入检测 | `dc65746` |
| 7 | `src-tauri/src/common/git/remote.rs` | ✅ 在 `get_remote_git_info` 中接入检测 | `dc65746` |
| 8 | `src/features/git/types.ts` | ✅ 添加 `git_provider` 到 `GitInfo` | `dc65746` |
| 9 | `src/features/git/components/BranchInfo.tsx` | ✅ 显示 provider 标签 | `dc65746` |

## Phase 2: PR 后端接口化

### 概览

| 步骤 | 文件 | 操作 | 验证方式 |
|---|---|---|---|
| 1 | `src-tauri/src/common/git/pr/` | 创建目录，`pr.rs` 拆分为 `mod.rs` + `github.rs` | `cargo check` |
| 2 | `src-tauri/src/common/git/pr/mod.rs` | 定义 `PrProvider` trait + ProviderStore + Factory | `cargo check` |
| 3 | `src-tauri/src/common/git/pr/github.rs` | 迁移现有 `gh` CLI 代码为 `GitHubPrProvider` | `cargo check` |
| 4 | `src-tauri/src/common/git/pr/mod.rs` | 实现 17 个 dispatch 函数 + `checkout_pr` 独立函数 | `cargo test` |
| 5 | `src-tauri/src/common/git/pr/gitlab.rs` | stub: 返回 "not yet supported" | `cargo check` |
| 6 | `src-tauri/src/common/git/pr/gitee.rs` | stub: 返回 "not yet supported" | `cargo check` |
| 7 | `src-tauri/src/common/git/local.rs` | `get_git_info` 中调用 `set_cached_provider` | `cargo test` |
| 8 | 回归验证 | `cargo test` + `pnpm type-check` + `pnpm tauri build` | 全部通过 |

### Step 1: 创建 `pr/` 目录 + 迁移代码

1. `rm src-tauri/src/common/git/pr.rs`
2. `mkdir src-tauri/src/common/git/pr/`
3. 创建 `pr/mod.rs` — 新文件（trait + dispatch + store）
4. 创建 `pr/github.rs` — 从原 `pr.rs` 提取 GitHub 实现

**注意**：`git/mod.rs` 第 8 行 `pub use crate::common::git::pr::*;` 和 `common/git/mod.rs` 第 7 行 `pub mod pr;` 第 20 行 `pub use pr::*;` 均正常工作，无需改动。

### Step 2: `pr/mod.rs` — Trait + ProviderStore + Factory

```rust
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

// ─── PrProvider Trait ───────────────────────────────────────
pub trait PrProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn is_installed(&self) -> bool;
    fn is_authenticated(&self) -> bool;
    fn list_prs(&self, repo_path: &Path, state: &str, limit: usize) -> Result<Vec<PRListItem>>;
    // ... 17 个方法 ...
}

// ─── ProviderStore ──────────────────────────────────────────
static PROVIDER_STORE: OnceLock<Mutex<HashMap<PathBuf, GitProvider>>> = OnceLock::new();

fn store() -> &'static Mutex<HashMap<PathBuf, GitProvider>> {
    PROVIDER_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 缓存优先，未命中时检测并缓存
pub fn resolve_provider(repo_path: &Path) -> GitProvider { ... }

/// 由 get_git_info 在刷新时注入
pub fn set_cached_provider(repo_path: &Path, provider: GitProvider) { ... }

/// 写操作后清除缓存
pub fn invalidate_provider_cache(repo_path: &Path) { ... }

// ─── Factory ────────────────────────────────────────────────
fn create_provider(provider: GitProvider) -> Result<Box<dyn PrProvider>> {
    match provider {
        GitProvider::GitHub => Ok(Box::new(github::GitHubPrProvider)),
        GitProvider::GitLab => Err(anyhow::anyhow!("GitLab PR 操作暂不支持")),
        GitProvider::Gitee => Err(anyhow::anyhow!("Gitee PR 操作暂不支持")),
        GitProvider::Unknown => Err(anyhow::anyhow!("未知 Git 提供商，PR 操作不可用")),
    }
}

// ─── Dispatch Functions ─────────────────────────────────────
// 17 个 pub fn + 1 个 checkout_pr

pub fn list_prs(repo_path: &Path, state: &str, limit: usize) -> Result<Vec<PRListItem>> {
    let provider = resolve_provider(repo_path);
    let client = create_provider(provider)?;
    cache::get_cached_pr_list(repo_path, state, limit, || {
        client.list_prs(repo_path, state, limit)
    })
}

// ... 其余 dispatch 函数类似 ...

/// checkout_pr 是 git 原生操作，不经过 Provider
pub fn checkout_pr(repo_path: &Path, pr_number: u64) -> Result<()> {
    let output = std::process::Command::new("git")
        .args(["fetch", "origin", &format!("pull/{}/head:pr-{}", pr_number, pr_number)])
        .current_dir(repo_path)
        .output()?;
    if !output.status.success() {
        anyhow::bail!("git fetch failed: {}", String::from_utf8_lossy(&output.stderr).trim());
    }
    let output = std::process::Command::new("git")
        .args(["checkout", &format!("pr-{}", pr_number)])
        .current_dir(repo_path)
        .output()?;
    if !output.status.success() {
        anyhow::bail!("git checkout failed: {}", String::from_utf8_lossy(&output.stderr).trim());
    }
    Ok(())
}
```

### Step 3: `pr/github.rs` — GitHub 实现

从原 `pr.rs` 迁移，去掉 cache 包裹和 invalidate 调用：

```rust
pub struct GitHubPrProvider;

impl PrProvider for GitHubPrProvider {
    fn name(&self) -> &'static str { "GitHub" }
    fn is_installed(&self) -> bool { ... }
    fn is_authenticated(&self) -> bool { ... }

    fn list_prs(&self, repo_path: &Path, state: &str, limit: usize) -> Result<Vec<PRListItem>> {
        // gh CLI 调用，无 cache 包裹
        let output = no_window_cmd("gh")
            .args(["pr", "list", "--json", "...", "--state", state, "--limit", &limit.to_string()])
            .current_dir(repo_path)
            .output()?;
        // ... 解析 JSON ...
    }

    // ... 其余方法同理 ...
}

// 内部 helper 函数/方法
fn no_window_cmd(program: &str) -> Command { ... }
fn get_gh_repo_owner_name(repo_path: &Path) -> Result<(String, String)> { ... }
// ...
```

### Step 4: Dispatch 函数 + checkout_pr

dispatch 函数模板：
```
resolve_provider(repo_path) → GitProvider
  match: create_provider(provider) → Box<dyn PrProvider>
    调用 provider.method(repo_path, args...)
    包裹 cache::get_cached_*(repo_path, ..., || provider.method(...))
```

写操作（`merge_pr`, `close_pr`, `checkout_pr`）额外调用 `invalidate_repo_caches(repo_path)` + `invalidate_provider_cache(repo_path)`。

### Step 5-6: GitLab / Gitee Stub

```rust
pub struct GitLabPrProvider;
impl PrProvider for GitLabPrProvider {
    fn name(&self) -> &'static str { "GitLab" }
    // 所有方法返回 Err("GitLab PR operations not yet supported")
}
```

### Step 7: `local.rs` 注入缓存

在 `get_git_info` 的 `Ok(GitInfo { ... git_provider, ... })` 之前添加：

```rust
crate::common::git::pr::set_cached_provider(repo_path, git_provider);
```

### Step 8: 回归验证

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm type-check
# 可选：手动启动 tauri dev 验证 PR 功能
pnpm tauri build --ci    # 只检查编译
```

## 需特别关注的细节

1. **`commands.rs` 中的 `list_pr_review_comments_command`** 是唯一 `async fn` 的 PR 命令，使用 `tokio::task::spawn_blocking` 调用 `crate::git::list_pr_review_comments`。dispatch 函数必须保持为 `fn`（非 async），否则会破坏这个模式。
2. **`no_window_cmd`** 当前是 `pr.rs` 中的私有函数。重构后需要在 `pr/mod.rs` 中暴露为 `pub(crate)` 函数供所有 provider 使用。
3. **`invalidate_repo_caches`** 当前在 `merge_pr` / `close_pr` / `checkout_pr` 中调用。dispatch 函数负责此调用，provider 实现不再关心缓存。
