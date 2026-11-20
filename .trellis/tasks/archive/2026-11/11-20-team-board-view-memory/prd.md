# 侧栏团队行去按钮 + 看板 tab 记住视图

## Goal

用户提的三点，两点是同一个根因：

1. **侧栏团队行不该有 `Board` 文字按钮** —— 行本身已经是入口，多一个常驻按钮是噪声。
2. **团队看板中央 tab 一打开就是分配图（flow）** —— 应该落在看板列表（board）。
3. **切走再切回来，视图被重置** —— 我在 board 页，切到别的 tab 再回来就变成 flow 了。

2 与 3 是同一个缺陷：**tab 里的 board/flow 选择只活在组件 state 里**，而组件随 tab 切换
卸载。tab 数据里的 `view` 只在建 tab 那一刻写过一次，之后再没人更新。

## 现状（可指到文件的事实）

| # | 事实 | 位置 |
| --- | --- | --- |
| 1 | 侧栏团队行尾部有一个常驻 `Board` 文字按钮 | `src/features/agent-team/components/UnitTeamEntries.tsx`（行内第二个 `<button>`） |
| 2 | 中央 tab 的视图选择是**组件局部 state**：`useState(initialView)`，切换只 `setView(...)` | `src/features/agent-team/components/TeamBoardCenterView.tsx:64`、`:112`、`:127` |
| 3 | `PaneContent` 只渲染**当前激活**的那一个 tab（`switch (activeTab.data.kind)`）⇒ 切走即卸载 | `src/features/editor/components/PaneContent.tsx:51-96` |
| 4 | 所以切回来时组件重新挂载，`view` 回到 `activeTab.data.view` —— 那个值**只在建 tab 时写过** | 同上 + `useTeamBoardTab.ts:62` |
| 5 | 重复打开（面板「在中间打开」）会**覆盖** tab 里的 `view` | `useTeamBoardTab.ts:49-51` |
| 6 | 面板「在中间打开」传的是面板自己的 `taskView`（默认 `board`） | `TeamTaskSection.tsx:54`、`:117` |

第 4 条就是现象 3 的完整解释；第 5 条让「我上次在哪」在**每一次**再打开时也被抹掉，所以
只修第 4 条不够。

## Requirements

- **R1** 侧栏团队行**去掉** `Board` 文字按钮；行主按钮保留现有分派（有活队长 ⇒ 接管 PTY，
  否则 ⇒ 打开 Team 面板 —— 板在那里面，一条路，不新增第三种入口）。
- **R2** 中央 tab 的 board/flow 选择**写进 tab 数据**（`updateTab` + `mergeTabData` 的 `view`），
  不再由组件 state 持有：组件只渲染「tab 现在要的那个视图」。
- **R3** 切 tab 回来停在**上次的视图**（R2 的直接结果，必须有用例钉住）。
- **R4** 已存在的看板 tab **重复打开只激活，不改它的视图** —— 「打开」是「带我去那儿」，
  不是「重置我上次的选择」。建新 tab 时仍用调用方给的视图。
- **R5** 打开看板 tab 的**默认**视图是 `board`（现象 2）：面板「在中间打开」传它自己
  当前那个视图（保持现状）；但侧栏入口（已删除）与任何内部入口一律传 `board`。
  首次打开因此永远是看板列表。

## 明确不做

- 不改 `TeamBoardCenterView` 的看板 / 分配图内容本身。
- 不把视图选择放进 `teamStore`（那是数据面；视图是 tab 的**导航态**，与 `taskView` 同一类）。
- 不做「每个队记住上次视图」这类跨 tab 状态（tab 就是那个记忆体）。

## Acceptance Criteria

- [x] **AC1** 侧栏团队行只剩**一个**按钮；`Board` 文案消失；`onOpenBoard` 从 `UnitTeamEntries`
      的 props 与 `useTeamEntryActions` 中一并移除（不留死参数）。
- [x] **AC2** 中央 tab 里点「分配图」⇒ tab 数据 `view === 'flow'`；点回「看板」⇒ `'board'`
      （断言写的是 **tab 数据**，不是组件内部 state）。
- [x] **AC3** 卸载后重新挂载（模拟切 tab 离开再回来）⇒ 渲染的仍是上次选的视图。
- [x] **AC4** 已存在的看板 tab 上再调 `openBoardTab({ view: 'flow' })` ⇒ tab 数据仍是原值，
      只发生 `activateTab`（有用例断言 `updateTab` 零调用）。
- [x] **AC5** 新建看板 tab 时 `view` 取调用方传入值（侧栏/内部入口传 `board`）。
- [x] **AC6** `pnpm check:quick` 通过；`pnpm exec vitest run src/features/agent-team src/features/live-sessions src/features/editor src/app` 全绿。

## Notes

- 红线自查：12（不新增路径/身份判据）· 17（视图选择只有一份真相：tab 数据；组件不再持有副本）。
- 相关（已归档）：`11-17-sidebar-lead-session`（团队行来源）、`11-18-sidebar-project-switch`（点击切项目）。

## 实施记录

三点全部落地，无计划外偏差。两处值得记下的判断：

1. **`onViewChange` 是必填 prop**，不是可选。可选等于允许「静默不切换」——那正是本任务在修的症状
   形态（一个看起来能点、实际什么都没做的 UI）。
2. **「打开」语义的取舍已写进代码注释**：面板的 board/flow 切换不再推送到已存在的中央 tab。
   代价是「面板停在 flow 时点『在中间打开』，中央仍是他上次选的视图」。要换视图用中央 tab 自己的
   头部按钮（那里一直是该 tab 视图的唯一入口）。反过来把「打开」当「推送视图」会让记忆在第二次
   点击时照样失效。

一个可能需要下一轮决定的小事（本次**未做**）：若「打开看板 tab 永远先落 board 列表」是硬要求
（而不是「跟随面板当前视图」），把 `TeamTaskSection` 的「在中间打开」固定传 `board` 即可，一行。
