# 执行计划：统一 Tab 系统协议与交互

## 验证命令（每阶段结束运行）

```bash
pnpm lint
pnpm type-check
pnpm test:run
```

最终手动验证：`pnpm tauri dev`（在 worktree 目录运行）。

---

## 阶段 1：修复 pointer 劫持（R2，最小改动先行）

**目标**：`×` 按钮 pointerdown 不触发 dnd-kit 拖拽。

- [ ] `src/features/editor/components/TabItem.tsx`：关闭按钮 `×` 增加 `onPointerDown={(e) => e.stopPropagation()}`。
- [ ] `src/features/editor/components/__tests__/TabItem.test.tsx`：补测试--`×` 上 pointerdown 不触发 sortable drag（断言 `onClose` 被调用、`onReorder` 未被调用）。
- [ ] 验证：`pnpm test:run`。
- [ ] commit：`fix(editor): isolate close button pointer from dnd-kit drag`

**回滚点**：单文件改动，revert 即可。

---

## 阶段 2：TabItem 泛型化 + editor leading 抽取（R1）

**目标**：`TabItem` 泛型化为纯展示组件，editor 图标逻辑外移到 `TabItemLeading.tsx`；`TabBar` 保持 editor 专用，通过 `renderTabLeading` 转发。dock 阶段直接复用 `TabItem`。

- [x] `src/shared/types/tab.ts`：新增 `TabLike` 约束类型。
- [x] `TabItem.tsx`：泛型化 `<T extends TabLike>`，移除 editor 图标逻辑，新增 `renderLeading`；`Pin` 通用渲染保留。
- [x] `TabItemLeading.tsx`（新建）：`renderEditorTabLeading(tab, agents)` 迁出 agent/file 图标 + statusDot + dirtyDot。
- [x] `TabBar.tsx`：新增 `renderTabLeading` prop 转发，移除传给 TabItem 的 `agents`（agents 仍用于 AgentBar）。
- [x] `EditorGroupPane.tsx`：定义 `renderTabLeading`（useCallback，依赖 installedEnabledAgents）传入 TabBar。
- [x] 验证：`pnpm type-check` + 全量 `pnpm test:run`（87 files / 793 passed）。
- [x] commit：`refactor(editor): genericize TabItem and extract editor leading renderer`

**回滚点**：泛型化对 editor 向后兼容（Tab extends TabLike），revert 恢复。

**审查门**：editor tab 视觉无回归（agent 图标 / 状态点 / pinned 由 renderEditorTabLeading + TabItem 通用 Pin 保证）；测试覆盖 agent-icon 与 close。

---

## 阶段 3：useTabManagement 关闭逻辑收敛（R4）

**目标**：删除全表扫描，用 tabKey 上下文。

- [ ] `src/features/editor/hooks/useTabManagement.ts`：`handleCloseTab` 改为 `closeEditorTab(tabKey, tabId)`，依赖 `[tabKey]`。
- [ ] 确认 `useAppShell.ts` Cmd+W 路径（`:265`）行为不变：`handleCloseTab(currentTabId)` 在 tabKey 上下文内关闭 active tab。
- [ ] `src/features/editor/hooks/__tests__/`：补测试--`handleCloseTab` 只调用 `closeEditorTab(tabKey, tabId)`，不遍历其他 tabKey。
- [ ] 验证：`pnpm test:run`。
- [ ] commit：`refactor(editor): scope handleCloseTab to tabKey context`

**回滚点**：单 hook 改动。

---

## 阶段 4：dockStore 同 zone 排序（已收回）

**目标**：原计划为 DockZoneTabs 迁移提供排序 action。

- [x] ~~`dockStore` 新增 `reorderPanelsInZone`~~（commit `93a84d6a`）。
- [x] 阶段 5 调查发现 `DockZoneTabs` 是死代码、dock 无 tab 排序需求，`reorderPanelsInZone` 无消费者，**已收回删除**。

---

## 阶段 5：清理 dock 死代码（范围调整）

**背景**：调查发现 dock 是 islands 模式（`DockZone` + `DockBar` 图标切换），无 tab 头、无 tab 排序。`DockZoneTabs`（shadcn Tabs + HTML5 drag）是死代码（无组件 import）；`useDragToReDock`（drop target）因无 draggable source（DockZoneTabs 死）整体失效，`isDragOver` 恒 false。原"迁移 DockZoneTabs 到 @dnd-kit"前提不成立。

**目标**：删除 dock 死代码，收回无消费者 action。

- [x] 删除 `DockZoneTabs.tsx`（死代码，唯一 `neeko-panel-id` drag source）。
- [x] 删除 `useDragToReDock.ts`（无 source，drop 永不触发）。
- [x] `DockZone.tsx`：移除 `useDragToReDock` import + `dragHandlers` + `isDragOver` 高亮，empty/collapsed 改 `return null`。
- [x] `index.ts`：移除 `DockZoneTabs` / `useDragToReDock` export。
- [x] `dockStore.ts`：收回 `reorderPanelsInZone`（接口 + 实现，无消费者）。
- [x] 验证：`pnpm type-check` + 全量 `pnpm test:run`（88 files / 794 passed）+ grep 残留零。
- [x] commit：`refactor(dock): remove dead DockZoneTabs and drag-to-re-dock code`

**结果**：editor tab 是唯一真正的 tab 系统，阶段 1-3 已完成统一与修复。dock 保留 islands 模式 + `movePanel`（右键/编程式跨 zone 移动）。

---

## 阶段 6：全量回归 + 清理

- [ ] `pnpm lint`（cargo fmt+clippy）/ `pnpm type-check` / `pnpm test:run` 全绿。
- [ ] grep 确认：`DockZoneTabs` / `useDragToReDock` / `reorderPanelsInZone` / `neeko-panel-id` 零残留；`state.tabs` 全表扫描在 useTabManagement 已移除。
- [ ] 手动验证清单（`pnpm tauri dev`）：
  - editor tab 拖拽排序后点 `×` 关闭正确 tab（AC1）。
  - `×` 上轻微移动不触发拖拽（AC2）。
  - editor 经泛型 `TabItem` 渲染（AC3）；dock 已无 tab 头，不适用。
  - dock panel 切换（DockBar 图标）+ `movePanel` 跨 zone 无回归（AC4 调整：dock 无 tab 排序）。
  - pinned tab / split left-right / 未保存确认 / Cmd+W 路径无回归。
- [ ] 更新 spec：`interaction-patterns.md` 补「TabItem 泛型化 + pointer 隔离」模式；移除 DockZoneTabs HTML5 drag 条目（已删）。
- [ ] commit：`docs(spec): record TabItem generic pattern and dock dead-code removal`

---

## 风险与应对

| 风险 | 应对 |
|---|---|
| 泛型化后 editor 图标/状态点渲染回归 | 阶段 2 测试覆盖 agent-icon + close；type-check 全绿 |
| Cmd+W 路径因 tabKey 收敛而关错 | 阶段 3 测试覆盖；`activeTabId` 在 tabKey 上下文内 |
| DockZone 移除 dragHandlers 后视觉变化 | `isDragOver` 恒 false，高亮本就不显示；empty 改 null 视觉同空白 |
| dock panel 关闭后激活回退（已知债） | dock 用 `activePanelId ?? panels[0]`，属激活策略，本次不改 |

## 执行顺序

阶段 1 独立先行。阶段 2（TabItem 泛型化）独立。阶段 3（关闭收敛）独立。阶段 4（已收回）。阶段 5（dock 死代码清理）依赖阶段 4 的发现。阶段 6 依赖全部。
