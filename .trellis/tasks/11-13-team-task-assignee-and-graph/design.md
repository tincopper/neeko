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
