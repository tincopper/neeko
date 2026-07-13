# 技术设计：Git Provider 检测 & PR 后端接口化

> 本设计涵盖两个阶段：
> - **Phase 1**（已完成）— Git 提供商检测
> - **Phase 2**（本设计重点）— PR 后端接口化，支持多提供者

---

## Phase 1: Git Provider 检测（已实现）

### 数据流

```
git remote get-url origin
  → provider::detect_provider(url) → GitProvider
    → GitInfo { ..., git_provider }
      → serde serialize
        → 前端 GitInfo { ..., gitProvider }
```

### 模块结构

#### 新增：`src-tauri/src/common/git/provider.rs`

```rust
pub enum GitProvider { GitHub, Gitee, GitLab, Unknown }

// URL 解析（纯函数，无 I/O）
pub fn detect_provider(remote_url: &str) -> GitProvider;

// 执行 git remote get-url origin（同步，用于 local 路径）
pub fn get_git_provider(repo_path: &Path) -> Result<GitProvider>;
```

#### 注册

`src-tauri/src/common/git/mod.rs` 添加 `pub mod provider;` + `pub use provider::*;`

### 检测规则（URL 解析）

```rust
pub fn detect_provider(remote_url: &str) -> GitProvider {
    let url = remote_url.trim().to_lowercase();
    if url.contains("github.com")     { GitProvider::GitHub }
    else if url.contains("gitee.com") { GitProvider::Gitee }
    else if url.contains("gitlab.")   { GitProvider::GitLab }
    else                               { GitProvider::Unknown }
}
```

支持以下 URL 格式（均为 `git remote get-url origin` 的可能输出）：

| 格式 | 示例 |
|---|---|
| SSH | `git@github.com:user/repo.git` |
| HTTPS | `https://github.com/user/repo.git` |
| HTTPS + 认证 | `https://token@github.com/user/repo.git` |
| GitLab 自托管 | `git@gitlab.example.com:user/repo.git` |
| Gitee | `git@gitee.com:user/repo.git` |

`to_lowercase()` 保证不区分大小写。`contains("gitlab.")` 同时匹配 `gitlab.com` 和 `gitlab.example.com`。

### 三个集成点

#### 1. Local（`local.rs`）

`get_git_info(repo_path)` 中 `git2::Repository` 已打开，直接复用：

```
repo.find_remote("origin")
  → remote.url() → &str
  → detect_provider(url)
  → GitProvider
```

Zero 额外进程开销。

#### 2. WSL（`operations.rs`）

`get_git_info_shell(transport, work_dir)` 中：

```
transport.run_git(["remote", "get-url", "origin"], work_dir).await
  → detect_provider(url)
```

#### 3. SSH Remote（`remote.rs`）

`get_remote_git_info` 在组合命令尾部追加 `git remote get-url origin`，一行 SSH 连接完成所有工作。

### 错误处理策略

| 场景 | 行为 |
|---|---|
| 非 git 目录 | `get_git_provider` 返回 `Unknown` |
| 无 remote origin | `git2::Repository::find_remote` 失败 → 返回 `Unknown` |
| `git remote get-url` 命令失败 | 返回 `Unknown` |
| URL 不符合任何已知模式 | 返回 `Unknown` |

所有代码路径不抛出错误 — `Unknown` 作为兜底值。

### 序列化

Rust → JSON 序列化使用 serde `#[derive(Serialize, Deserialize)]`，枚举序列化为驼峰字符串：

```json
{ "git_provider": "GitHub" }
```

---

## Phase 2: PR 后端接口化

### 动机

当前 `pr.rs`（1198 行）全部函数硬编码调用 `gh` CLI，无法支持 GitLab / Gitee 等提供者。重构后通过 `PrProvider` trait 抽象，各提供者独立实现，`pr.rs` 作为薄调度层。

### 模块结构

```
src-tauri/src/common/git/pr/
├── mod.rs              ← PrProvider trait + ProviderStore + 调度函数 + 兼容 re-export
├── github.rs           ← GitHubPrProvider（迁移现有 gh CLI 代码）
├── gitlab.rs           ← 未来: GitLabPrProvider (stub)
└── gitee.rs            ← 未来: GiteePrProvider (stub)
```

**目录化迁移**：`pr.rs` → `pr/mod.rs` + `pr/github.rs`。`mod pr; pub use pr::*;` 仍然兼容，外部调用方零改动。

### PrProvider Trait

```rust
pub trait PrProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn is_installed(&self) -> bool;
    fn is_authenticated(&self) -> bool;
    fn list_prs(&self, repo_path: &Path, state: &str, limit: usize) -> Result<Vec<PRListItem>>;
    fn list_repo_labels(&self, repo_path: &Path) -> Result<Vec<PrLabel>>;
    fn list_repo_authors(&self, repo_path: &Path) -> Result<Vec<String>>;
    fn view_pr(&self, repo_path: &Path, pr_number: u64) -> Result<PRInfo>;
    fn create_pr(&self, repo_path: &Path, title: &str, body: &str, base: Option<&str>, draft: bool) -> Result<u64>;
    fn merge_pr(&self, repo_path: &Path, pr_number: u64, method: &str) -> Result<PRMergeResult>;
    fn close_pr(&self, repo_path: &Path, pr_number: u64) -> Result<()>;
    fn list_pr_files(&self, repo_path: &Path, pr_number: u64) -> Result<Vec<PRFileChange>>;
    fn list_pr_commits(&self, repo_path: &Path, pr_number: u64) -> Result<Vec<PRCommit>>;
    fn list_pr_comments(&self, repo_path: &Path, pr_number: u64) -> Result<Vec<PRComment>>;
    fn add_pr_comment(&self, repo_path: &Path, pr_number: u64, body: &str) -> Result<PRComment>;
    fn edit_pr_comment(&self, repo_path: &Path, pr_number: u64, comment_id: &str, body: &str) -> Result<PRComment>;
    fn delete_pr_comment(&self, repo_path: &Path, pr_number: u64, comment_id: &str) -> Result<()>;
    fn add_comment_reaction(&self, repo_path: &Path, pr_number: u64, comment_id: &str, emoji: &str) -> Result<()>;
    fn add_pr_review_comment(&self, repo_path: &Path, pr_number: u64, body: &str, path: &str, line: u64, side: &str) -> Result<PRReviewComment>;
    fn list_pr_review_comments(&self, repo_path: &Path, pr_number: u64) -> Result<Vec<PRReviewComment>>;
}
```

**方法设计原则**：
- 所有方法接收 `repo_path` — 因为 provider 实现可能需要读 git config、切换工作目录等
- 使用 `Send + Sync` 以支持 `Box<dyn PrProvider>` 在 `OnceLock` 中共享

**不属于 Trait 的方法**（git 原生操作，与提供者无关）：
- `checkout_pr` — 直接使用 `git fetch origin pull/N/head + git checkout`

### ProviderStore

在 `pr/mod.rs` 中新增 ProviderStore，缓存 repo → GitProvider 映射，避免每次 PR 操作都执行 remote URL 检测。

```rust
// pr/provider_store.rs — 或内联在 pr/mod.rs
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static PROVIDER_STORE: OnceLock<Mutex<HashMap<PathBuf, GitProvider>>> = OnceLock::new();

fn store() -> &'static Mutex<HashMap<PathBuf, GitProvider>> {
    PROVIDER_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 从缓存获取，未命中时通过 `get_git_provider` 检测
pub fn resolve_provider(repo_path: &Path) -> GitProvider {
    if let Some(p) = store().lock().ok().and_then(|m| m.get(repo_path).copied()) {
        return p;
    }
    let p = get_git_provider(repo_path).unwrap_or(GitProvider::Unknown);
    if let Ok(mut guard) = store().lock() {
        guard.insert(repo_path.to_path_buf(), p);
    }
    p
}

/// 由 get_git_info 在刷新 git 信息时注入已解析的 provider
pub fn set_cached_provider(repo_path: &Path, provider: GitProvider) {
    if let Ok(mut guard) = store().lock() {
        guard.insert(repo_path.to_path_buf(), provider);
    }
}

/// 缓存失效（当 git remote 变更时）
pub fn invalidate_provider_cache(repo_path: &Path) {
    if let Ok(mut guard) = store().lock() {
        guard.remove(repo_path);
    }
}
```

**数据流**：

```
Project Open / Refresh
  → get_git_info (返回 git_provider)
    → set_cached_provider(repo_path, git_provider)  ← 首次注入缓存

PR 操作 (list_prs / view_pr / ...)
  → dispatch fn 调用 resolve_provider(repo_path)    ← 读缓存
    → match provider {
        GitHub  => GitHubPrProvider,
        GitLab  => GitLabPrProvider,    // future
        Gitee   => GiteePrProvider,     // future
        Unknown => 返回 "unsupported provider" 错误
      }
    → provider.list_prs(repo_path, ...)
```

### 调度函数（`pr/mod.rs`）

```rust
/// Factory: GitProvider → Box<dyn PrProvider>
fn create_provider(provider: GitProvider) -> Result<Box<dyn PrProvider>> {
    match provider {
        GitProvider::GitHub => Ok(Box::new(GitHubPrProvider)),
        GitProvider::GitLab => Err(anyhow::anyhow!("GitLab PR operations not yet supported")),
        GitProvider::Gitee => Err(anyhow::anyhow!("Gitee PR operations not yet supported")),
        GitProvider::Unknown => Err(anyhow::anyhow!("Unknown Git provider — PR operations unavailable")),
    }
}

// 17 个 dispatch 函数，模板如下：
pub fn list_prs(repo_path: &Path, state: &str, limit: usize) -> Result<Vec<PRListItem>> {
    let provider = resolve_provider(repo_path);
    let client = create_provider(provider)?;
    cache::get_cached_pr_list(repo_path, state, limit, || {
        client.list_prs(repo_path, state, limit)
    })
}

// checkout_pr 为独立函数（git 原生操作）
pub fn checkout_pr(repo_path: &Path, pr_number: u64) -> Result<()> {
    let output = std::process::Command::new("git")
        .args(["fetch", "origin", &format!("pull/{}/head:pr-{}", pr_number, pr_number)])
        .current_dir(repo_path)
        .output()?;
    // ...
}
```

### GitHubPrProvider 实现

`pr/github.rs` 从当前 `pr.rs` 迁移：
- 所有 `no_window_cmd("gh")` 调用不变
- 内部 helper 函数（`get_gh_repo_owner_name`、`fetch_pr_closed_by`、`fetch_issue_comments`、`fetch_pr_reviews`、`get_pr_head_sha`）改为 priv 方法
- 删除 `cache::get_cached_*` 包装（缓存由 dispatch 层统一处理）
- 删除 `invalidate_repo_caches` 调用（由 dispatch 层处理）

```rust
pub struct GitHubPrProvider;

impl PrProvider for GitHubPrProvider {
    fn name(&self) -> &'static str { "GitHub" }
    fn is_installed(&self) -> bool { ... }
    fn is_authenticated(&self) -> bool { ... }
    fn list_prs(&self, repo_path: &Path, state: &str, limit: usize) -> Result<Vec<PRListItem>> {
        // 纯 gh CLI 调用，无 cache 包裹
        let output = no_window_cmd("gh")
            .args(["pr", "list", "--json", "...", "--state", state, "--limit", &limit.to_string()])
            .current_dir(repo_path)
            .output()?;
        // ... 解析 JSON ...
    }
    // ... 其余 15 个方法类似迁移 ...
}
```

### 缓存层不变

`cache.rs` 与 provider 无关 — 它以 `repo_path` + 数据类型为键，不关心从哪个 provider 获取数据。dispatch 函数负责在调用 provider 前后包裹 cache。

写操作（`merge_pr`、`close_pr`、`checkout_pr`）仍调用 `invalidate_repo_caches(repo_path)` + `invalidate_provider_cache(repo_path)`。

### 向前兼容

| 层面 | 保证 |
|---|---|
| Tauri 命令 | `commands.rs` 所有函数签名不变 |
| `git/mod.rs` | `pub use crate::common::git::pr::*` 不变 |
| `common/git/mod.rs` | `pub mod pr; pub use pr::*` 不变 |
| 前端 | 所有 invoke 命令名、参数、返回类型不变 |
| 缓存 | `cache.rs` 完全不动 |

### 错误处理策略

| 场景 | 行为 |
|---|---|
| ProviderStore 未命中 | `resolve_provider` 执行 `get_git_provider`（一次 `git remote` 调用）并缓存 |
| GitLab/Gitee 仓库 | `create_provider` 返回 `Err("not yet supported")` |
| gh CLI 未安装 | `GitHubPrProvider::is_installed()` 返回 false → 前端降级提示 |
| gh auth 未登录 | `GitHubPrProvider::is_authenticated()` 返回 false → 前端引导登录 |

### 未来扩展

| 步骤 | 描述 |
|---|---|
| 1 | 实现 `GitLabPrProvider`（使用 `glab` CLI 或 GitLab REST API） |
| 2 | 实现 `GiteePrProvider`（使用 Gitee API） |
| 3 | 前端按 provider 门控 PR 面板（`canManagePRs` 判断） |
| 4 | Avatar URL 按 provider 切换 |
