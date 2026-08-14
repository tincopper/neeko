# Git 域规范（历史展示范围 + refs 分类 + stash）

> 后端 `common/git/` 与 `git/commands.rs` 的可执行契约，防止历史展示范围与 refs 分类回归。

---

## 1. 历史展示范围 = 当前 checkout 分支（HEAD）

**规则**：`get_commit_log`（`operations.rs` 的 transport 版与 `local.rs` 的同步版）必须固定
`git log --format=... --decorate=full --topo-order HEAD`，**禁止使用 `--all`**。

**原因**：`git log --all` 会遍历所有 refs 命名空间（`refs/synara/*`、`refs/aider/*`、`refs/stash` 等），
把第三方工具私有 checkpoint refs 混入用户历史视图。HEAD 范围语义：展示当前 checkout 分支的提交，
分支切换由 Changes 面板的 BranchSwitcherPanel 完成，历史自动跟随（前端 `onRefreshGit → refresh` 链路）。

**代码参照**：`src-tauri/src/common/git/operations.rs`（`get_commit_log`）、
`src-tauri/src/common/git/local.rs`（`get_commit_log`）。两处必须保持同一「HEAD + refs 过滤」语义。

**禁止**：
- ❌ `git log --all` / `git log --branches` / `git log --remotes` 等混排多 refs 范围的调用
- ❌ 前端新增历史范围切换 UI（范围绑定 HEAD，切换发生在 Changes 面板）

## 2. refs 分类纯函数（`common/git/refs.rs`）

`parse_decorate_refs(decorate: &str) -> Vec<ParsedRef>` 解析 `%D` decorate 字符串，按 **refs 命名空间前缀**
分类，**不硬编码任何具体工具名**：

| decorate 输入 | 分类 | 短名示例 |
|---|---|---|
| `HEAD -> refs/heads/…` | Branch | `main` |
| `HEAD`（detached 单独） | Branch | `HEAD` |
| `refs/heads/…` | Branch | `feature` |
| `refs/remotes/…` / `HEAD -> refs/remotes/…` | Remote | `origin/main` |
| `refs/tags/…` / `tag: …` / `HEAD -> refs/tags/…` | Tag | `v1.0.4` |
| `refs/stash` / `HEAD -> refs/stash` | Stash | `stash` |
| 其它 `refs/*` 命名空间（`refs/synara/*`、`refs/aider/*`、`refs/bisect/*`…） | **丢弃** | — |

**规则**：
- `HEAD ->` 前缀只对 heads/remotes/tags/stash 四种已知命名空间放行；指向其它 `refs/*` 的
  `HEAD -> refs/xxx` 一律丢弃（工具私有 refs 永不渲染）。
- `stash` 属于用户自有状态，**必须保留**为 Stash 分类，与其它工具私有 refs 区别对待。
- `RefKind` serde 序列化为小写字符串（`branch`/`remote`/`tag`/`stash`），与前端 `ParsedRefKind` 对齐。

## 3. `CommitEntry` 的 refs 语义

- `refs: String`：**仅含可展示类别的过滤后 decorate 子串**（如 `main, origin/main, v1.0.4`），
  由 `parse_commit_log_output` 从 `refs_list` 短名 join 生成。空串时前端 `formatRefs` 天然返回 null。
- `refs_list: Vec<ParsedRef>`：结构化分类结果（新增字段，`#[serde(default)]` 保证向后兼容），
  前端可直接按 `kind` 染色渲染。

## 4. Stash 查询命令

- `operations::get_stash_list`：`git stash list --format=%gd%x00%gs%x00%H%x00%aI`，`parse_stash_list`
  解析 NUL 分隔；`branch` 从 `%gs` 前缀提取（`WIP on <b>:` / `On <b>:`），失败回退空串；空输出 → 空 Vec。
- `operations::get_stash_files`：`git stash show --numstat <selector>` + `--name-status <selector>`，
  解析复用 `parse_numstat_with_status`。
- 命令层（`git/commands.rs`）只做透传：`get_stash_list(project_id, worktree_path)` /
  `get_stash_files(project_id, selector, worktree_path)`，保持极薄；注册于 `neeko_invoke_handler!`。
- 三态（本地 / WSL / SSH）一律走 `GitTransport` 统一接口，禁止裸 `std::process::Command`。

## 5. 测试要求

- `parse_decorate_refs`：branch/remote/tag/stash/HEAD 用例；`refs/synara/checkpoints` 被丢弃；
  `HEAD -> refs/synara/*` 被丢弃；空 decorate。
- `parse_stash_list`：selector/hash/message/branch/timestamp 解析；空输出。
- 集成：临时仓库含孤立 `refs/synara/checkpoints` 提交时，`get_commit_log`（HEAD）不包含该提交；
  decorate 含 tool refs 的提交其 `refs`/`refs_list` 不含 tool 项；stash list/files roundtrip。

## 相关文件

- `src-tauri/src/common/git/refs.rs` — refs 分类纯函数
- `src-tauri/src/common/git/parsers.rs` — `parse_commit_log_output` / `parse_stash_list` / `parse_numstat_with_status`
- `src-tauri/src/common/git/operations.rs` + `local.rs` — `get_commit_log` / `get_stash_list` / `get_stash_files`
- `src-tauri/src/git/commands.rs` + `src-tauri/src/lib.rs` — 命令透传与注册