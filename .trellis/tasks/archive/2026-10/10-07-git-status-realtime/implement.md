# 实施计划：Git changes 实时化

> 前置：`prd.md`（验收）、`design.md`（契约）。硬闸门：文档完成 + 用户确认 + `task.py start`，
> 三者齐备后才允许改码。

## 阶段划分与提交边界

每阶段 = 一个独立提交 + 可独立验证的判据。P0 是其余阶段的前置。

### P0 — 契约冻结（快照字段）

- [ ] `common/git/status_worker/writer.rs`：`GitStatusSnapshot` 增 `ahead` / `behind`
      （`#[serde(default)]`），`for_unit` 置 0。
- [ ] `src/shared/types/git.ts`：`GitStatusSnapshot` 增 `ahead` / `behind`。

**验证**：`pnpm type-check` + `pnpm test:rust`（现测不受影响）。
**回滚**：单提交 revert。

### P1 — worker 计算 + change gate（后端正确性）

- [ ] `status_worker/worker.rs`：新增 `fn ahead_behind(repo) -> (u32, u32)`（`@{upstream}...HEAD`，
      失败 → `(0,0)`）；`worker_loop` 每轮计算、纳入 `status_unchanged`、写入快照。
- [ ] 单测：upstream 推进/落后 → ahead/behind 正确；**纯 ref 变化也 emit**（workdir 不变、
      ahead 变化 → version 递增）。

**验证**：`cargo test --lib status_worker`。
**回滚**：独立提交。

### P2 — refs 监听（后端新鲜度）

- [ ] `git_meta/paths.rs`：`GitMetaPaths` 增 `refs_dir` / `packed_refs` 并解析。
- [ ] `git_meta/classify.rs`：增 `RefsChanged`；签名增 `refs_dir` / `packed_refs` 参数。
- [ ] `git_meta/watcher.rs`：`create_git_meta_watcher(_with)` 增 `on_refs_changed`；非递归监听
      `git_dir` 后追加 `refs_dir` 递归监听（`is_dir()` 门控，失败告警不致命）。
- [ ] `manager/core.rs`：接线 `on_refs_changed` → `scheduler_tx.send(())`。
- [ ] 单测：classify 三类 refs 命中 / 无关不命中；watcher 真实 FS 写 `.git/refs/heads/<b>` 触发；
      失败注入分支更新（新增 refs watch 失败不返回 None）。

**验证**：`cargo test --lib git_meta` + `cargo test --lib watcher`。
**回滚**：独立提交，回滚不影响 P0/P1。

### P3 — pull 生产者补字段（远端一致）

- [ ] `git/services/status.rs::compute_and_record`：补 `ahead/behind`（复用
      `operations::get_ahead_behind`，失败 → `(0,0)`），经 `record_computed_with` 或扩参写入。
- [ ] 单测：远端分支 pull 现算出的快照含非零 ahead/behind（本地 transport 驱动）。

**验证**：`cargo test --lib git::services::status`。

### P4 — 前端单通道消费

- [ ] `useGitStatusEventsSync.ts`：快照到达时 `setAheadBehind(snap.repo_key, {ahead, behind})`。
- [ ] `refreshUnitBranchInfo` 移除 `getAheadBehind` 调用（若仍需初始种子，保留 `useAheadBehindSync`
      作为「快照到达前的 fallback」，并在注释说明）。
- [ ] `useRefreshGitInfo` 移除独立 `getAheadBehind`（快照已含）。
- [ ] 单测：收到快照后 `gitStore.aheadBehind[repoKey]` 被写入；既有 `useRefreshGitInfo.test` 调整。

**验证**：`pnpm test:fe`。

### P5 — 收尾

- [ ] `pnpm lint`（含全部护栏）、`pnpm test:rust`、`pnpm test:fe` 全绿。
- [ ] 行为验证（AC4）：临时仓库应用外 `git commit` / `git push`，面板自动更新。
- [ ] `trellis-update-spec`：把「依赖集合 ⊆ 监听集合」与 ahead/behind 单源写回
      `git-domain.md`。

## 全量验证命令

```bash
pnpm lint
pnpm test:rust
pnpm test:fe
```

## 验收映射

| AC | 判据 |
| --- | --- |
| AC1 | `pnpm test:rust` 含新增 worker/classify/watcher 用例 |
| AC2 | `pnpm test:fe` 含快照→ahead/behind 用例 |
| AC3 | `pnpm lint` 全绿 |
| AC4 | 临时仓库外部 commit/push 后面板自动更新 |
| AC5 | `writer.rs` ↔ `shared/types/git.ts` 字段同步 |

## 待用户确认的判定

1. **是否保留 `useAheadBehindSync` 作为初始种子**（推荐保留：冷启动快照到达前徽标不空，
   到达后由快照接管；代价是一份冗余 pull），还是彻底移除？
2. **pull 生产者是否本次同步修 `origin/` 硬编码**（改用 `@{upstream}`）？推荐本次一并修，
   属于同一契约（否则非 origin 远端徽标恒错）。若控范围也可延后。
