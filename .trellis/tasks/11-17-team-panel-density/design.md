# 设计：团队面板密度优化（A + B）

## 0. 裁决（2026-11-17，用户确认「按建议推进」）

| # | 问题 | 裁决 | 依据 |
| --- | --- | --- | --- |
| D1 | 本轮范围 | **A + B**（R1–R12；R11 不做） | 原型实测 −42%，C 档会改 `prototype-agent-team.html` 视图①与 AC11，需另开裁决 |
| D2 | C 档行内形态 | **a**：行内 `⚠ C` 小徽标 + 分区固定说明 | D2-b（整枚 chip）在 280px 把名字挤成 `researc…`（原型实拍） |
| D3 | 任务板默认 | **展开** | 折叠是用户主动动作，不做默认隐藏 |
| D4 | 列表页同批 | **否** | 另开任务 |

原型：`.trellis/tasks/11-17-team-panel-density/prototype-team-panel-density.html`（视觉契约以它为准）。

## 1. 变更边界

只改 `src/features/agent-team/**` + 相关测试 + 两份 spec。后端命令与载荷**零改动**
（`team_snapshot` / `team_list` 形状不动）。

| 文件 | 动作 | 对应需求 |
| --- | --- | --- |
| `components/TeamHeader.tsx` | 重写为「1 行 + 1 行 meta」 | R1 / R2 |
| `components/TeamHeaderMenu.tsx` | **新增**（`⋯` 菜单） | R1 |
| `components/TeamRoster.tsx` | 去掉标题右侧人数 | R4 |
| `components/RosterRow.tsx` | 单行化 + 租约条件渲染 | R3 / R8 / R9 |
| `components/TeamView.tsx` | 任务区头（标题 + 计数 + 视图切换 + 折叠） | R10 |
| `components/TeamTaskBoard.tsx` | 扁平分组 + 空列汇总 + 去内部标题 | R5 / R12 |
| `components/TaskCardRow.tsx` | 状态 chip 条件化 + 去掉 id/依赖/缺省 workspace + 租约并入 meta + owner 关注态 | R6 / R7 |
| `components/TeamBoardCenterView.tsx` | 头部补任务计数（板内部标题移除后） | R12 副作用 |
| `utils/memberChips.ts` | 新增 `memberRowMeta()`；`memberChips` 文档改口径（抽屉而非行内） | R8 / R9 |
| `utils/workspaceLabel.ts` | 新增 `nonDefaultWorkspaceLabel()`（缺省值不渲染这一条规则的单点） | R7 / R8 |
| `.trellis/spec/frontend/component-guidelines.md` | 记录面板密度契约 | — |
| `.trellis/spec/backend/team-domain.md` | 同步「面板 UI 契约」段落（C 档可见性的新形态） | — |

## 2. 契约映射（需求 → 落点 → 判据）

| 需求 | 落点 | 判据（测试钉子） |
| --- | --- | --- |
| R1 头部 1 行 + `⋯` 菜单 | `TeamHeader` / `TeamHeaderMenu` | 菜单项 `改名` / `刷新快照` / `恢复团队` / `关闭团队…` 只在能力成立时出现；点击走**同一批**回调 prop（不新状态） |
| R2 一行 meta | `TeamHeader` | `N 成员` + `M 待批`（仅 >0）+ 项目根末段 + `sealed` 时补「只读快照」 |
| R3 无租约不渲染 | `RosterRow` | `leaseRemainingSecs === null` ⇒ 行内**没有**任何租约文字 |
| R4 去重复人数 | `TeamRoster` | 花名册标题旁没有 `N 人` 文本 |
| R5 空列折叠 | `TeamTaskBoard` | 空列不进 `role="group"`，进汇总行；汇总项仍带 `data-column` + `data-count=0` |
| R6 状态 chip 条件化 | `TeamTaskBoard` → `TaskCardRow(showState)` | 列的唯一种类时卡片无状态 chip；`claimed`/`in_progress` 同列时 `claimed` 带 `已认领` |
| R7 卡片去噪 | `TaskCardRow` | 卡片无可见 `t1` id、无 `依赖 N`、`shared` 不出 chip、`worktree …` 仍出 |
| R8 花名册单行 | `RosterRow` | 名字 / 队长 / `⚠ C` / 六态徽标 / 打开会话；agent·persona·通道·档位只在抽屉 |
| R9 C 档可见性 | `RosterRow` + `TeamRoster` | 行内 `⚠ C` 可见 + `role="note"` 说明常显（`hasSentinelOnly` 时） |
| R10 任务板折叠 | `TeamView` | 默认展开；折叠后只剩一行摘要 + 展开按钮；`aria-expanded` 正确 |
| R12 扁平分组 | `TeamTaskBoard` | 分组不再是边框盒子；`data-column` / `role="group"` / 计数不变 |

## 3. 设计细节

### 3.1 `TeamHeader`（重写）

```
[←]  队名（双击改名）           [状态徽标] [⋯]
4 成员 · 1 待批 · feat-team
```

- `←` 是图标按钮，`aria-label="返回列表"`（保留旧可访问名：`TeamPanel.teamList` 的测试与用户习惯都靠它）。
- meta 行 `text-micro text-text-muted`，`flex-wrap`，项之间用 `·` 分隔：
  - `memberCountOf(snapshot)`（后端口径，不含队长）
  - `awaitingApprovalCount(...) > 0` 才出现，保留 `data-awaiting` 属性（既有测试钩子）
  - `projectRootTail(projectPath)`，完整路径进 `title`
  - `state === 'sealed'` 追加 `只读快照（不随重启恢复）`（原第 3 行的那句话不能只进 title）
- 改名编辑态与双击入口照旧（`InlineRenameInput` + `renameDraftCommit`）。
  `⋯` 菜单里的「改名」调同一个 `handleStartRename`。
- **不新增状态**：`closing` / `resuming` / `onResumeTeam` / `onRenameTeam` / `onRequestClose` / `onRefresh`
  全部来自 props（`TeamView` → `TeamPanel` 的既有接线）。

### 3.2 `TeamHeaderMenu`（新文件）

用 `@/ui/DropdownMenu`（Radix，已有 `SessionRowMenu` 先例，Esc / 外部点击 / 焦点归还都由 Radix 保证）。

| 项 | 出现条件 | 动作 | 置灰 |
| --- | --- | --- | --- |
| 改名 | `onRenameTeam !== undefined` | `onRenameTeam()` → `TeamHeader` 的 `handleStartRename` | — |
| 刷新快照 | 恒有 | `onRefresh` | — |
| 恢复团队 | `state === 'open' && resumable && onResumeTeam !== undefined` | `onResumeTeam` | `resuming` |
| 关闭团队… | `state !== 'sealed'` | `onRequestClose` | `closing` |

- 触发按钮：`aria-label={`团队操作：${teamName}`}`，图标 `MoreHorizontal`。
- 关闭项单独着色 + 与上面三项之间一条分隔线（破坏性动作不混在中间）。
- **不新增动作**：不直接调 API，不持有 hook；菜单只转发回调（AC5）。

### 3.3 `utils/memberChips.ts`

```ts
export interface MemberRowMeta {
  /** 非缺省工作区（shared → null）：行内只摆末段，缺省值不渲染。 */
  workspace: string | null;
  /** 红线 14 的 UI 侧：C 档在行内必须有一处**可见文字**警示。 */
  sentinelOnly: boolean;
}
export function memberRowMeta(member: Pick<MemberStatusView, 'workspace' | 'tier'>): MemberRowMeta;
```

- `sentinelOnly` 的文案由组件渲染为 `⚠ C`（`title` 带完整句），**分区说明**（`TeamRoster` 的
  `role="note"`）承载「sentinel only：完成能报，卡住永远不可知」。两者缺一即违规。
- `memberChips()` 保留，用途改为**成员详情抽屉**的身份/能力 chip 排（`MemberDetailDrawer` 原样使用）；
  文档里把「花名册那排 chip」改成「抽屉的身份 chip，行内只留 `memberRowMeta`」。

### 3.4 `RosterRow`

```
┌───────────────────────────────────────────────────┐
│ [头像] researcher 研究员 ⚠ C            运行中  [>_] │
│        租约 27:14                                  │
└───────────────────────────────────────────────────┘
```

- **2026-11-17 复评（R13/R14/R15）**：行外壳回到卡片（`rounded-md border bg-bg-primary`，
  队长行 `border-accent-blue/45`），`persona` 以可见 chip 回到行内，动作改图标按钮。
- 动作图标：`live → Terminal` / `resume → Play` / `archive → History`；`aria-label` 仍是
  `${action.label}：${name}`，`title` 是 `action.label`；置灰态图标变灰，`action.reason`
  仍是按钮左侧的可见文字（`暂无会话` / `已关闭`）。

- 主体仍是 `<button>`（点行开抽屉），右列是动作按钮（不许嵌套）。
- 第二行 = `memberRowMeta().workspace` 与 `leaseText(...)`（`null` 时**省略**，R3）用 ` · ` 连接；
  两者都为空时整行不渲染第二行。
- `workspace` 只有末段（`title` 放完整 `workspaceLabel`）。
- 租约 `urgent` 时 `text-accent-yellow font-semibold`（与卡片同一份 `leaseText`）。
- 动作按钮是**图标**（R15）：`Terminal` / `Play` / `History`；五态文案进 `aria-label` / `title`，
  `action.reason` 仍是可见文字（放在图标左侧，`text-micro`）。
- 徽标、抽屉、动作判据全部沿用现有纯函数，不重算。

### 3.5 `TeamView`（任务区头 + 折叠）

```
任务 4                        [▦|⑂] [↗] [▾]
```

- 看板 / 分配图是**图标按钮**（`Columns3` / `GitBranch`，`aria-pressed` + `aria-label`），
  与中央 tab 的 `TeamBoardCenterView` 用同一对图标（窄列里省掉两个词）。

- 标题与计数：`tasks.length`。
- 视图切换与「在中间打开」沿用现有回调（`onOpenBoard(taskView)`）。
- 折叠：局部 `useState(boardCollapsed)`（导航态，与 `taskView` 同族，不进 store），默认 `false`。
  - 折叠后渲染一行：`4 个任务 · 进行中 2 · 待批准 1`（`buildTaskBoard` 派生的非空列）。
  - `aria-expanded` + `aria-label`（`收起任务板` / `展开任务板`）。
- `TeamTaskBoard` 不再渲染自己的标题行（计数与标题在这条头上；中央 tab 由
  `TeamBoardCenterView` 自己的头部显示计数）。

### 3.6 `TeamTaskBoard`

- 分组扁平化：`role="group"` 容器去掉 `border` / `bg` / `p-1`，只留「标题行 + 卡片列表」。
  `data-column` 与 `aria-label` 不变（机器标识不随样式变）。
- 空列：不进 `role="group"`，收进末尾一行汇总：
  `<span data-column={id} data-count={0}>{label} 0</span>`（保留机器钩子，计数不变量仍可测）。
- `unplaced` 报警原样保留（`role="alert"`）。
- 截断提示原样保留（`role="status"`，`只显示前 {MAX_BOARD_TASKS} 条`）。
- 内部标题行删除；`aria-label="共享任务板"` 保留（测试按 region 定位）。

### 3.7 `TaskCardRow`

新增 prop `showState: boolean`（由 `TeamTaskBoard` 按列算：`column.states.length > 1` 才为 `true`）。

- 状态 chip：`showState` 时才渲染。
- workspace：`nonDefaultWorkspaceLabel(task.workspace)`（`shared` → `null`）。
- 删除：可见 `task.id`、`依赖 N`。`id` 仍在 `aria-label` / `data-task-id`（可访问性与测试钩子，不是 hover-only 信息）。
- 租约并入 chip 行（不再单起一行）。
- owner 状态（AC2 / design §6 硬规则 1）：
  - 只在**未终结**任务（非 `done`/`failed`/`blocked`）且 owner 处于
    `idle+unverified` / `stalled` / `offline` / `failed` 时，单独一行显示 `空闲 ⚠ 未声明` 等。
  - 其余情况不重复花名册已有的状态（`运行中` / `待批准` 在行上已经说过）。
- 重试按钮、`被回收 N 次`、`摘要已截断`、`已指派 · name` 保持不变。

## 4. 不变量（不许被这次改动碰掉）

1. `COLUMN_OF` / `TASK_COLUMN_ORDER` 一字不动；`unplaced` 报警仍在。
2. `tasksTruncated` 的提示仍可见。
3. 打开会话五态的**文案**与「理由可见文字」不变（只改排版）。
4. 抽屉仍是 `role="dialog"` + `useDrawerFocus`（本次只改行，不改抽屉）。
5. `空闲 ⚠ 未声明` / `空闲 ✓ 已声明` 的文案与 tone 不同（`memberBadge` 不动）。
6. C 档：行内 `⚠ C` **且** 分区说明常显（两者缺一不可）。

## 5. 测试策略

| 测试文件 | 改法 |
| --- | --- |
| `utils/__tests__/memberChips.test.ts` | 保留既有 5 条 chip 判据；新增 `memberRowMeta`：C 档 `sentinelOnly`、`shared → null`、worktree 末段 |
| `utils/__tests__/workspaceLabel.test.ts`（若无则新建） | `nonDefaultWorkspaceLabel`：`shared → null`，`read_only → 只读`，worktree 末段 |
| `components/__tests__/TeamHeader.rename.test.tsx` | 入口改为先开菜单（`pointerDown` 触发器 → `menuitem` 改名）；双击入口不变 |
| `components/__tests__/TeamPanel.roster.test.tsx` | 列计数改查 `[data-column][data-count]`（含汇总行）；chip 断言改为「行内没有 agent/通道/档位」；`无在飞任务` 断言改为「不渲染」；C 档改为 `⚠ C` + note；头部按钮（恢复团队/关闭团队/改名）先开菜单；新增「单行化后六态/租约三态仍在」 |
| `components/__tests__/TeamPanel.test.tsx` | `依赖 2` 改为断言不存在；`无在飞任务` 改断言不存在；其余列断言保持 |
| `components/__tests__/TeamPanel.teamList.test.tsx` | 团队视图内的 `关闭团队` 改为先开菜单取 `menuitem`；`返回列表` 不变（aria-label） |
| `components/__tests__/TaskCardRow.test.tsx` | 新增必填 `showState`；补「shared 不渲染 workspace」「id 不可见」「依赖不渲染」 |
| `components/__tests__/TeamTaskBoard.emptyColumns.test.tsx`（新） | 空列汇总行带 `data-column`/`data-count`；`unplaced` 仍报警；截断提示仍在 |
| `components/__tests__/TeamView.boardCollapse.test.tsx`（新） | 默认展开；折叠后只剩摘要行；`aria-expanded` 切换 |

原则：**只按新契约改写断言，不删用例**。任何「因为实现难测所以删掉」都要在 implement.md 里写明理由。

## 6. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| Radix 菜单在 jsdom 下需要 `pointerDown` 触发 | 照 `SessionRowMenu.test.tsx` 的既有写法 |
| 单行化后 260px 下名字被徽标挤没 | 名字 `flex-1 min-w-0 truncate`；徽标与按钮 `shrink-0`；`⚠ C` 只有 C 档才占位 |
| 扁平分组让中央 tab 的看板失去层次 | 中央 tab 的看板保持五列分组的语义（label + count），只是去掉外框；如视觉不佳可只对 dock 传 `flat`，属后续微调 |
| 关闭/改名入口移位后用户找不到 | 菜单触发按钮带 `aria-label`，`⋯` 在头部最右（与 `SessionRowMenu` 同一交互记忆） |

回滚：全部改动集中在一个域内、无后端改动，`git revert` 单个提交即可；菜单是独立文件，
必要时删文件 + 恢复 `TeamHeader` 三行版即可回到 A 档之前的形态。
