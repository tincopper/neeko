# C2 可见集合替换单槽：删除排他挂载

> 父任务：`.trellis/tasks/11-04-git-status-observability/`
> 架构依据：父任务 `design.md` §1（三段式）、§2（删除台账 D1–D6/D10）、§4（反转 D-B）。
> 前置：C1（状态模型）已完成 —— 读路径已与「是否挂载」解耦。

## Goal

**删除「至多一套挂载」这条不变量**，让任意多个 Workspace 同时拥有 push 生产者。
「A/B 互踢」从此**结构性不可能**（没有互斥槽可抢），而不再是「靠时间窗/重试让互踢变慢」。

## Background（现场证据）

`~/.neeko/neeko.log`（2026-11-04）里同一项目的主仓与 linked worktree 无限互踢：

```
19:03:40.277 activating <pid>            ← mount_only 释放 worktree
19:03:40.449 activating <pid>\0…/multi-agent   ← 172ms 后被反向释放
…（每 1.5–11.6s 一对，持续 ≥25 分钟）
```

每轮代价：`GitStatusWorker` 线程销毁重建 + 全树 `WatchManifest::compute` + FSEvents 流重建 +
`git status` 重跑。挂载存活期常短于一次重算 ⇒ 快照刚产出就被 `release` 删掉。

根因是 `WatcherManager::mount_only`（`manager/core.rs:824-845`）的 `release_except_inner`：
**排他性本身**。C1 已让读路径不再依赖挂载态，但排他仍在，所以只要有两个激活意图
（主仓 / worktree）就会持续互踢。

## Requirements

### R1 多单元同时挂载（P0）

- R1.1 `WatcherManager` 提供「确保这些单元已挂载」的批量入口；挂载一个单元**不释放**任何其它单元。
- R1.2 批量入口幂等：已挂载的单元不重建资源（不新建线程、不重建 FSEvents 流、不重复注册）。
- R1.3 新命令 `set_visible_workspaces(workspaces: Vec<WorkspaceSession>) -> Vec<WorkspaceActivation>`；
  返回逐单元结局（`ready` / `pending`），**单个单元的冷窗口不影响其它单元**。
- R1.4 为不破坏现有前端，`set_active_workspace` **保留为薄包装**（转发为单元素集合），
  注释标明 C4 会把它替换掉。二者共用同一服务层编排。

### R2 删除排他机制（P0）

| 删除项 | 落点 | 为何消失 |
| --- | --- | --- |
| `release_except` / `release_except_inner` | `manager/core.rs` | 无排他 |
| `mount_only` | `manager/core.rs` | 由批量「确保挂载」替代 |
| `mount_release_except` 相关测试 | `lifecycle_tests.rs` | 被删除不变量的正方向断言（须改写为「互不影响」） |
| `activate_with` 里的 `release_except` 调用（含远端 pull 分支） | `git/services/status.rs` | 同上 |

- R2.1 删除项不得以「保留 + 加守卫」形式留下（review gate G1）。
- R2.2 反向测试（证明「只能剩一个」）必须改写为正向断言（证明「都可以在」），不得简单删除。

### R3 保留（并说明理由）—— 与父任务删除台账的偏差

- R3.1 **`mount_tickets` / `MountTicket` / `revoke_ticket_if` 保留。**
  父任务 `design.md` D3 的删除前提是「释放不再存在」，但 `unwatch`（worktree 被删除 /
  项目移除）仍然存在，晚到推送仍可能写回一个已不存在的单元。票号仍是这个问题的最省答案
  （比设计新机制便宜）。**登记为偏差并在 `git-domain.md §12` 说明。**
- R3.2 **`mount_lock` 保留但改名 `watch_lock`**，职责收窄为「`watch()` 的 check-then-insert 原子性」。
  它原本承担两件事：`release + watch` 成对原子（已消失）与同 key 并发挂载的互斥（仍在）。
  把它一并删掉会重新打开「同单元两套监听」的竞态（`concurrency-guidelines.md` 契约 3）。
- R3.3 `version_floors` 已在 C1 并入 `StatusStore`（不再是独立并发状态）。

### R4 观测性（P1）

- R4.1 日志里「同一单元 60s 内 activate/release 次数 ≤1」。
- R4.2 挂载集合可从日志读出（批量命令记录一次「ensure N units」）。

## Acceptance Criteria

- [x] AC1 **互踢消失**：同一项目的主仓 + linked worktree 交替 `activate` 30 次后，
      两个单元**同时**处于已挂载状态（`watched_units()` 含两者），且各自 worker 只建过一次。
- [x] AC2 批量命令：一次 `set_visible_workspaces([A, B, C])` 后三者全部挂载，任一单元冷窗口
      返回 `pending` 不影响其余两个返回 `ready`。
- [x] AC3 `rg 'release_except|mount_only' src-tauri/src` 为空（`mount_only` 若作为测试夹具
      别名出现也算违规 —— 判据是排他语义不存在）。
- [x] AC4 `unwatch` / `unwatch_project` 仍能释放并保留既有数据（C1 语义不回退）。
- [x] AC5 票号闸门仍生效：释放后旧票推送被拒（原有用例保持绿，不需要改写）。
- [x] AC6 `cargo test --lib` 全绿；`pnpm check:quick` 绿。
- [x] AC7 前端零改动即可正常工作（`set_active_workspace` 薄包装仍可用）。

## 已知遗留缺口（本任务**引入**，由 C4 收口）

`ensure_mounted` 只「确保」、**从不释放** ⇒ 本次会话访问过的每个 workspace 永久占一套
watcher + worker。正确的收敛形态是**声明式 reconcile**（挂载集合内的、释放集合外的）——
它**不是**回到互斥：集合是声明式真值，同一次调用内完成差集，不是「挂一个踢一个」的竞争。

归属：**C4**（它拥有发送端，且这是 `set_visible_workspaces` 同一函数的一处语义收紧）。
已写入父任务 `design.md §1.0` 与 C4 `prd.md` R1.3。

## 非目标

- 不改观测层流数 / manifest 成本 —— C3。
- 不删前端 `requestedIntent` / 重试环 / 回落效果 —— C4（但 C4 依赖本任务的集合命令）。
- 不实现可见集合的优先级调度（`Hot`/`Warm`/`Cold`）—— 本任务只保证「都能挂」，
  调度优先级在 C3 的调度器里落地。
