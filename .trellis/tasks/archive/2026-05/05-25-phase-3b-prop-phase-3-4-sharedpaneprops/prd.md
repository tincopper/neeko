# Phase 3B: Prop 塌缩 Phase 3-4（消除 sharedPaneProps）

## Goal

`EditorGroupPane` Props 从 13 → ~6，删除 `sharedPaneProps` 中间对象。
EditorGroupLayout 直接透传 instance 级别 props。

## What I already know

### 当前 EditorGroupPane Props（13 个）

| # | Prop | 来源 | 可消除? |
|---|---|---|---|
| 1 | groupId | Layout 透传 | ❌ instance 差异 |
| 2 | tabKey | Layout 透传 | ❌ instance 差异 |
| 3 | onAddTerminalTab | sharedPaneProps | ✅ → 移入 EditorGroupPane/useTerminalTabs |
| 4 | onSplitRight | sharedPaneProps | ✅ → useEditorGroupLayout(tabKey) 直接读取 |
| 5 | onMoveToRight | sharedPaneProps | ✅ → 同上 |
| 6 | onMoveToLeft | sharedPaneProps | ✅ → 同上 |
| 7 | onFocusGroup | Layout 透传 | ❌ instance 差异 |
| 8 | onCloseOtherTabs | sharedPaneProps | ✅ → useEditorGroupLayout(tabKey) 直接读取 |
| 9 | onCloseAllTabs | sharedPaneProps | ✅ → 同上 |
| 10 | wslProject | sharedPaneProps | ✅ → useWslContext() 直接读取 |
| 11 | remoteProject | sharedPaneProps | ⚠️ 复杂，推迟 |
| 12 | layoutId | Layout 透传 | ❌ instance 差异 |
| 13 | contextMenuExtras | sharedPaneProps | ✅ → useEditorGroupLayout(tabKey) 或保留 |

### sharedPaneProps 当前 10 个字段

```ts
{ tabKey, onAddTerminalTab, wslProject, remoteProject,
  onSplitRight, onMoveToRight, onMoveToLeft,
  onCloseOtherTabs, onCloseAllTabs, contextMenuExtras }
```

### 保留的 instance props（~5 个）

`groupId`, `tabKey`, `layoutId`, `onFocusGroup`：每个 pane 实例不同。

## Requirements

1. `onSplitRight` / `onMoveToRight` / `onMoveToLeft`：EditorGroupPane 内部调用 `useEditorGroupLayout(tabKey)` 直接获取
2. `onCloseOtherTabs` / `onCloseAllTabs`：EditorGroupPane 内部从 store 直接操作 tab 关闭
3. `wslProject`：EditorGroupPane 内部调用 `useWslContext().activeWslProject` 直接读取
4. `contextMenuExtras`：EditorGroupPane 内部调用 `useEditorGroupLayout(tabKey)` 获取 pin/unpin 逻辑（或保留 prop）
5. 删除 `sharedPaneProps` 对象，EditorGroupLayout 每个 pane 直传 instance props
6. 更新 EditorGroupLayoutProps、MainContent 中对应传递

## Acceptance Criteria

- [ ] `npx tsc --noEmit` 零 error
- [ ] `pnpm test:run` 全部通过
- [ ] EditorGroupPaneProps 从 13 → ~8 个
- [ ] `sharedPaneProps` 对象删除
- [ ] EditorGroupLayoutProps 同步精简

## Out of Scope

- EditorProvider overlay 不删（per-pane tab 隔离需要）
- `remoteProject` prop 不在此 Phase 处理（需 store/context 调整）
- `onAddTerminalTab` prop 保留（需共享 useTerminalTabs 重构）

## Technical Approach

依赖注入 + Context 直读模式（与 Phase 2A 相同）：

```ts
// Before: 通过 sharedPaneProps 透传
<EditorGroupPane {...sharedPaneProps} groupId="left" ... />

// After: 直接传 instance props
<EditorGroupPane
  tabKey={tabKey}
  groupId="left"
  layoutId={leftLayoutId}
  onFocusGroup={() => setActiveGroup("left")}
  contextMenuExtras={normalContextMenuExtras}
/>
```

EditorGroupPane 内部：
```ts
const { splitRight, moveToRight, moveToLeft, closeOtherTabs, closeAllTabs } = useEditorGroupLayout(tabKey);
const { activeWslProject } = useWslContext();
```

## Implementation Plan

| Step | 操作 | 文件 |
|---|---|---|
| 1 | EditorGroupPane 内部调用 useEditorGroupLayout(tabKey) 获取 split/move/close | EditorGroupPane.tsx |
| 2 | EditorGroupPane 内部调用 useWslContext() 获取 wslProject | EditorGroupPane.tsx |
| 3 | 从 PaneProps 删除 onSplitRight/onMoveToRight/onMoveToLeft/onCloseOtherTabs/onCloseAllTabs/wslProject | EditorGroupPane.tsx |
| 4 | 删除 sharedPaneProps，EditorGroupLayout 每个 pane 直传 | EditorGroupLayout.tsx |
| 5 | 精简 EditorGroupLayoutProps | EditorGroupLayout.tsx + MainContent.tsx |
| 6 | 验证 | tsc + test |
