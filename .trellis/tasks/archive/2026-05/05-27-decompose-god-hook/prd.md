# Refactor: Decompose useAppContainer God Hook

## Goal

从 655 行的 `useAppContainer.ts` 中提取独立 hook，降低认知负荷，提高可测试性。

## Plan

### A) `useTabManagement` (~70 lines)
- `tabKey` composite key 推导
- `tabs`, `activeTabId`
- `handleAddTab`, `handleCloseTab`, `handleActivateTab`, `handleToggleTerminal`, `handleTabStatusChange`
- ensureDefaultTab effect

### B) `useAgentClickHandler` (~30 lines)
- `handleAgentClick` — 3 路 dispatch (Local/WSL/Remote × newTab/existingTab)

### Constraints
- 不修改现有 consumer 的接口
- 保持 `useAppContainer` 的返回值类型不变
- 质量门全绿

## Out of Scope
- Props 组装（projectActionsValue 等纯数据搬砖）
- Modal handlers（handleWslEntryAddRefresh 等）
- Store sync effects（两行 useEffect 不值得提取）
