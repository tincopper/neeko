# design — assignee（派活即指派）+ 分配图去认领边

## 0. 一句话

`assignee` 是**计划事实**（谁该做），`owner` 是**执行事实**（谁在做）。派活时把前者写上，
图与卡片就不再需要「认领边」这个把两者混起来的投影；`claim` 仍是并发闸，只是多一条
「有指派时只有被指派者能认领」。

## 1. 为什么不自动认领（被否决的方案）

看起来更省事的是：`task_create(assignee=w1)` 直接落成 `state = claimed, owner = w1`。
**否决**，两个理由都在既有机制里：

1. **租约会被回收器抢走**。`claimed` 是 active 态，`reclaim_expired` 对 `claimed_at + lease_ttl`
   判到期（`lease_expired`），默认 ttl 30 分钟。队长一次派 5 个活、成员排队干到第 4 个，
   前两个已经在板上「过期」→ 回收成 `pending` 并**丢掉 owner**（`reclaim_expired` 会
   `owner = None`）。这正好是用户这次报的症状的翻版（板子说待认领，实际有人在做）。
2. **没有并发就没有闸门**。claim 存在的意义是「多个成员抢同一张卡时只有一个人赢」。
   指派把候选集收敛成 1 个人之后，自动 claim 只是把 `pending` 这个名字换掉，
   却额外引入「没有进程在跑却算 active」的态 —— 那种态和「成员挂了」在板上不可区分。

所以：`assignee` 只写一列，**不改 state / owner / claimed_at**（AC3 钉死）。

## 2. 数据与迁移

| 层 | 改动 |
| --- | --- |
| `types::TeamTask` | `pub assignee: Option<String>`（成员 id，`name@team_id`；`None` = 未指派） |
| `store` | v23→v24：`add_column_if_missing(conn, "team_task", "assignee", "TEXT")`；`CREATE TABLE team_task`（新库）/ `SELECT` / `INSERT … ON CONFLICT` / `UPDATE` 四处补列 |
| `migrations.rs` | `TEAM_MIGRATION_LAST: 22 → 23`，`persist_step` 加 `23 => store::v23_to_v24(conn)` |
| `view::TaskCard` | `pub assignee: Option<String>`（camelCase → `assignee`） |

**迁移纪律**：不动 v17 的 `team_task_v17` 历史重建 DDL（已发布事实）。新列只走 v24，
新库（v0 → 24）会在 v17 重建后由 v24 补列 —— 所以四处 SQL 里只有「当前形状」的三处
（select/insert/update）+ 新建库那条 `CREATE TABLE` 需要同步，历史 DDL 不碰。

`assignee` 不参与 `depends_on` / `git` / `env` 任何推导；它只有一个消费者：视图（+ claim 闸门）。

## 3. 写入面（只有一个）

```text
task_create(title, body, workspace?, depends_on?, lease_ttl?, assignee?)
  └─ dispatch::create：assignee 给了 ⇒ member_of_team(manager, principal.team_id, assignee)
       ├─ 不是本队成员 ⇒ NotFound（文案列本队成员 id 清单，模型据此自己纠正）
       └─ 是 ⇒ TeamTask { assignee: Some(id), state: Pending, owner: None, claimed_at: None, .. }
  └─ manager.create_task(task)：**不新增 assignee 的校验分支**（唯一性 / state / ttl / 摘要夹
       仍然在 manager；成员归属属于「谁能被指派」= 决定层的事实，与 `team_send.to` 同一个校验点）
```

- `assignee` **创建后不可改**（R5）：没有 `task_update.assignee`，也没有 `task_create` 之外的写点。
  改派属于 `11-13-team-task-actions`（重试时可选新 assignee）。
- 不把 assignee 写进 `team_member`、不写进 env（它不改变成员的执行环境）。

## 4. 读侧与「认领闸门」

### 4.1 claim 闸门（唯一的状态机改动）

```rust
// manager::claim_task，紧接 `task.state != Pending` 之后
if let Some(assignee) = &task.assignee {
    if assignee != member_id {
        return Err(conflict(format!(
            "task {key} is assigned to {assignee}, not to {member_id}; \
             ask the lead to retry it with a new assignee if ownership must move"
        )));
    }
}
```

`Conflict` 而不是 `Unsupported`：等一等 / 换个人就好（与 `target_blocked` 同一类判据）。
文案给出**下一步动作**（重试改派），否则模型只能反复试探。

### 4.2 视图

- 分配图节点副标题：`assignee ?? owner`，都空 → 「未指派」。三者都是 id，用同一处
  `split('@')[0]` 截短（既有写法，不新增第二个截断点）。
- 图例：只讲依赖（`虚线 = 依赖`）；`flowLayout` 不再产出 `kind: 'claim'` 的边。
- `create` 边（lead → 任务，点线）**保留**：它回答「这个需求拆成了几张卡」，
  assignee 回答「谁该做」，两者不重复。
- 看板卡片：`owner` 为空且 `assignee` 有值时显示「已指派 · {name}」，否则维持现状
  （避免在 300px 列里塞两个标签）。

## 5. 前端改动面

| 文件 | 改动 |
| --- | --- |
| `shared/types/team.ts` | `TaskCard.assignee: string \| null` |
| `agent-team/utils/flowLayout.ts` | 删 claim 边（连同 `edges.push({kind:'claim'})` 循环）；`FlowEdge.kind` 收成 `'create' \| 'dep'` |
| `agent-team/components/FlowEdgesRenderer.tsx` | 删 claim 分支、`memberById` / `memberX` / `memberY` / `TINT_STROKE` / `memberTint` 依赖（`memberTint` 本身仍被花名册使用，**不要删工具**） |
| `agent-team/components/TeamFlowGraph.tsx` | 节点副标题用 `assignee ?? owner`；图例文案；删去不再需要的 props 传参 |
| `agent-team/components/TeamTaskBoard*.tsx` / `TaskCardRow.tsx` | 未认领但有 assignee 时的短标签 |
| 测试 | `flowLayout.test.ts`（claim 边断言改「不存在」）、`TeamFlowGraph` 组件测试（三种副标题情形 + 图例文案） |

`FlowEdge.kind` 收成两值会让 `renderFlowEdges` 的 `if (edge.kind === 'claim')` 变成
编译错误 —— 这是刻意的：删一种边必须让所有消费点都被编译器点名一次（而不是留一个
永远不触发的分支）。

## 6. 红线自查

| 红线 | 本改动 |
| --- | --- |
| 4（IPC 2MB） | 只加一个 `Option<String>` 字段（成员 id）；无新载荷 |
| 5（event 名） | 不新增事件；快照自带字段 |
| 8（路径安全） | 不涉及路径（assignee 是成员 id） |
| 12（路径身份） | 成员 id 不归一化；与 `team_send.to` 同一寻址规则 |
| 14（声明即实现） | `task_create.assignee` 的 schema 与 dispatch 读点同 diff；`TaskCard.assignee` 有真实写入源 |
| 15（差异落在数据） | 无 per-CLI 分支 |

## 7. 兼容性与回滚

- 老库：v24 只加列，既有行 `assignee = NULL` = 未指派，行为与今天一致（未指派任务任何人可 claim）。
- 老前端 + 新后端：多一个字段，忽略即无影响；新前端 + 老后端会在 `task.assignee` 上读到
  `undefined` → 类型写成 `string | null`，读取处用 `?? owner`，不会崩。
- 回滚：前端可单独回滚（图只是少了 claim 边）；后端列留着无害（旧代码的 SELECT 明确列名，
  不会因为多一列而读错）。

---

# 第 2 轮设计：可读性与视口

## 8. 节点副标题：两个事实不能互相覆盖

第 1 轮把「谁该做」和「谁在做」压成了一个值 `assignee ?? owner`。用户验收时看到的
`t1 · calculator` 其实是**指派者**，而任务已被认领（`owner` 非空）—— `owner` 被 `??` 吃掉了。
这不是显示优先级选错，而是**两个不同事实被编码进同一个槽位**。

形状：节点加高到 52（viewBox 单位），三行文字。

```
┌──────────────────────────┐
│ 计算 1 到 100 的…         │  y+15  title
│ t1 · 指派 calculator     │  y+29  meta 1
│ 已认领 calculator        │  y+42  meta 2
└──────────────────────────┘
```

| assignee | owner | meta 1 | meta 2 |
| --- | --- | --- | --- |
| `A` | `null` | `t1 · 指派 A` | `待认领` |
| `null` | `B` | `t1 · 指派 —` | `已认领 B` |
| `A` | `B` | `t1 · 指派 A` | `已认领 B` ← 本轮 #1 的核心判据 |
| `null` | `null` | `t1 · 未指派` | `待认领` |

- **两行各自独立推导**，不写 `??` 串联（哪怕值相同也各算各的）。
- `memberId → 名字` 的截短仍是**唯一一处**（`FlowTaskNode` 内的 `shortId()`；第 1 轮
  `assigneeLabel` 的思路保留，只是拆成两个函数）。
- `NodeH` 从 38 → 52，`GAP_Y` 保持 34 会让层间距变紧，改 40；`renderFlowEdges` 的
  `nodeH` 由调用方传 `NODE_H`，自动跟随。

## 9. 派发边：可见 + 只连首层

### 9.1 为什么线"没出现"

`strokeDasharray="1 3"` 在 `strokeWidth=1.2`、`stroke-border-strong`（浅灰）下几乎全是空隙；
SVG 里唯一能看见的是 `markerEnd` 的三角箭头 —— 用户看到的就是"一个孤零零的箭头"。

改成**实线**（`strokeWidth=1.4` + `stroke-text-muted`），依赖边仍是 `4 3` 虚线。
两者靠**线型**区分，不靠"谁更淡"：图例写「实线 = 派发 · 虚线 = 依赖」。

### 9.2 为什么只连首层

`flowLayout` 第 1 轮给**每个任务**都生成一条 `create` 边（lead → task）。对第 1 层任务，
那条曲线必须从 `leadBottomY` 跨过整个第 0 层才能落到 `layerY(1)` —— 它会**穿过第 0 层的
节点**，与依赖边重叠成一条糊在一起的线束。

派发这个动作语义上只发生一次：队长拆出了一批**入口任务**；下游任务由 `dependsOn` 连到
上游，`t2 ← t1 ← lead` 的因果链已经完整，不需要再从 lead 单独拉一根跨层的线。

```text
dispatched   = 首层任务 id（layer 0）
create 边    = 每个首层任务一条
dep 边       = 不变
```

`FlowLayout.dispatched` 的注释同步改成「首层任务」，不要留"每个任务都由 lead 派发"的旧说法。
`flowLayout.test.ts` 那条「三层关系」用例的期望边表要改（3 条 create → 2 条）。

## 10. 成员行：只删渲染，不删能力

用户说"**先**不要了"。所以：

- 删 `TeamFlowGraph` 里 `layout.memberRow.map(...)` 整块、`memberY` / `memberX` /
  `memberById`、`MEMBER_NAME_MAX_CHARS` 与 `TEXT_SUB_STYLE` 的**使用点**。
- `contentW` = `max(层宽, 160)`；`contentH` 去掉 `+40`。
- `flowLayout(tasks, members)` 的 `workerRow` / `memberRow` **保留**（纯函数 + 既有测试），
  注释里标明「图上暂不消费，恢复只需加回一块 JSX」。避免为"先不要"删掉一整套已测能力。
- `members` prop 保留：`aria-label` 里的成员数是可访问信息，且与 `flowLayout` 的签名一致。
- `svgText.ts` 的 `TEXT_SUB_STYLE` 变成零消费者 ⇒ 从该文件删掉（不留死常量）。

## 11. 视口：wheel zoom + pointer pan

### 11.1 为什么不用 dnd-kit

`.trellis/spec/frontend/interaction-patterns.md` 的 dnd-kit 纪律针对的是**列表排序**
（重排元素顺序、有落点判定）。画布 pan 不改变任何元素顺序，只是滚动视口 —— 用 dnd-kit
没有 droppable 可判，反而会把 `DndContext` 拖进 SVG 里。这里用标准 pointer 事件 +
`scrollLeft/scrollTop`，与规范里被替换的"自研排序拖拽"不是同一件事。

### 11.2 单一 zoom 持有者（红线 17 同族）

```text
TeamFlowGraph
  zoom?: number              // 有值 = 受控（中央 tab 的 +/- 按钮）
  onZoomChange?: (z)=>void   // 受控时的回写
  ├─ 受控：effectiveZoom = zoom；wheel → onZoomChange(next)
  └─ 非受控：内部 useState(1)；wheel → setInnerZoom(next)
  // 绝不两边各存一份再同步
```

- 中央 tab 传 `zoom={zoom}` + `onZoomChange={setZoom}`，保留 `+/-/重置/百分比` 按钮
  （键盘/读屏等价路径，符合交互规范的 accessibility 底线）。
- dock 的 `TeamView` 不传 → 组件自管：滚轮缩放 + 拖拽平移都能用。
- `zoom !== undefined` 时 SVG 用精确像素（`contentW × zoom`），否则响应式 `width:100%`；
  **pan 在两种模式都生效**（滚动容器恒为 `overflow-auto`）。

### 11.3 事件落点

| 事件 | 绑定 | 理由 |
| --- | --- | --- |
| `wheel` | 容器 `addEventListener('wheel', h, { passive: false })` | React 的 `onWheel` 是 passive 合成事件，`preventDefault()` 会被忽略并打控制台警告 ⇒ 页面跟着滚。必须原生非 passive 注册，`useEffect` 清理 |
| `pointerdown/move/up` | 容器 `onPointerDown` + `setPointerCapture` | 指针移出容器仍要继续拖；`pointerup` 释放 capture |
| `click` 捕获 | 容器 `onClickCapture` | 拖动位移 > 4px 时 `stopPropagation + preventDefault`，否则拖完手一松就打开任务详情 |

`preventDefault` 只在 wheel 上做；pointerdown 不 preventDefault（ preserve 节点聚焦）。

### 11.4 纯逻辑抽离（可直测）

`utils/flowViewport.ts`：

```ts
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.5;
export const ZOOM_STEP = 0.1;          // wheel 一步
export const PAN_CLICK_THRESHOLD = 4;  // px

export function clampZoom(z: number): number;                    // 钳制 + 两位小数
export function zoomFromWheel(current: number, deltaY: number): number; // 上滚放大
export function isPanClick(dx: number, dy: number): boolean;    // 超阈值即"不是点击"
```

组件只做事件 → 调用纯函数 → 应用 state / scroll。单测直接打这三个函数 + 组件级
`fireEvent.wheel` / `fireEvent.pointer*` 的接线断言。

### 11.5 边界

- 缩放以**容器中心**为锚点：改 zoom 后按前后 `scrollWidth` 比例调整 `scrollLeft/Top`，
  让光标下的内容大致不跑偏。不做完整"以指针为锚点"的矩阵变换（YAGNI）。
- 拖动只在主键（`event.button === 0`）且 `event.isPrimary` 时开始。
- 节点仍可点开详情：只有超阈值才吞 click（AC2.4 的反证用例）。
- 不改 event 名、不加 IPC、不加新依赖。

## 12. 红线自查（第 2 轮）

| 红线 | 本改动 |
| --- | --- |
| 4 / 5 | 纯前端视口，零 IPC / 零新事件名 |
| 12（路径身份） | 不涉及路径；成员 id 仍不归一化 |
| 14（声明即实现） | 图例声明「实线 = 派发」与 create 边实线同一 diff；`onZoomChange` 声明即被 wheel 消费 |
| 17（禁止影子副本） | zoom 单一持有者；`assignee` / `owner` 两行各自独立推导，不共享一个派生槽 |
| 前端组件规模 | 新增 `flowViewport.ts`（<100 行）；`FlowTaskNode` 加高后仍 <300；`TeamFlowGraph` 删成员行后更小 |

---

# 第 3 轮设计：参与人数由任务板决定

## 13. 顺序死锁（必须先解）

```
现状：task_create(assignee) → member_of_team() 要求成员已落库
      ⇒ 只能先 team_spawn 再写任务
      ⇒ spawn 时「这块活是谁的」还不存在 ⇒ 无法约束人数
      ⇒ 队长把池子填满（现场 4 个 CLI 全起）+ 干脆不填 assignee
```

解法：`assignee` 允许 **计划中的成员 id** —— `name@<team_id>`，name 走既有的
`member_name()` sanitize（无 `@` / 无控制字符 / ≤64），`team_id` 后缀必须等于本队。
已落库成员仍走 `member_of_team`（回归）。于是顺序倒过来：

```text
plan: task_create(assignee="solver@tm_1") …   ← 任务先带指派，成员可以还没起
staff: team_spawn(name="solver")              ← 只为板上出现的指派起人
wait:  team_wait                              ← 队长不再自己 claim
```

## 14. 三道结构护栏（不靠提示词）

| # | 落点 | 判据 |
| --- | --- | --- |
| G1 | `task_create` | `assignee` **必填**（schema `required` + dispatch 拒绝缺失）；允许计划成员 id |
| G2 | `team_spawn` | 待 spawn 的 `{name}@{team}` 必须出现在**至少一个未终结任务**的 `assignee` 里，否则 `Conflict` + 指向 `task_create(assignee=…)` 的可行动理由 |
| G3 | `authorize` | `Lead × task_claim = false`（队长不能自己领活；现场 `t2.owner = lead@…` 的入口） |

**G2 为什么用「未终结任务」而不是「任意任务」**：任务 done/failed/blocked 之后不该再为它
起新进程（那是重试/改派，属于另一条任务）。判据用 `manager` 已有的
`is_terminal_task`（`Done | Failed | Blocked`），不新写一份状态分类。

**G2 放在哪儿**：`spawn()` 里所有既有参数校验（准入 / 池子 / 上限 / name / persona /
workspace / policy / model）**之后**、`add_member` 之前。这样 15 处既有参数校验用例的
错误类别不会被护栏抢先改写；只有成功路径需要板上先有指派。

**不禁止同一成员承接多个任务**（依赖链复用 t1 → t2 合法）。`assignee` 是单值列，
结构上不可能把一个任务派给两个人；`add_member` 的重名检查保证一个成员只起一次。
⇒ 起的人数 ≤ 板上不同指派人数 ≤ 任务数。用户要的「2 个任务只起 2 位」自动成立。

## 15. preamble：从「填满池子」改成「任务驱动」

三处必须删（它们共同制造了现场症状）：
- `Staff to the plan: for each task spawn (or reuse an idle member with) the persona that fits`
- `Do not let one member take everything; parallelize where the plan allows`
- `Start here: … then team_spawn (or reuse an idle member) matched to each task`

替换为：
```text
Plan first: every task_create MUST carry assignee = "<name>@<team_id>";
one member per task, distinct names unless work is sequential.
Spawn exactly the distinct assignees that appear on the board — no more.
The pool is a MENU of allowed CLIs, not a roster to fill:
spawning a member with no assigned task is refused by team_spawn.
Never claim tasks yourself (the tool refuses); wait with team_wait.
```

`spawnable_block` 的标题从 `Worker CLIs you can spawn in this team:`
改成 `Allowed worker CLIs (a menu, not a roster to fill):`，不改数据推导
（`options_for` 仍是唯一来源）。

预算：删掉的长句足以容纳新增文字，`MAX_PREAMBLE_CHARS = 3200` 不动。

## 16. 前端文案（不引入新功能）

`TeamLaunchPanel` 步骤 2 的 hint「每个成员位可预设 persona」补一句
「这是可选 CLI 池；实际参与人数由队长按任务数决定」，`TeamMemberPool` 的
说明同步。**不改** `selectedIds` / `allowedAgentIds` 的语义 —— 它们本来就是
「允许哪些 CLI」，不是「起几个进程」。

## 17. 第 2 轮遗留（本轮一并收口）

- `design.md §8` 的四行表与 PRD R2.1 措辞不一致（「只有 owner」的首行）：以 **§8 表**
  为准（`t1 · 指派 —` + `已认领 B`），把 PRD 措辞改一致 —— 空指派槽与「有人认领」是
  两个事实，不能都写「未指派」。
- `TeamFlowGraph.tsx` 第 2 轮落在 **298 行 / 红线 300**，把视口那段（wheel / pointer /
  useLayoutEffect / ref）抽成 `hooks/useFlowViewport.ts`，组件降到 ~200 行。
  行为零漂移，既有接线测试原样复用。
