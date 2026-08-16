# Design：Diff 内容陈旧——后端单一缓存（输入指纹校验）+ 前端去缓存

## 1. 架构决策（ADR）

### 决策 D1：缓存唯一所有者 = 后端；前端无状态消费者

**采纳**：删前端 `useDiffData` 模块级 `diffCache`；后端 `DIFF_CACHE` 为唯一 diff 内容缓存，并修健全。

**理由（第一性原理）**：
- 缓存应靠近数据源：后端与 notify watcher、文件系统同进程，`stat()` 微秒级，感知与校验天然更近。
- 消费者应无状态：前端删除缓存后只剩"何时去问"的职责，失败模式从"拿到错误数据"降级为"最多拿到有界的过期数据"。
- 单一真相：一份缓存、一套失效/校验策略，消除双层缓存互相掩盖。

**否决的替代方案**：
- 方案 A（后端无状态 + 前端缓存）：把状态留在前端，保留一层不必要的跨挂载状态与盲信风险。
- 方案 C（事件驱动失效）：把正确性押在 notify 事件完备性上（代码注释已自证 notify 会丢事件、有 30s heartbeat 兜底），且 worktree/WSL/远程覆盖缺失。

### 决策 D2：后端缓存正确性 = 输入指纹校验（stat），非事件失效

**采纳**：工作区 diff 缓存条目携带输入指纹 `(file_mtime_ns, file_size, head_oid)`；命中时先校验，不一致即重算。

**理由**：指纹看的是**文件/仓库本身**而非事件，天然覆盖本地/worktree/WSL/远程；不依赖任何事件管道完备性。这是 HTTP `ETag / If-None-Match` 的本地翻版。

### 决策 D3：缓存策略按输入稳定性划分

| Diff 源 | 输入 | 策略 |
|---|---|---|
| commit | commit oid + file_path（不可变）| 长期缓存，键=稳定 id，**免指纹** |
| stash | stash selector + file_path（不可变）| 长期缓存，键=稳定 id，**免指纹** |
| 工作区（本地/worktree）| 文件内容 + HEAD + index（可变）| **指纹校验缓存** |
| 工作区（远程/WSL）| 不可本地 stat | **不缓存**，每次现算 |

## 2. 现状数据流（问题态）

```
[磁盘文件更新]
   │
   ├─▶ notify watcher ──▶ file-changed 事件 ──▶ 前端 useDiffData（仅挂载+精确路径匹配）
   │
   └─▶ 前端 invoke get_file_diff ──▶ 后端 DIFF_CACHE（LRU，无指纹）──▶ 命中旧值返回 ❌
```

双层缓存：前端 `diffCache`（键 `{pid}|{source}|{path}|{collapse}`）+ 后端 `DIFF_CACHE`（键 `{repo}:{path}:{collapse}`），失效策略互不相同。

## 3. 目标数据流

```
[磁盘文件更新]
   │
   ├─▶ notify watcher ──▶ git-status-diff / file-changed ──▶ 前端触发"重新拉取"（新鲜度增强）
   │
   └─▶ 前端展示/聚焦/信号到达 ──▶ invoke get_file_diff ──▶ 后端：stat 指纹校验
                                                             ├─ 指纹一致 → 命中缓存返回
                                                             └─ 不一致/无缓存 → 现算并写缓存 ✅
```

- 后端：`get_file_diff(本地/worktree)` = 指纹校验缓存，永远返回当前磁盘真相。
- 前端：无 diff 内容缓存；每次 loadDiff 直接 invoke；`git-status-diff` 订阅驱动自动重拉。

## 4. 后端设计

### 4.1 `cache.rs`：Diff 条目携带指纹

现状 `LruCache` 存 `VecDeque<(String, DiffResult)>`。改造为条目带指纹：

```rust
struct DiffEntry {
    result: DiffResult,
    /// 输入指纹：工作区 diff 为 (mtime_ns, size, head_oid)；commit/stash 为 None（不可变，免校验）
    fingerprint: Option<FileFingerprint>,
}
struct FileFingerprint {
    mtime_ns: u64,
    size: u64,
    head_oid: String,   // HEAD 短 oid，分支/提交移动时失效
}
```

新增/改造 API（保持 Command 层与调用点最小改动）：

```rust
/// 工作区 diff：命中时校验指纹，不一致重算。fetch 返回 (result, fingerprint)。
pub fn get_cached_worktree_diff(
    repo_path: &Path, file_path: &str, collapse: bool,
    fetch: impl FnOnce() -> anyhow::Result<(DiffResult, FileFingerprint)>,
) -> anyhow::Result<DiffResult>

/// 不可变源（commit/stash）：按稳定键长期缓存，免指纹。
pub fn get_cached_immutable_diff(
    repo_path: &Path, stable_key: &str, collapse: bool,
    fetch: impl FnOnce() -> anyhow::Result<DiffResult>,
) -> anyhow::Result<DiffResult>
```

> 现状 `get_file_diff` 是 `get_cached_diff` 唯一消费者，且 commit/stash diff 走的是 `local.rs get_commit_file_diff`（**不经** `DIFF_CACHE`）。因此本改造不破坏现有 commit/stash 路径；`get_cached_diff` 可原地改造为指纹校验版（等价 `get_cached_worktree_diff`）。

### 4.2 指纹计算与校验

- **指纹捕获**：在 `fetch` 闭包内、计算 diff 前，`stat()` 目标文件取 `(mtime_ns, size)` + 解析 HEAD oid（`repo.head().target()` 前 12 位，失败用空串）。diff 计算与 stat 之间若有 TOCTOU，下次命中校验会再发现，属自愈。
- **命中校验**：命中时 `stat()` 当前文件，与缓存指纹比对；`(mtime_ns, size, head_oid)` 三者一致才返回缓存，否则重算并刷新。
- **文件不存在**（被删除/重命名）：stat 失败 → 视为指纹变化 → 重算（diff 应为空或按删除处理）；缓存中对应的旧条目随重算覆盖或随 `invalidate_repo_caches` 清掉。
- **mtime 粒度边界**：同尺寸 + mtime 未变（极少，如 touch 但内容不变）在 UI 场景可接受；纳秒级 mtime 已覆盖正常编辑。

### 4.3 远程/WSL：不缓存

`operations::get_file_diff` 的 shell 分支（远程/WSL）直接返回 `get_file_diff_shell` 结果，**不写** `DIFF_CACHE`。由于指纹基于本地 `stat` 在远端无意义，远端每次现算（SSH 单命令，可接受）；由前端"显示即拉 + 手动刷新"保证新鲜。

## 5. 前端设计

### 5.1 `useDiffData.ts` 去缓存

- 删除模块级 `diffCache`、`setDiffCache`、`DIFF_CACHE_MAX`、`getCacheKey` 及所有命中/写入逻辑。
- `loadDiff` / `loadFullHunks` 直接 `fetchDiff(...)` 并 `setState`。
- **保留** `refreshTick` 机制作为"重新拉取触发器"：`file-changed`（精确路径，编辑器实时场景）与新增 `git-status-diff`（仓库级，自动刷新主信号）与手动 `useGitRefresh` 都递增 `refreshTick` → effect 触发重新 invoke。**无缓存可读，故无陈旧命中路径**。
- 挂载即拉：首个 effect 无条件 `loadDiff()`（无缓存，天然满足 AC2）。

### 5.2 感知通道（R4）

- 新增 `useGitStatusDiff(projectId, cb)` 或在 `useDiffData` 内直接订阅 `GIT_STATUS_DIFF_EVENT`：收到该项目的仓库状态事件 → `setRefreshTick(t+1)`（路径无关，覆盖"任意文件被改"）。
- 事件 payload 为 `GitStatusDiff`（含 `project_id`），仅需项目级匹配。
- 远程/WSL：无事件 → 依赖挂载/聚焦必拉 + 手动刷新（物理边界，记录为已知限制）。

### 5.3 对组件的影响

- `useDiffData` 返回签名**不变**（`diffResult/fullHunks/loadDiff/loading/error/...`），组件零改动。
- 后端 IPC 命令签名**不变**（`get_file_diff` 等）。
- `DiffResult` 结构**不变**。

## 6. 兼容性与回归

- 现有 `useDiffData.test.ts` 大量断言依赖"缓存命中/不命中"行为 → 需按新语义重写为"每次调用都 invoke + 信号驱动重拉"。
- `cache.rs` 其它缓存（PR/统计/ahead-behind）不动，`invalidate_repo_caches` 保留。
- 门禁：`cargo test`、`cargo clippy`、`cargo fmt --check`、`pnpm lint:fe`、`npx tsc --noEmit`。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 去前端缓存后文件切换性能下降 | 后端缓存吸收（一次 IPC ~1-3ms）；cold miss 单文件 git2 diff 毫秒级 |
| mtime+size 指纹漏判（同尺寸同 mtime） | UI 场景可接受；HEAD oid 兜底分支/提交变化 |
| `get_file_diff` 现算路径回归（取消缓存后行为变化） | Rust 单测覆盖：改文件→二次调用返回新内容 |
| 现有前端测试大面积改写 | 行为测试重写为无缓存语义，维护成本一次性 |

## 8. 落地形态

- **改动文件**（预计）：
  - `src-tauri/src/common/git/cache.rs`（指纹条目 + 两个 API + 单测）
  - `src-tauri/src/common/git/local.rs`（`get_file_diff` 改用指纹 API，计算指纹）
  - `src-tauri/src/common/git/operations.rs`（远程/WSL 分支不缓存）
  - `src/features/git/components/diff/useDiffData.ts`（去缓存 + 订阅 git-status-diff）
  - `src/features/git/components/diff/__tests__/useDiffData.test.ts`（按新语义重写）
- **不改**：IPC 命令签名、`DiffResult`、组件 props、`invalidate_repo_caches` 语义。
