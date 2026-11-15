# 任务动作：重试（retry）与恢复；暂停用 stop 代替

## Goal

任务板上现在**没有任何动作**：失败/冻结的任务只能靠人重建一个新任务，上下文（body、
artifacts、依赖关系）全靠复制粘贴。本轮给最小可用的「重试」闭环，并明确「暂停」不做。

## 用户决策（2026-11-13）

- `pause` 先不做，用 **stop** 代替（停止 = 既有能力：结束成员会话 / 关闭成员，
  不是新造一个「暂停」状态）。
- 因此本轮只做 **retry**；「恢复」在本轮的含义是「把成员拉回来」（`team_resume` 已存在）+ retry。

## 现状（已核）

| 事实 | 位置 |
| --- | --- |
| 状态机 8 态，**没有 paused / retrying** | `types::TeamTaskState` |
| 成员只能把任务改成 `done / failed / blocked` | `mcp::schema` 的 `task_update` 枚举 |
| `blocked` 是回收超限后的冻结态（`reclaim_count > 3`） | `lease::should_auto_release` |
| 命令层只有建队/快照/详情/清单/配置面/关闭/删除 | `team/commands.rs` 模块文档 |
| 看板与任务详情没有任何动作按钮 | `TeamTaskBoard` / `TeamTaskCenterView` |

## Requirements

- R1 `TeamManager::retry_task(&TaskRef, actor, now) -> TeamTask`：
  - 允许的起点：`failed` / `blocked`（`done` **不允许** —— 完成是终态，重开请建新任务并声明依赖）；
  - 结果：`pending`，`owner = None`、`claimed_at = None`、`summary` 保留（交接内容不丢）、
    `reclaim_count` 归零（人工重试 = 新预算；理由见 design）；
  - 全程一条审计行（`EVENT_RETRY`），带原状态。
- R2 两个入口、同一实现：MCP 工具 `task_retry`（队长可用；成员不可 —— 授权矩阵加一格并
  同步 `authorize` 的格数断言）与本地命令 `team_task_retry(team_id, task_id)`（面板按钮）。
- R3 可选 `assignee`：重试时可以改派（`task_create` 的 assignee 本轮不可改，改派就走这里）。
  给了就按 `11-13-team-task-assignee-and-graph` 的同一寻址与校验规则写入。
- R4 前端：看板卡片与任务详情各提供「重试」动作，**只在该状态可重试时出现**（不做灰按钮 +
  tooltip；判据是纯函数 `canRetry(state)`，与后端同一份状态集合）；动作后走既有快照刷新脉冲。
- R5 「停止」不新增状态：面板已有的结束/关闭入口即 stop；本轮**不**把 stop 映射成任务状态
  变更（停一个成员不等于任务失败）。
- R6 不改租约与回收器语义：重试只是把任务放回 `pending`，`reclaim_count` 归零后仍受
  `MAX_RECLAIM_COUNT` 约束（不引入无限重试）。

## Non-Goals

- 不做 `paused` 状态、不做「暂停/继续」按钮。
- 不做任务级「取消（cancel）」（要设计成什么状态、与成员进程如何对齐，另开任务）。
- 不做批量重试 / 看板多选。
- 不改 `team_wait` 语义（重试后仍用 `declared` 等结果）。

## Acceptance Criteria

- [ ] AC1 manager 单测：`failed → pending`、`blocked → pending` 各一条；`done → 拒绝` 一条；
      `pending / claimed / in_progress / awaiting_approval / proposed → 拒绝`（穷尽 match 断言）。
- [ ] AC2 `reclaim_count` 归零、`owner` / `claimed_at` 清空、`summary` 与 `body` 保留
      （一条 round-trip 断言，避免「重试把交接内容洗掉了」）。
- [ ] AC3 审计行：`team_event.kind = retry`，detail 里带原状态；`subject` 仍是队内 task id。
- [ ] AC4 MCP：`task_retry` 在授权矩阵里是**队长专属**（成员调用 ⇒ 拒绝），
      矩阵格数断言同步更新；`ALL_TOOL_NAMES` / `TOOLS` 两份清单同步（两条既有护栏测试）。
- [ ] AC5 本地命令：`team_task_retry` 走同一 manager 方法（命令层极薄，一条 dispatch 断言），
      前端 `invoke` 的错误可见（失败不静默）。
- [ ] AC6 前端：`canRetry` 纯函数 8 态全覆盖单测；卡片/详情只在可重试时渲染动作；
      重试成功触发刷新（沿用既有脉冲，不新增事件名）。
- [ ] AC7 `pnpm check:quick` 绿 + team 域 `cargo test` 绿。

## Notes

- 依赖：`11-13-team-task-assignee-and-graph`（R3 的 assignee 校验复用它的寻址规则）。
- 规格落点：`.trellis/spec/backend/team-domain.md` §0（租约/回收边界）、§2.2（两相位与审计）。
- `authorize.rs` 的矩阵是「工具数 × 角色数」自算格数，加工具必须同步改动那条断言 ——
  这是本轮最容易漏的一处。
