# Phase 1: Git Provider 检测（已完成）

## 目标（已实现）

在后端通过 `git remote get-url origin` 检测 Git 提供商（GitHub / Gitee / GitLab / Unknown），存入 `GitInfo`，序列化到前端类型层。**不改变任何行为** — `canManagePRs` 和 PR 面板显示保持不变。

## 需求（已实现）

### 后端

1. 在 `src-tauri/src/common/types.rs` 中定义 `GitProvider` 枚举：
   ```rust
   pub enum GitProvider {
       GitHub,
       Gitee,
       GitLab,
       Unknown,
   }
   ```
2. 在两个 `GitInfo` 结构体（`common/types.rs` + `project/model.rs`）中增加 `git_provider: GitProvider` 字段
3. 新增文件 `src-tauri/src/common/git/provider.rs`，实现检测逻辑：
   - `fn detect_provider(remote_url: &str) -> GitProvider` — 解析 URL 主机名
   - `fn get_git_provider(project_path: &Path) -> Result<GitProvider>` — 执行 `git remote get-url origin`，调用 `detect_provider`
4. 在所有 `get_git_info` 代码路径中接入检测：
   - `local::get_git_info` → git2 `find_remote("origin")`
   - `operations::get_git_info_shell`（WSL）
   - `remote::get_remote_git_info`（SSH）

**检测规则：**

| 主机名模式 | 提供商 |
|---|---|
| `github.com` | GitHub |
| `gitee.com` | Gitee |
| `gitlab.*` | GitLab |
| 其他 | Unknown |

### 前端

1. 在 `src/features/git/types.ts` 的 `GitInfo` 接口中增加 `git_provider: string`
2. `BranchInfo.tsx` 显示 provider 标签（GitHub → blue, GitLab → orange, Gitee → red）

### 已提交

- 提交 `dc65746`: `feat(git): detect Git provider from remote URL (GitHub/GitLab/Bitbucket/Gitee)`

---

# Phase 2: PR 后端接口化（规划中）

## 目标

将当前硬编码调用 `gh` CLI 的 PR 模块重构为基于 `PrProvider` trait 的接口化架构，使不同 Git 提供者可以各自独立实现 PR 操作。同时引入 `ProviderStore` 缓存 repo → GitProvider 映射，避免重复的 remote URL 检测。

## 需求

### 后端

1. **Trait 定义**：`PrProvider` trait 包含 17 个 PR 操作方法（list、view、create、merge、close、comments 等）
2. **模块重构**：`pr.rs` 拆为 `pr/mod.rs` + `pr/github.rs` + `pr/gitlab.rs` + `pr/gitee.rs`
3. **ProviderStore**：
   - `resolve_provider(repo_path) -> GitProvider` — 缓存优先，未命中时 fallback 到 `get_git_provider`
   - `set_cached_provider(repo_path, provider)` — 由 `get_git_info` 在刷新时注入
   - `invalidate_provider_cache(repo_path)` — 写操作后调用
4. **调度函数**：`pr/mod.rs` 暴露 17 个 `pub fn` dispatch 函数（与当前 `pr.rs` 签名一致），内部：
   - ① `resolve_provider(repo_path)` 获取 `GitProvider`
   - ② `create_provider(provider)` 创建对应 `Box<dyn PrProvider>`
   - ③ 调用 provider 方法并包裹 `cache::get_cached_*`
5. **GitHub 实现**：`GitHubPrProvider` 基于现有 `gh` CLI 代码，去掉 cache 包裹
6. **Stub 提供者**：`GitLabPrProvider` / `GiteePrProvider` 返回 "not yet supported" 错误
7. **`checkout_pr`**：从 trait 中移除，改为 git 原生独立函数
8. **向后兼容**：所有 Tauri 命令签名、模块 re-export、前端调用完全不变

### 前端

- 无变更（所有命令名、类型不变）

### 不做的事

- GitLab/Gitee 的 CLI 或 API 集成（仅 stub）
- 按 provider 门控 PR 面板（`canManagePRs` 逻辑）
- Avatar URL 按 provider 切换
- 前端 provider 选择 UI
- 前端显式 provider store

## 验收标准

- [ ] `pr.rs` → `pr/mod.rs` + `pr/github.rs` 拆分完成，`cargo check` 通过
- [ ] `PrProvider` trait 定义完整，17 个方法
- [ ] ProviderStore 实现 resolve/set/invalidate，`set_cached_provider` 在 `get_git_info` 中调用
- [ ] `GitHubPrProvider` 实现并通过测试（现有 gh CLI 代码迁移）
- [ ] `GitLabPrProvider` / `GiteePrProvider` stub 返回清晰错误
- [ ] `checkout_pr` 改为 git 原生独立函数（`git fetch origin pull/N/head`）
- [ ] `cache.rs` 完全不动
- [ ] `commands.rs` 完全不动
- [ ] 所有前端 invoke 命令不变
- [ ] `cargo test` 全部通过
- [ ] `pnpm type-check` 通过
