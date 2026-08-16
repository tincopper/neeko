# Implement：Diff 内容陈旧——后端单一缓存（输入指纹校验）+ 前端去缓存

## 目标

按 design.md（D1-D3）落地：后端工作区 diff 输入指纹校验缓存 + 前端去缓存 + 感知通道增强。TDD 全流程。

## 顺序（TDD，后端先行）

### P1 后端：指纹校验缓存（R1）

1. **Red**：在 `cache.rs` 补回归单测——
   - `worktree_diff_recomputes_when_file_changed`：写文件 A → 计算 diff（入缓存）→ 修改文件 A → 再次 `get_cached_worktree_diff` → 断言返回**新内容**（指纹不一致重算）。
   - `worktree_diff_hits_cache_when_unchanged`：文件未变 → 二次调用命中缓存（fetch 只执行一次）。
   - `worktree_diff_recomputes_when_head_moves`：切换分支（HEAD oid 变化）→ 重算。
   - `immutable_diff_cached_by_stable_key`：commit/stash 语义长期命中、免指纹。
2. **Red**：确认失败。
3. **Green**：改造 `cache.rs`——
   - `DiffEntry { result, fingerprint: Option<FileFingerprint> }`。
   - `FileFingerprint { mtime_ns, size, head_oid }`。
   - `get_cached_worktree_diff(repo_path, file_path, collapse, fetch -> (DiffResult, FileFingerprint))`：命中时 stat 校验，不一致重算。
   - `get_cached_immutable_diff(repo_path, stable_key, collapse, fetch)`：免指纹长期缓存。
   - 保留 `invalidate_repo_caches` / `get_cached_diff` 兼容或按调用点更新。
4. **Green**：`local.rs get_file_diff` 改用指纹 API——`fetch` 闭包内 stat 文件 + 取 HEAD oid 计算指纹，返回 `(DiffResult, FileFingerprint)`；`get_commit_file_diff` / `get_stash_file_diff` 不受影响（本就不走 DIFF_CACHE）。
5. **Green**：`operations.rs get_file_diff` 远程/WSL（shell 分支）**不写缓存**（R2）。

### P2 前端：去缓存 + 感知通道（R3/R4）

6. **Red**：改写 `useDiffData.test.ts` 为无缓存语义——
   - 挂载即拉：renderHook 后 `getFileDiff` 被调用。
   - 信号重拉：`git-status-diff` 事件 → 再次 invoke。
   - 手动刷新：`bumpGitRefresh` → 再次 invoke。
   - 删除原"缓存命中不再调用"类断言。
7. **Red**：确认失败（现实现有缓存命中行为）。
8. **Green**：`useDiffData.ts`——
   - 删除 `diffCache` / `setDiffCache` / `DIFF_CACHE_MAX` / `getCacheKey` 及命中/写入。
   - `loadDiff` / `loadFullHunks` 直接 `fetchDiff` → setState。
   - 新增订阅 `GIT_STATUS_DIFF_EVENT`（项目级匹配 → refreshTick++）；保留 `file-changed` 与 `useGitRefresh`。
   - 返回签名不变。

### P3 门禁 + 真机验证

9. 全部门禁：
   ```bash
   cargo test --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml
   cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
   pnpm lint:fe        # eslint + tsc + vitest 全量
   npx tsc --noEmit
   ```
10. 真机（`pnpm tauri dev`）验证 AC1-AC4：
    - AC1 打开 diff → 编辑文件 → diff 自动刷新。
    - AC2 关闭 diff tab → 编辑 → 重开 → 新内容。
    - AC3 手动刷新按钮 → 新内容。
    - AC4 后端独立性（指纹校验）由 Rust 单测覆盖，可再跑一次两次 invoke 中间改文件验证。

## 校验命令

见 P3 第 9 步全量命令；最小回归集按 AGENTS.md：`pnpm lint` + `pnpm type-check` + `pnpm test:run` + `cargo test`。

## 审查门（Review Gates）

- 后端：Command 层极薄（`git/commands.rs` 不动）；`cache.rs` 无阻塞 I/O（stat 在 spawn_blocking 内）；无裸 `std::process::Command`。
- 前端：`useDiffData` 无跨挂载缓存（模块级 Map 删除）；事件名走 `shared/events.ts` 常量（`GIT_STATUS_DIFF_EVENT`）；API 调用仍走 `gitApi` wrapper。
- 不改 IPC 命令签名 / `DiffResult` / 组件 props。

## 回滚点

- 前端：仅 `useDiffData.ts` + 测试两个文件，单文件可回滚。
- 后端：`cache.rs` + `local.rs` + `operations.rs`，`get_cached_diff` 保留旧签名兼容即可回退。
- 全程无需迁移数据、无 schema 变更。

## 已知限制（记录，非本任务）

- WSL/远程无事件源：diff 依赖挂载/聚焦必拉 + 手动刷新（物理边界）。
- worktree watcher 补齐（R5）为后续项，不影响 AC1-AC6。

## 完成标准

- AC1-AC4 真机通过；AC5 无性能回归（commit/stash 仍缓存）；AC6 单测全绿。
- `task.py validate` 通过；`neeko-check` 增量审核无 Block/Warning。
