# 任务板指派成员（assignee）+ 分配图去掉认领连线

## Goal

队长派活时就指定「谁该做」：`task_create` 接受 `assignee`，任务卡 / 分配图直接显示这个成员，
**不再靠「认领边」把成员和任务连起来**（用户裁决：派活即分配，图上的实线是多余的第二份信息）。

## 用户决策（2026-11-13）

1. 采用「加 assignee，删认领实线」的方案（不是只删线）。
2. 依赖虚线 **保留**（它编码顺序，assignee 编不出来）。
3. 图的图例从「虚线 = 依赖 · 实线 = 认领」改成只讲依赖。

## Requirements

- R1 `task_create` 接受可选 `assignee`（成员 id，与 `team_send.to` **同一种寻址**：
  `name@team_id`）。给了就必须是本队成员，否则 `NotFound` + 可用成员清单（可行动错误）；
  不给 = 未指派，行为与今天完全一致。
- R2 **指派不改变任务状态**：`state` 仍是 `pending`、`owner` 仍为空、不起租约。
  指派是「计划事实」，认领才是「执行事实」。理由见 design §2（自动 claimed 会让排队中的
  任务被租约回收器抢走）。
- R3 认领闸门收紧一条：`assignee` 存在时**只有该成员可以 claim**（别人 claim → `Conflict`，
  文案指出被指派者 + 可行动建议）。未指派任务保持「谁先到谁得」。
- R4 读侧：`view::TaskCard` 增加 `assignee`（camelCase），`TaskDetail` 自动继承；
  分配图节点副标题显示「该做的人」= `assignee ?? owner`，两者都空时显示未指派；
  **删除** `flowLayout` 的 `claim` 边与 `FlowEdgesRenderer` 的对应渲染分支
  （以及因此不再被使用的成员身份色映射，若别处无消费者）。
- R5 `assignee` 在创建后**不可改**（本轮）；改派属于「重试/重新派活」那条任务
  （`11-13-team-task-actions`），不在这里顺手加第二个写入口。
- R6 老数据兼容：既有任务行 `assignee = NULL`（未指派），不需要回填；面板不需要区分
  「老行」与「新建未指派行」。

## Non-Goals

- 不做 assignee 的自动认领 / 自动起租约。
- 不做改派（reassign）UI 与工具。
- 不改看板列语义（按 state 分组）；不给 Kanban 加新的筛选维度。
- 不改 `team_send` / `task_update` 的契约（那些在 handoff / actions 两条任务里）。

## Acceptance Criteria

- [x] AC1 `store` 层：`team_task.assignee` 列存在（v23 → v24 迁移），
      老库升级后既有行读出 `None`；新建带 assignee 的任务写读一致（round-trip 测试）。
- [x] AC2 `admission`/`dispatch` 层：`task_create` 带一个**不在本队**的 assignee ⇒ `NotFound`
      且错误信息里列出本队成员；带本队成员 ⇒ 落库为该 id。
- [x] AC3 状态机：带 assignee 创建后 `state == pending && owner == None && claimed_at == None`。
- [x] AC4 认领闸门：assignee 不是调用者时 `claim_task` ⇒ `Conflict`（文案含被指派者 id）；
      assignee 是调用者时认领成功（owner 落成该成员）；未指派任务任意成员可认领（回归）。
- [x] AC5 `view::TaskCard` 的 JSON 出现 `assignee` 字段（前端类型 + 快照测试同步）。
- [x] AC6 前端：`flowLayout` 不再产出 `kind: 'claim'` 边（单测断言 edges 只含 create/dep），
      依赖边仍在；`TeamFlowGraph` 节点副标题用 assignee/owner 的同一判据（组件测试覆盖
      三种情形：只有 assignee、只有 owner、都没有）。
- [x] AC7 图例文案只剩依赖（组件测试断言不再出现「实线 = 认领」）。
- [x] AC8 `cargo test`（team 域）+ `pnpm test`（agent-team 相关文件）+ `pnpm check:quick` 绿。

## Notes

- 规格落点：`.trellis/spec/backend/team-domain.md` §2.5（任务寻址）/ §3（准入表字段纪律）、
  `.trellis/spec/frontend/interaction-patterns.md`（图例/可点性纪律）。
- 迁移纪律：**不要**改 v17 的历史重建 DDL，新列一律走新的 `v23_to_v24` + `add_column_if_missing`，
  并同步 `CREATE TABLE team_task`（新库）/ `SELECT` / `INSERT … ON CONFLICT` / `UPDATE` 四处。
