# Phase 2A: Prop 塌缩 Phase 1-2

## Goal

消除 `EditorGroupPane` 的 Prop 缠绕，将可通过 Context/Store 获取的数据从 Props 接口中移除。Props 从 30+ → 5。

## Requirements

### Phase 1: 零风险（9 prop 移除）
1. EditorGroupPane 内部 `useEditorContext()` 获取 `agents`, `compactMode`, `showAgentBar`, `hiddenAgentIds`, `onAgentClick`
2. EditorGroupPane 内部 `useAppContext()` 获取 `config`, `showToast`
3. 删除 `tabKey` 和 `onToggleHiddenAgent` 死代码（未解构/使用）
4. 从 `EditorGroupPaneProps` 删除 9 项
5. 从 `EditorGroupLayoutProps` 删除 9 项
6. 从 `EditorGroupLayout` 的 `sharedPaneProps` 删除对应字段
7. 从 `MainContent.tsx` JSX 删除对应传递

### Phase 2: 低风险（8 prop 移除）
8. Pane 接收 `tabKey` prop（显式恢复，仅 hook 输入）
9. Pane 调用 `useEditorGroupLayout(tabKey)` 获取 `tabs`, `activeTabId`, `pinnedTabId`, `isFocused`
10. Pane 用 `useAppStore.getState()` 直接调用替代 `onActivateTab`, `onCloseTab`
11. 删除 `tabs`, `activeTabId`, `pinnedTabId`, `isFocused`, `onActivateTab`, `onCloseTab`, `onCloseOtherTabs`, `onCloseAllTabs`
12. 同步清理 EditorGroupLayoutProps / sharedPaneProps / MainContent

## Acceptance Criteria
- [ ] `npx tsc --noEmit` 零 error
- [ ] `pnpm test` 全通过
- [ ] Props 30+ → ~11
