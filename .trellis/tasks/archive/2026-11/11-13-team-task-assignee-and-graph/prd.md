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

---

# 第 2 轮：分配图的可读性与交互（用户 2026-11-13 验收反馈）

> 上面第 1 轮已实现并全绿；以下是同一任务的第 2 轮返工，**不新开任务**。

## 用户反馈与裁决

1. **看不到任务被哪个成员领了** —— 节点副标题当前是 `assignee ?? owner`，两者都有时只显示
   指派者，"谁实际认领了"被盖掉。裁决：节点**同时**表达两件事（指派 / 认领），各自带标签。
2. **队长到下面任务的线没有出现** —— `create` 边是 `1 3` 点线 + 极淡描边，实际只剩箭头可见；
   且非首层任务的派发线会穿过中间层节点。裁决：派发线改成**可见实线**，**只画首层任务**
   （其余任务由依赖虚线追溯到 lead，因果链不断）。
3. **成员不该平铺在最下面，先不要了** —— 移除成员行渲染。裁决：本轮不渲染；`flowLayout`
   的 `workerRow/memberRow` 纯计算与测试**保留**（"先"不要，能力留着，一行 JSX 即可恢复）。
4. **不支持鼠标拖动 / 滚轮缩放** —— 裁决：图组件自带视口能力（wheel zoom + pointer 拖拽平移），
   两个宿主（dock 面板 / 中央 tab）都生效；中央 tab 保留 `+/-/重置` 按钮作为键盘等价。

## Requirements（第 2 轮）

- R2.1 节点副标题分两行，各自独立推导、**不得互相覆盖**（这是本轮 #1 的根因）：
      - 第一行（计划事实，只读 `assignee`）：`t1 · 指派 {name}`；`assignee` 为空但
        `owner` 非空时写 `t1 · 指派 —`；两者都空写 `t1 · 未指派`。
      - 第二行（执行事实，只读 `owner`）：`已认领 {name}` / `待认领`。
      四种组合的确切文本以 `design.md §8` 的表为准（PRD 初稿把「只有 owner」写成
      「未指派」是措辞冲突，已按 §8 修正 —— 空指派槽不等于「没人碰过」）。
      节点高度相应加高；字号/截断沿用 `utils/svgText.ts` 的单一实现。
- R2.2 派发边可见：`FlowEdgesRenderer` 的 `create` 分支去掉 `1 3` 点线，改用可见实线
      （与依赖虚线在**线型**上区分，不靠颜色深浅）；`flowLayout` 的 `create` 边与 `dispatched`
      只覆盖**首层（layer 0）**任务。图例同步为「实线 = 派发 · 虚线 = 依赖」。
- R2.3 移除成员行 JSX 与 `memberY/memberX/memberById` 几何；`contentW` 只按任务层 + lead 胶囊算，
      `contentH` 不再 `+40`。`members` prop 保留（aria-label 仍报成员数，且为将来恢复留口）。
- R2.4 视口：组件内 `wheel`（原生非 passive 监听，`preventDefault`）改 zoom；`pointerdown/move/up`
      拖拽改滚动容器的 `scrollLeft/scrollTop`；拖动超过阈值时**吞掉 click**，避免拖完误开任务详情。
      缩放钳在 `0.5 ~ 2.5`。中央 tab 通过 `zoom` + `onZoomChange` 受控，dock 不传 → 组件内部自管。
      **同一时刻只有一个 zoom 持有者**（红线 17 同族：不做影子副本）。
- R2.5 视口的纯逻辑（zoom 钳制 / wheel delta → 新 zoom / 拖动阈值）抽成可直测的 hook 或纯函数；
      不在组件里堆裸事件处理。

## Non-Goals（第 2 轮）

- 不做节点自由拖拽重排（图仍是快照投影，不编排）。
- 不引入 dnd-kit（那是列表排序；画布 pan 是标准 pointer 事件，不是排序）。
- 不做 minimap / 双击复位 / 键盘方向键 pan（缩放已有按钮等价）。
- 不改后端、不改 `flowLayout` 的 `workerRow/memberRow` 数据结构。

## Acceptance Criteria（第 2 轮）

- [x] AC2.1 `FlowTaskNode` 组件测试：四种组合（只有 assignee / 只有 owner / 两者都有 / 都没有）
      各自断言两行副标题的**确切文本**；特别是「两者都有且不同」时两行分别出现两个名字。
- [x] AC2.2 `flowLayout` 测试：三层结构下 `create` 边数量 == 首层任务数、`dispatched` 同步；
      组件测试断言 `path.flow-create` 存在且 class 里**没有** `1 3` 点线残留（改断言 `strokeDasharray`
      属性或改为实线 class）；图例含「实线 = 派发」与「虚线 = 依赖」。
- [x] AC2.3 组件测试：传入 members 时 SVG 内**没有**成员行（断言成员名 + `任务` 计数不出现），
      且 `viewBox` 高度比第 1 轮小。
- [x] AC2.4 视口纯函数测试：clamp 上下界、wheel 上滚放大/下滚缩小、同值时不变；
      组件测试：`wheel` 调用后 `onZoomChange` 收到钳制后的值（受控模式）、非受控模式 SVG 宽度变化；
      pointer 拖动改变容器 `scrollLeft`，且超过阈值时 `onOpenTask` **不**被调用。
- [x] AC2.5 `pnpm check:quick` 绿（含组件规模护栏：新增文件都 ≤300 行）；
      `pnpm vitest` 覆盖 `agent-team` 相关文件绿；`tsc --noEmit` 绿。

---

# 第 3 轮：只启动被指派到的成员（用户 2026-11-13 验收反馈）

> 现场：`team tm_1a1d2f634c2` 两个任务却起了 4 个 worker
> （solver / calculator / reviewer / checker），且 `t2.owner = lead@…` —— **队长自己领了活**；
> 四个任务的 `assignee` 全是 NULL。

## 用户裁决

「成员不是需要每一位都进行参与，lead 根据任务的分配，分配给谁就是谁了不要重复分配，
如果 4 位成员只有两个任务，那么只需要两位成员参与即可。」

⇒ **参与人数由任务板决定，不由可用 CLI 池决定**；一个任务一个指派，不重复指派，
未被指派的成员**不起进程**。

## 根因（三层，都要修）

1. **顺序死锁**：`assignee_arg` 要求 `member_of_team`（成员已落库）⇒ 必须先 `team_spawn`
   再 `task_create(assignee=…)`；而 `team_spawn` 没有任何「这块活是谁的」约束
   ⇒ 队长只能先把池子填满再派活，且干脆不填 `assignee`。
2. **preamble 主动把池子说成花名册**：`Staff to the plan: for each task spawn …`、
   `Do not let one member take everything; parallelize where the plan allows`、
   `spawnable_block` 列出全部 4 个可启动 CLI。
3. **授权矩阵漏一格**：`Lead × task_claim = true` ⇒ 队长能自己 `task_claim` 抢活
   （现场 `t2.owner = lead@…`）。

## Requirements（第 3 轮）

- R3.1 **`assignee` 必填**：`task_create` 的 `assignee` 进 `required`，`dispatch::create`
  拒绝缺失/空白（不是静默变 None）。这是「派活即指派」的硬约束。
- R3.2 **`assignee` 允许指向计划中的成员**：校验放宽为「本队成员 id（已落库）**或**
  `name@<team_id>` 形状的计划 id」；跨队 id、畸形 id 仍 `NotFound` + 可行动理由。
  这样队长可以**先写任务带指派 → 再按板上出现的指派起人**，解开顺序死锁。
- R3.3 **`team_spawn` 只认已被指派的成员**：待 spawn 的 `{name}@{team_id}` 必须出现在
  **至少一个未终结任务**的 `assignee` 里，否则 `Conflict` + 可行动理由
  （「这个成员没有任务，别起；先 `task_create(assignee=…)`」）。
  未被指派 / 已完成 / 重复指派都不放行 ⇒ 2 个任务最多起 2 个成员。
- R3.4 **不重复分配 = 一个任务一个指派，起的人数 = 板上不同指派人数**：
      `assignee` 是单值列（结构上不可能把一个任务派给两个人）；`team_spawn` 的重名
      检查保证一个成员只起一次。**不禁止**同一成员承接多个有依赖顺序的任务（t1 → t2
      由同一个人做是合法复用），所以这里不加「同一 assignee 只能有一个未终结任务」的硬约束
      —— 那会破坏依赖链。
- R3.5 **队长不能自己领活**：授权矩阵 `Lead × task_claim = false`（矩阵格数测试同步）。
- R3.6 **preamble 改成「任务驱动的人员规划」**：删掉鼓励填满池子的措辞，明确
  「one member per task / spawn exactly the assignees / the pool is a menu, not a roster」，
  并把 `assignee` 必填写进工具说明。preamble 仍 ≤ `MAX_PREAMBLE_CHARS`。
- R3.7 **前端面板同步**：`TeamLaunchPanel` 里「成员位 / 池子」的文案要说明
  「这是可选 CLI 池，实际参与人数由队长按任务数决定」，避免用户以为 4 个池位 = 4 个进程。

## Non-Goals（第 3 轮）

- 不做「自动按任务数起人」（编排决策仍由队长做，Neeko 只做状态校验）。
- 不做人员复用/负载均衡策略。
- 不改 `claim_task` 的既有 assignee 闸门（第 1 轮已做）。
- 不做图表/花名册的「未参与」标记。

## Acceptance Criteria（第 3 轮）

- [ ] AC3.1 `task_create` 缺 `assignee` ⇒ `InvalidInput`；带本队已落库成员 ⇒ 成功（回归）。
- [ ] AC3.2 `task_create` 带**计划中的** `name@<team>` ⇒ 成功且 `assignee` 落库；
      带别队 id / 无 `@` / 空 name ⇒ `NotFound` 且理由可行动。
- [ ] AC3.3 `team_spawn` 的名字未出现在任何未终结任务的 `assignee` ⇒ `Conflict`
      且不落库；出现在 ⇒ 成功。
- [ ] AC3.4 3 个任务只指派了 2 个不同成员 ⇒ 只能 spawn 2 次，第 3 个名字 `Conflict`；
      同一成员承接两个有依赖的任务仍成功（依赖链复用不被误杀，回归断言）。
- [ ] AC3.5 授权矩阵：`Lead × task_claim = false`（逐格测试改一格 + 理由可行动）。
- [ ] AC3.6 preamble 单测：含「one member per task」/ 「pool is a menu」语义，
      **不再**含 "parallelize where the plan allows"；预算断言仍绿。
- [ ] AC3.7 `cargo test`（team 域 + server）、`pnpm check:quick` 绿。
