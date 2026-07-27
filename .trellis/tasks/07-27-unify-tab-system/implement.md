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

## 阶段 2：TabBar / TabItem 泛型化（R1）

**目标**：`TabBar`/`TabItem` 接收 `{ id, title }` 形状，支持 dock panel 复用，保持 editor 向后兼容。

- [ ] `src/shared/types/tab.ts`：新增 `TabLike` 约束类型（`{ id: string; title: string }`）。
- [ ] `TabBar.tsx`：泛型化 `<T extends TabLike>`，`tabs: readonly T[]`，新增可选 `renderTabContent?: (tab: T) => React.ReactNode`。现有 editor 图标逻辑提取到 editor adapter 的 `renderTabContent`。
- [ ] `TabItem.tsx`：同步泛型化，`useSortable({ id: tab.id })` 不变。
- [ ] `EditorGroupPane.tsx`：调用方适配--传入 `renderTabContent` 渲染 agent 图标 / 文件图标 / 状态点（从 TabItem 内部逻辑迁出）。
- [ ] 验证：`pnpm type-check` + `pnpm test:run`（TabItem.test.tsx 适配泛型）。
- [ ] commit：`refactor(editor): genericize TabBar/TabItem for reuse`

**回滚点**：泛型化对 editor 调用方向后兼容，revert 后 editor 恢复原状。

**审查门**：泛型化后 editor tab 视觉与交互无回归（手动 `pnpm tauri dev` 看 agent 图标、状态点、pinned 标记）。

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

## 阶段 4：dockStore 新增同 zone 排序（R3 准备）

**目标**：为 DockZoneTabs 迁移提供排序 action。

- [ ] `src/shared/store/dockStore.ts`：新增 `reorderPanelsInZone(zoneId, activeId, overId)`，结构对齐 `editorStore.reorderTab`。
- [ ] `dockStore` 类型接口补充该方法签名。
- [ ] 验证：`pnpm type-check`。
- [ ] commit：`feat(dock): add reorderPanelsInZone action`

---

## 阶段 5：DockZoneTabs 迁移 @dnd-kit + 接入 TabBar（R1 + R3）

**目标**：移除 HTML5 drag，用 @dnd-kit 同 zone 排序，复用 `TabBar`。

- [ ] `src/layout/dock-layout/DockZoneTabs.tsx`：
  - 移除 `draggable` / `onDragStart` / `handleDragStart`。
  - 引入 `DndContext` + `SortableContext` + `useSensor(PointerSensor, { distance: 5 })`。
  - `TabsTrigger` 包 `useSortable({ id: panelId })`，合并 ref（`setNodeRef` + Radix forwardRef）。
  - `onDragEnd` 调 `reorderPanelsInZone(zoneId, activeId, overId)`。
  - 关闭按钮：复用 `TabBar` 的 `×`（含 pointer 隔离），或保留 ContextMenu Close。
- [ ] dock panel adapter：`zone.panels.map(id => ({ id, title: registry[id].title }))`，`renderTabContent` 渲染 panel 图标。
- [ ] 保留跨 zone `Move to {zone}` 右键菜单（`movePanel`）。
- [ ] 验证：`pnpm type-check` + `pnpm test:run` + 手动 `pnpm tauri dev`（panel 拖拽排序、关闭、跨 zone 移动）。
- [ ] commit：`refactor(dock): migrate DockZoneTabs to dnd-kit and reuse TabBar`

**审查门**：ref 合并正确（拖拽 transform 生效 + tab 切换 value 不丢）；HTML5 drag 残留 grep 确认清零。

**回滚点**：DockZoneTabs 整文件改动，revert 恢复 HTML5 drag（但 dockStore.reorderPanelsInZone 留为无害新增）。

---

## 阶段 6：全量回归 + 清理

- [ ] `pnpm lint` / `pnpm type-check` / `pnpm test:run` 全绿。
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`（确认无后端影响，预期无变化）。
- [ ] grep 确认：`draggable` / `onDragStart` 在 DockZoneTabs 已移除；`state.tabs` 全表扫描在 useTabManagement 已移除。
- [ ] 手动验证清单（`pnpm tauri dev`）：
  - editor tab 拖拽排序后点 `×` 关闭正确 tab（AC1）。
  - `×` 上轻微移动不触发拖拽（AC2）。
  - dock panel 同 zone 拖拽排序 + 关闭（AC4）。
  - dock panel 跨 zone Move（保留功能）。
  - pinned tab / split left-right / 未保存确认 / Cmd+W 路径无回归。
- [ ] 更新 spec：`interaction-patterns.md` 补「TabBar 泛型化 + pointer 隔离」模式；`DockZoneTabs` 从 HTML5 drag 条目移除。
- [ ] commit：`docs(spec): record unified TabBar pattern and dnd-kit migration`

---

## 风险与应对

| 风险 | 应对 |
|---|---|
| Radix `TabsTrigger` + dnd-kit ref 合并导致 tab 切换失效 | 阶段 5 审查门单独验证；必要时用 `useMergeRefs` |
| 泛型化后 editor 图标/状态点渲染回归 | 阶段 2 审查门手动验证；`renderTabContent` 迁出后单测覆盖 |
| Cmd+W 路径因 tabKey 收敛而关错 | 阶段 3 测试覆盖；`activeTabId` 在 tabKey 上下文内 |
| dock panel 关闭后激活回退到 `panels[0]`（已知债） | design.md 已记录，本次不改；确认不引入新 bug |

## 执行顺序依赖

阶段 1 独立，可先行。阶段 2 是阶段 5 的前置（TabBar 泛型化后 dock 才能复用）。阶段 3、4 相互独立，可并行。阶段 5 依赖 2+4。阶段 6 依赖全部。
