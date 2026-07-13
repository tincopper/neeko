# Phase 1: Git Provider 检测

## 目标

在后端通过 `git remote get-url origin` 检测 Git 提供商（GitHub / Gitee / GitLab / Unknown），存入 `GitInfo`，序列化到前端类型层。**不改变任何行为** — `canManagePRs` 和 PR 面板显示保持不变。

## 需求

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
   - `local::get_git_info` → `provider.rs:get_git_provider`
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

1. 在 `src/features/git/types.ts` 的 `GitInfo` 接口中增加 `gitProvider: 'github' | 'gitee' | 'gitlab' | 'unknown'`
2. **不消费该字段** — 所有现有行为（capabilities、PR 面板等）完全不变

### 不做的事（后续阶段）

- 将 `pr.rs` 重构为 `PrProvider` trait
- 按 provider 门控 PR 面板
- Avatar URL 按 provider 切换
- 任何 GitLab/Gitee CLI 或 API 集成

## 验收标准

- [ ] 任务目录已创建，PRD 已编写
- [ ] `GitProvider` 枚举在 Rust 后端中定义
- [ ] 本地 Git 仓库可检测 provider 并存入 `GitInfo`
- [ ] WSL 项目可检测 provider 并存入 `GitInfo`
- [ ] SSH 远程项目可检测 provider 并存入 `GitInfo`
- [ ] 前端 `GitInfo` 类型包含 `gitProvider`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 通过
- [ ] `pnpm type-check` 通过
- [ ] 所有现有 PR 功能继续正常工作

## 实施步骤

### Step 1: Rust 后端
1. 在 `src-tauri/src/common/types.rs` 添加 `GitProvider` 枚举 + 字段
2. 同步字段到 `src-tauri/src/project/model.rs`
3. 创建 `src-tauri/src/common/git/provider.rs` 检测逻辑
4. 在 `src-tauri/src/common/git/mod.rs` 注册新模块
5. 接入 `local.rs`、`operations.rs`、`remote.rs`

### Step 2: 前端
6. 在 `src/features/git/types.ts` 添加 `gitProvider`

### Step 3: 验证
7. `cargo test`
8. `pnpm lint`
9. `pnpm type-check`
