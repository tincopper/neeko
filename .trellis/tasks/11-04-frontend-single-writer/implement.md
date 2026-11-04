# C4 Implement — 热集合 reconcile + 删除补偿机制

> 前置：读 `src/AGENTS.md`（硬指令：动手改 `src/**` 前必须读）与父任务 `design.md §1.0/§1.5/§2`。
> 关键约束：**删除优先**。任何「保留 `requestedIntent` 但加注释/开关」的写法直接驳回。

## 0. 勘察（开工第一步）

- [ ] `rg -n "useActiveWorkspaceSync|useActivateWorkspace|ACTIVATION_RETRY|requestedIntent" src`
      —— 确认唯一调用链：`useAppShellData` → `useActiveWorkspaceSync` → `useActivateWorkspace` → `gitApi.activateWorkspace`。
- [ ] `rg -n "set_active_workspace|set_visible_workspaces" src src-tauri/src`
      —— 前者待删（前端调用点 + 命令 + `lib.rs` 注册）；后者已就位。
- [ ] `rg -n "clearActiveWorkspace|invalidateStatus" src/features/project src/app`
      —— 确认「删除 worktree → 回落主仓」这条路径**已存在**（R2.2 的替代触发者），不需要新建。
- [ ] `rg -n "aheadBehind" src` —— 确认 C1 之后 `useAheadBehindSync` 是否已被快照覆盖；
      若快照已携带 ahead/behind，本任务可顺带删掉这条「冷启动种子」的第二写者（登记在偏差里）。

## 1. 后端：`set_visible_workspaces` 改为 reconcile（R1.3）

- [ ] **Red**（`git/services/status.rs`）：`visible_set_releases_units_outside_it`
      —— 先挂载 A、B（两次 `activate_many`），再 `activate_many(&[A])`，断言
      `watched_units()` 只剩 A，且 B 的登记表数据**仍在**（`snapshot(B)` 非 None）。
- [ ] **Green**：`activate_many` 在 `ensure_mounted` 之后，对**已挂载但不在本轮集合里**的单元调用
      `manager.unwatch`（走既有的释放路径，保留数据）。实现要点：
      - 集合的**判定**必须在**一次临界区内**与挂载一起完成（否则「先算差集再释放」中间有人挂上就误杀）；
        建议在 `WatcherManager` 加 `reconcile_mounted(units) -> (created, released)`，锁内完成差集。
      - 远端单元（`supports_push_producer == false`）**不参与**差集：它们从不挂载，
        也不该因为「不在集合里」去触发任何释放。
- [ ] **Red**：`reconcile_keeps_a_unit_that_is_still_in_the_set`（同集合重复调用 → 无 created、无 released）。
- [ ] 日志：`[Watcher] reconcile mounted N (new: X, released: Y)`，替换 `ensure mounted` 那条
      （R4.2 的可观测面；AC1 靠它判读）。

## 2. 前端：`useVisibleWorkspaces`（R1）

- [ ] **Red**（`renderHook` + mock invoke）：同一集合两次渲染只发一次 invoke；
      集合变化发一次；`pending` 不写 store；`failed` 只调 `logFrontendError`。
- [ ] **Green**：新建 `src/app/hooks/useVisibleWorkspaces.ts`：
      ```ts
      const hot = useHotWorkspaceSessions();      // 派生点唯一：当前 tab 所在单元（+ 可见停靠面板）
      const signature = hot.map(s => s.key).sort().join('\n');
      useEffect(() => { void syncVisible(hot) }, [signature]);
      ```
      依赖数组只用**字符串签名**，不用 `hot` 对象（`hook-guidelines.md` 常见错误 5）。
- [ ] `gitApi.setVisibleWorkspaces(workspaces)`：`invoke<WorkspaceActivationEntry[]>('set_visible_workspaces', { workspaces })`。
- [ ] 删除 `useActiveWorkspaceSync.ts` 与 `useActivateWorkspace.ts`；`useAppShellData` 改调
      `useVisibleWorkspaces()`。
- [ ] 删除 `gitApi.activateWorkspace` 与后端 `set_active_workspace`（命令 + `lib.rs` 注册 + 任何测试引用）。

## 3. 删除补偿机制（R2）

- [ ] `useAppShellData.ts:133-145` 整个 effect 删除（含依赖数组）。
      **删除前确认** R2.2 的替代路径存在：`useWorktreeListActions.performRemove` 已调
      `clearActiveWorkspace`；`useSessionBootstrap` 的清单校验是一次性读（不是 render-time 比较）。
      若发现「worktree 在别处被删而本地清单不知情」的场景，**不要**在 render 里补判据 ——
      改为在清单读取失败时回落（一次性），并在此处登记。
- [ ] `rg 'requestedIntent|inflightIntent|reportedGiveUp|retryTick|ACTIVATION_RETRY' src` → 空（AC5）。
- [ ] `rg 'set_active_workspace' src` → 空（AC6）。

## 4. 护栏（R4）

- [ ] 新检查 `tools/guards/checks/check_frontend_resource_mirror.py`：
      - 判据 A：`src/**` 生产代码出现 `requestedIntent` / `inflightMount` / `mountTicket` 类标识符 ⇒ 违规；
      - 判据 B：`refreshWorkspaceStatus(` / `getWorkspaceStatus(` 的调用行若同时位于
        `useEffect` 之外且不在事件/回调上下文中 ⇒ 违规（实现上按「文件内是否位于 `useEffect(` 的
        括号范围内」这一保守判据，允许 `const cb = useCallback(() => …)` 形态）。
      - 配套正反用例（框架强制）；接入 `pnpm lint` 与 CI（`gates.json` 若需新增门，同步接线）。
- [ ] `ledger/invariants.json` 增一条红线 17 的 enforcement 记录。

## 5. 验证

```bash
pnpm vitest related src/app/hooks/useVisibleWorkspaces.ts
cargo test --lib git::services::status        # reconcile 的三条用例
cargo clippy --all-targets -- -D warnings
pnpm check:quick                              # 收尾一次（含新护栏）
```

- [ ] AC1/AC2 靠日志与 `watched_units()` 断言（`cargo test`）+ 手测日志复核。
- [ ] 手测：访问 6 个 workspace → `~/.neeko/neeko.log` 里同一时刻在册单元 ≤2。

## 回滚点

- 后端 reconcile 与前端发送端是同一语义的两半，**必须同一个 commit**（只上后端会让前端
  不知道「集合=真值」，只上前端会让后端不释放）。
- 若需要临时回退：把 `reconcile_mounted` 的释放段关掉即回到 C2 行为（`ensure_mounted`），
  前端无需改。**不要**用环境变量长期保留双行为。

## 风险

| 风险 | 缓解 |
| --- | --- |
| reconcile 误杀「刚被别的面板挂上的单元」 | 差集在**一次临界区**内与挂载一起算（R1.3 实现要点） |
| 释放冷单元导致切回时短暂空态 | 释放保留登记表数据（C1）⇒ 切回读得到旧值 + `dirty` 触发重算，不空转 |
| 删除回落主仓 effect 后「worktree 消失」无人处理 | R2.2 的替代路径勘察（第 3 步第一条）必须先确认再删 |
| 集合签名依赖 key 顺序不稳定 | 排序后 join；签名比较是唯一判据（R1.4） |
