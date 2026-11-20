# Implement — 侧栏团队行去按钮 + 看板 tab 记住视图

Red → Green → Refactor。

## 1. 删掉侧栏团队行的 Board 按钮（R1 / AC1）

- [ ] **Red** `src/features/agent-team/components/__tests__/UnitTeamEntries.test.tsx`：
      行内 `getAllByRole('button')` 长度为 **1**；`queryByText('Board')` 为 null；
      删除原有的「看板按钮 ⇒ onOpenBoard」用例（能力已不存在，不是行为变了）。
- [ ] **Green** `UnitTeamEntries.tsx`：删掉行尾那个 `<button>` 与 `onOpenBoard` prop；
      文件头「两个动作」段落改成「一个动作 + 为什么不再需要常驻按钮」。
- [ ] `useTeamEntryActions.ts`：删掉 `onOpenBoard`（含 `useTeamBoardTab` 依赖）；
      `UnitSessionList.tsx` 同步删掉透传；`useTeamEntryActions.test.ts` 删对应用例。
- [ ] 复核：`grep -rn "onOpenBoard" src | grep -v __tests__` 只剩 `TeamPanel` 那条**面板**通路
      （`TeamPanelWrapper` / `TeamTaskSection` / `useTeamCrossDomainCallbacks`），不得出现侧栏残留。

## 2. 视图写进 tab 数据（R2 / R3）

- [ ] **Red** `TeamBoardCenterView` 测试：点「Assignment graph」⇒ `onViewChange('flow')` 被调；
      渲染的视图只由 `view` prop 决定（不再有「prop 变了要同步 state」的分支）。
- [ ] **Green** `TeamBoardCenterView.tsx`：
      - 删 `useState<'board'|'flow'>(initialView)` 与同步 `useEffect`/`lastPropView`；
        `view` **只**来自 props；
      - 两个切换按钮改成 `onClick={() => onViewChange('board' | 'flow')}`；
      - props 增加 `onViewChange: (view: 'board' | 'flow') => void`（必填 —— 没有它就等于
        切换按钮是死按钮）。
- [ ] **Green** `PaneContent.tsx` 的 `team-board` 分支：
      `onViewChange={(view) => useEditorStore.getState().updateTab(tabSpaceKey, activeTab.id, { kind: 'team-board', view })}`
      （`mergeTabData` 已支持 `view` 合并，见 `shared/store/editorStore.ts:248-260`；
      用 `useCallback` 或模块级 helper，不要在 JSX 里造内联对象给 memo 组件）。
- [ ] **Red/Green** 断言**tab 数据**变化（不是组件 state）：render `PaneContent`（或直接驱动
      `updateTab`）→ `tabs[key].tabs[0].data.view === 'flow'`；再以该数据重新挂载 ⇒ 渲染 flow
      （AC3 的「切 tab 回来」等价形态）。

## 3. 重复打开不改视图（R4）

- [ ] **Red** `useTeamBoardTab` 测试：`openBoardTab({view:'board'})` 建 tab → 再
      `openBoardTab({view:'flow'})` ⇒ `data.view` 仍是 `'board'`，且 `updateTab` 零调用、
      `activateTab` 被调（AC4）。
- [ ] **Green** `useTeamBoardTab.ts`：删掉既存分支里的 `updateTab`；文件头把「重复打开会把
      view 合并进 tab data」那段改成新语义，并写明代价（面板选 flow 再打开不会改中央 tab 的视图，
      换视图用中央 tab 自己的头部）。
- [ ] 复核 `app/dock/wrappers/teamRenameTabs.ts` 不受影响（它只改 `teamName` / 标题）。

## 4. 验证

- [ ] `pnpm exec vitest run src/features/agent-team src/features/live-sessions src/features/editor src/app`
- [ ] `pnpm exec tsc --noEmit`
- [ ] `pnpm check:quick`（收尾一次）

## 5. 文档同步（Phase 3.3）

- [ ] `.trellis/spec/frontend/state-management.md`（若已有「导航态 vs 数据面」段落）或
      `component-guidelines.md`：补一条 —— **tab 的导航态（如看板 board/flow）存在 tab 数据里，
      不放组件 state**：`PaneContent` 只渲染激活 tab，组件 state 会在切 tab 时丢；写入经注入的
      `onViewChange`，由 adapter 落 `updateTab`。
- [ ] 顺手修 `useTeamBoardTab` 附近 spec/注释里「重复打开合并 view」的旧说法（只改指向，不复制正文）。

## 回滚点

- 三个改动互相独立：①侧栏删按钮（纯删除）；②视图持久化（组件 + PaneContent）；
  ③打开语义（一行 `updateTab`）。任一引起回归可单独 revert。
