# 技术设计：Git Provider 检测

## 数据流

```
git remote get-url origin
  → provider::detect_provider(url) → GitProvider
    → GitInfo { ..., git_provider }
      → serde serialize
        → 前端 GitInfo { ..., gitProvider }
```

## 模块结构

### 新增：`src-tauri/src/common/git/provider.rs`

```rust
pub enum GitProvider { GitHub, Gitee, GitLab, Unknown }

// URL 解析（纯函数，无 I/O）
pub fn detect_provider(remote_url: &str) -> GitProvider;

// 执行 git remote get-url origin（同步，用于 local 路径）
pub fn get_git_provider(repo_path: &Path) -> Result<GitProvider>;

// 通过 Transport 获取 remote URL（异步，用于 WSL/SSH）
pub async fn get_git_provider_via_transport(
    transport: &GitTransport, work_dir: &str
) -> Result<GitProvider>;
```

### 注册

`src-tauri/src/common/git/mod.rs` 添加 `pub mod provider;` + `pub use provider::*;`

## 检测规则（URL 解析）

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

## 三个集成点

### 1. Local（`local.rs`）

`get_git_info(repo_path)` 中 `git2::Repository` 已打开，直接复用：

```
repo.find_remote("origin")
  → remote.url() → &str
  → detect_provider(url)
  → GitProvider
```

Zero 额外进程开销。

### 2. WSL（`operations.rs`）

`get_git_info_shell(transport, work_dir)` 中复用已存在的 `get_remote_url` 函数（第 1046 行）：

```
get_remote_url(transport, work_dir).await
  → 调用 transport.run_git(["remote", "get-url", "origin"])
  → detect_provider(url)
```

### 3. SSH Remote（`remote.rs`）

`get_remote_git_info(host, port, username, auth, project_path)` 中：

方案：额外一次 SSH 调用单独获取 remote URL。不修改现有的组合命令链（避免污染 `parse_git_info_output`）。

```
exec_command(host, port, username, auth,
  "cd '{path}' && git remote get-url origin 2>/dev/null || true")
  → detect_provider(url)
```

## 错误处理策略

| 场景 | 行为 |
|---|---|
| 非 git 目录 | `get_git_provider` 返回 `Unknown` |
| 无 remote origin | `git2::Repository::find_remote` 失败 → 返回 `Unknown` |
| `git remote get-url` 命令失败 | 返回 `Unknown` |
| URL 不符合任何已知模式 | 返回 `Unknown` |

所有代码路径不抛出错误 — `Unknown` 作为兜底值。

## 序列化

Rust → JSON 序列化使用 serde `#[derive(Serialize, Deserialize)]`，枚举序列化为驼峰字符串：

```json
{ "git_provider": "GitHub" }
```

前端反序列化时映射为 `gitProvider: 'github'` 等。Rust 蛇形字段通过 `#[serde(rename_all = "camelCase")]` 自动转换。
