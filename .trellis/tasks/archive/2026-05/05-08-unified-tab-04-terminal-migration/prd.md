# Phase 4/6: 终端 Tab 迁移到 Zustand Store

## 概述

将 useTerminalTabs 的终端 tab 管理从 React 本地 state 迁移到 Zustand 统一 store，保留 terminalCache 映射和 SplitLayout 分屏能力。

## 需求

### 功能需求
1. 重构 `src/hooks/useTerminalTabs.ts`：
   - 移除所有本地 state（useState/useRef/TabState）
   - `addTab` 调用 `store.addTab(kind: "terminal")`
   - `closeTab` 先调用 `destroyTerminalCachesByPrefix` 再调用 `store.closeTab`
   - `activateTab` 调用 `store.activateTab`
   - `updateTabStatus` 调用 `store.updateTab({ status })`
   - `setTabAgent` 调用 `store.updateTab({ agentId })`
   - 返回接口保持不变

2. 扩展 `src/store/appStore.ts`：
   - `updateTab` 支持 `title` 字段更新（在 Tab 层级，不在 data 中）

### 约束
- terminalCache key 格式不变：`{projectId}:{tabId}:{paneId}`
- SplitLayout 组件不变
- 10 tab 上限已在 store.addTab 中实现
- 向后兼容：useTerminalTabs 返回接口不变
- EditorContext 类型暂不改为 Tab[]（避免同时修改多个消费者）

## 验收标准

- [x] useTerminalTabs 使用 unified store
- [x] terminalCache 清理逻辑保持不变
- [x] 终端创建/关闭/切换功能正常
- [x] Agent 绑定功能正常
- [x] SplitLayout 分屏正常
- [x] pnpm type-check 通过
- [x] pnpm test:run 通过

## 实现笔记

- 写操作使用 `useAppStore.getState()` 避免 stale closure
- 读操作使用 reactive `useAppStore(selector)` 确保 re-render
- isTerminalTab 类型守卫 + tabToTerminalTab 转换器
- activeTabId 解析：优先项目级 activeTabId（如果是 terminal tab），否则 fallback 到第一个 terminal tab
- 测试中需要 beforeEach 清理 store tabs（Zustand 是单例）
