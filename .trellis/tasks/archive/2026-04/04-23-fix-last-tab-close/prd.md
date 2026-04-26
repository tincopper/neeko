# 修复最后一个 Terminal Tab 无法关闭

## Goal

当项目只剩一个 Terminal Tab 时，用户点击关闭按钮无任何响应。修复此问题，允许关闭最后一个 Tab 并显示已有的 ProjectGuidePage。

## 问题分析

### 根因

`src/hooks/useTerminalTabs.ts:138` 存在硬编码守卫:

```typescript
if (tabs.length === 0) return prev;
```

当 filter 后 tabs 为空数组时，直接 `return prev` 拒绝更新状态，关闭操作被静默吞掉。

### 附带问题: 缓存泄漏

第 132 行 `destroyTerminalCachesByPrefix` 在守卫逻辑**之前**执行。当最后一个 tab 关闭被拦截时，终端缓存已经被销毁，但 tab 仍然显示 -- 状态不一致。

### 已有基础设施

UI 层已为零 tab 状态做了完整准备:

- `MainContent.tsx:108` -- `showGuidePage = isTerminalView && tabs.length === 0 && !activeWorktreePath`
- `MainContent.tsx:270-277` -- `showGuidePage ? <ProjectGuidePage ... /> : <terminal layout>`
- `MainContent.tsx:146` -- `showGuidePage` 时隐藏 TerminalTabBar

只需移除 hook 层的守卫，UI 层的引导页即可自然接管。

## Requirements

1. 移除 `useTerminalTabs.ts:138` 的 `if (tabs.length === 0) return prev;` 守卫
2. 将 `destroyTerminalCachesByPrefix` 调用移入 `setTabState` 回调内部，确保仅在状态真正变更时清理缓存
3. 关闭最后一个 tab 后，UI 显示 ProjectGuidePage（已有逻辑，无需改动）
4. 从 ProjectGuidePage 重新打开终端或 Agent 应正常工作（已有逻辑，无需改动）

## Acceptance Criteria

- [ ] 只剩一个 Terminal Tab 时，点击关闭按钮可以正常关闭
- [ ] 关闭最后一个 Tab 后，TabBar 隐藏，显示 ProjectGuidePage
- [ ] 从 ProjectGuidePage 点击"打开终端"可正常创建新 Tab
- [ ] 从 ProjectGuidePage 点击 Agent 可正常创建新 Tab
- [ ] `destroyTerminalCachesByPrefix` 仅在 tab 真正被移除时调用，不会在关闭被拦截时提前清理
- [ ] Ctrl+W 快捷键关闭最后一个 Tab 同样生效

## Technical Notes

### 改动范围

仅涉及 `src/hooks/useTerminalTabs.ts` 的 `closeTab` 函数，预计改动 3-5 行。

### 对比: File Tab 行为

`useFileView.ts` 的 `closeTab` 允许 `newTabs.length === 0`，关闭最后一个后 `activeFileTabId` 设为 `null`，UI 显示空状态。修复后两种 tab 的关闭行为保持一致。

### 不需要改动的部分

- `MainContent.tsx` -- `showGuidePage` 判断和 `ProjectGuidePage` 渲染已存在
- `TerminalTabBar.tsx` -- 关闭按钮 UI 无需改动
- `useKeyboardShortcuts.ts` -- Ctrl+W 快捷键逻辑无需改动
- `useAppContainer.ts` -- `handleCloseTab` 包装层无需改动
