# 技术设计：统一 Tab 系统协议与交互

## 1. 设计目标

统一「操作协议 + UI 组件」，分离「数据模型 + 副作用」。三层划分：

```
统一层（本次做）：TabBar/TabItem 纯展示 + 泛型化 + props 契约 + renderContent 多态
分离层（保留）  ：editorStore（tabs+layout） / dockStore（zones+panels） 各自独立
不动层          ：PTY 回收 / 文件未保存确认 / pinned / split / 跨 zone movePanel
```

## 2. 现状基线（证据）

| 关注点 | 文件:行 | 现状 |
|---|---|---|
| 关闭按钮回调 | `TabItem.tsx:69-75` | `onClose(tab.id)`，闭包绑定 ✅ ID 正确 |
| dnd listeners 位置 | `TabItem.tsx:146` | `{...(reorderable ? listeners : {})}` 绑在根 div |
| 关闭按钮位置 | `TabItem.tsx:179-187` | `×` 是根 div 子元素，pointerdown 冒泡被 listeners 捕获 |
| PointerSensor 阈值 | `TabBar.tsx:96-99` | `activationConstraint: { distance: 5 }` |
| editor 关闭 | `editorStore.ts:312-343` | `filter(t=>t.id!==tabId)`，激活策略用 `groupIds.indexOf` |
| editor 排序 | `editorStore.ts:685-698` | `indexOf(tabId)`/`indexOf(overId)` splice ✅ |
| EditorGroupPane 关闭 | `EditorGroupPane.tsx:124-140` | 未保存确认 + `closeEditorTab(tabKey, tabId)` |
| useTabManagement 关闭 | `useTabManagement.ts:67-76` | **全表扫描** `state.tabs` 找 tabId |
| DockZoneTabs 拖拽 | `DockZoneTabs.tsx:96-99` | HTML5 `draggable` + `onDragStart`（违反 spec） |
| DockZoneTabs 关闭 | `DockZoneTabs.tsx:112` / `dockStore.ts:250-269` | `closePanel(panelId)` ✅ ID 正确 |
| DockZoneTabs 激活回退 | `DockZoneTabs.tsx:82` | `activePanelId ?? zone.panels[0]`（位置回退） |

**结论**：关闭链路在 ID 层面正确，拖拽排序不改变 id↔组件绑定。「关错」体感来自 pointer 劫持 + 激活回退跳转。

## 3. 核心设计

### 3.1 TabBar / TabItem 泛型化 + 纯展示

`TabBar` 当前接收 `tabs: Tab[]`（editor 专用 `Tab` 类型）。泛型化为 `<T extends { id: string; title: string }>`，让 dock panel 适配同一组件。

```tsx
// 统一 props 契约（纯展示，不读 store）
interface TabBarProps<T extends TabLike> {
  tabs: readonly T[];
  activeId: string | null;
  pinnedId?: string | null;
  reorderable?: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onReorder?: (activeId: string, overId: string) => void;
  renderTabContent?: (tab: T) => React.ReactNode;  // 图标/状态点等多态
  // 现有 agents / actionMenu / contextMenu 回调保留
}
```

- editor adapter：`tabs = layout.leftTabs`（`Tab[]` 已满足 `TabLike`），`renderTabContent` 复用现有图标逻辑。
- dock adapter：`tabs = zone.panels.map(id => ({ id, title: registry[id].title }))`，`renderTabContent` 渲染 panel 图标。

`TabItem` 同步泛型化，内部 `useSortable({ id: tab.id })` 不变。

### 3.2 pointer 隔离（修复 R2）

在 `×` 按钮上阻断 pointerdown 冒泡，让 dnd-kit PointerSensor 忽略关闭按钮：

```tsx
<button
  onPointerDown={(e) => e.stopPropagation()}  // ← 阻断 dnd-kit 捕获
  onClick={handleClose}
  title="Close tab"
>
  ×
</button>
```

这是 dnd-kit 官方推荐做法（activationConstraint 只控制何时开始拖拽，stopPropagation 控制何时不参与拖拽）。最小改动，不破坏整 tab 可拖拽手感。

备选方案（不采用）：把 listeners 从根 div 移到标题 span--改动大，影响整 tab 拖拽区域手感，且 pinned/图标区是否可拖拽需重新定义。本次选最小改动。

### 3.3 useTabManagement.handleCloseTab 收敛（R4）

```ts
// Before：全表扫描，无 tabKey 上下文
const handleCloseTab = useCallback((tabId: string) => {
  const state = useEditorStore.getState();
  for (const [projectId, pt] of Object.entries(state.tabs)) {
    if (pt.tabs.some((t) => t.id === tabId)) {
      closeEditorTab(projectId, tabId);
      return;
    }
  }
}, []);

// After：使用 tabKey（hook 已有）
const handleCloseTab = useCallback((tabId: string) => {
  if (!tabKey) return;
  closeEditorTab(tabKey, tabId);
}, [tabKey]);
```

`useTabManagement` 已持有 `tabKey`（`:30-33`），全表扫描是历史残留。收敛后消除「tabId 全局唯一」隐式契约。

**注意**：`useAppShell.ts:265` 的 Cmd+W 路径调用 `handleCloseTab(currentTabId)`，`currentTabId` 来自 `activeTabId`（全局）。收敛后该路径仍用 tabKey 关闭当前 tabKey 的 active tab，行为正确（activeTabId 在 tabKey 上下文内）。

### 3.4 DockZoneTabs 迁移 @dnd-kit（R3）

移除 HTML5 drag，用 @dnd-kit 包裹 shadcn `TabsList`：

```tsx
<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
  <SortableContext items={zone.panels} strategy={horizontalListSortingStrategy}>
    <TabsList>
      {zone.panels.map(panelId => (
        <SortablePanelTrigger key={panelId} panelId={panelId} ... />
      ))}
    </TabsList>
  </SortableContext>
</DndContext>
```

- `SortablePanelTrigger`：`TabsTrigger` 包 `useSortable({ id: panelId })`，合并 ref（`setNodeRef` + Radix trigger ref）。
- `handleDragEnd`：提取 `active.id`/`over.id`，调 `dockStore.reorderPanelsInZone(zoneId, activeId, overId)`。
- 跨 zone 拖拽：本次不做（Out of Scope），保留右键菜单 `Move to {zone}`。

**ref 合并风险**：Radix `TabsTrigger` 用 `forwardRef`，dnd-kit `setNodeRef` 需合并。用 `useMergeRefs` 或内联合并函数。验证点：拖拽时 transform 生效 + tab 切换 value 不丢。

### 3.5 dockStore 新增 reorderPanelsInZone

```ts
reorderPanelsInZone: (zoneId: string, activeId: string, overId: string) => {
  set((state) => {
    const zone = state.zones[zoneId];
    if (!zone) return state;
    const oldIndex = zone.panels.indexOf(activeId);
    const newIndex = zone.panels.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return state;
    const next = [...zone.panels];
    next.splice(oldIndex, 1);
    next.splice(newIndex, 0, activeId);
    return { zones: { ...state.zones, [zoneId]: { ...zone, panels: next } } };
  });
},
```

结构与 `editorStore.reorderTab`（`:685-698`）一致，基于 ID。

## 4. 数据模型不合并的权衡

`editorStore` 与 `dockStore` 合并的诱惑是「少一个 store」，但代价：

| 维度 | editor tabs | dock panels | 合并后果 |
|---|---|---|---|
| 关闭副作用 | 销毁 PTY / 释放句柄 / 未保存确认 | 仅隐藏视图 | `close` 需 if-else 区分销毁/隐藏 |
| 布局模型 | split left/right + pinned（单轴） | zone 网格（多区域） | 布局字段膨胀，条件分支泄漏 |
| 生命周期 | 频繁开闭，内容即用即销 | 启动注册，基本固定 | 生命周期字段冗余 |
| 内容多态 | `Tab.data.kind` 动态数据 | `registry[id].component` 静态注册 | 两套多态机制强行统一 |

合并会把「内容差异」从协议层泄漏到数据层，违反单一职责。VS Code 同样分开（`EditorGroup` vs `ViewDescriptorService`）。**结论：不合并**。

## 5. 兼容性

- `TabBar` / `TabItem` 泛型化后，editor 调用方签名向后兼容（`Tab[]` 满足 `TabLike`），无破坏性改动。
- `DockZoneTabs` 外部 API（`zoneId` prop）不变。
- `dockStore.reorderPanelsInZone` 为新增 action，不影响现有 `movePanel` / `closePanel`。
- `useTabManagement.handleCloseTab` 签名不变（`(tabId: string) => void`），调用方无感。

## 6. 回滚形态

- 每个阶段独立 commit，可单独 revert。
- 无数据迁移、无 schema 变更、无持久化格式变化--回滚即代码回退。
- worktree 分支 `refactor/unify-tab-system` 隔离，不影响 main。

## 7. 已知技术债（本次不处理）

- `editorStore.closeTab` 内激活策略（`:325-343`）读 `editorLayout` 决定激活相邻 tab，是 UX 策略下沉到数据 store。理想应上移到 `useEditorGroupLayout`。当前基于 ID 工作正常，上移改动面大，留作后续。
- `DockZoneTabs.tsx:82` 的 `activePanelId ?? zone.panels[0]` 位置回退，排序后关闭 active 会跳到首位。属激活策略，同上留作后续。
- 跨 group / 跨 zone 拖拽--需 DndContext 提升到容器之上，未来扩展。
