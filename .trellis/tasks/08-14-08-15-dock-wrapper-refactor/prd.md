# Dock 面板 Wrapper 重构：按面板拆文件 + 逻辑下沉 + 激活门控 + Context 化

## Goal

`src/app/dock/DockPanelWrappers.tsx`（1353 行 / 9 组件）存在设计问题：巨型文件违反 SRP、死代码（GitCommitPanelWrapper / GitLogPanelWrapper）为"回滚"保留、6 个 lazy 指向同一模块导致代码分割失效、git 刷新/diff tab/键盘导航逻辑重复、keep-mounted 策略下挂载即取数（git log 5001 条 + stash list）造成无谓 IPC、Library 面板通过 window 全局函数桥接（隐式耦合）。本次重构：

1. 删除死代码（GitCommitPanelWrapper / GitLogPanelWrapper）
2. 按面板拆文件到 `src/app/dock/wrappers/`，恢复按面板代码分割
3. git 业务逻辑下沉到 feature 域 hooks：`useRefreshGitInfo` / `useOpenDiffTab` / `useGitLogKeyboardNav`
4. `useGitLog` / `useStashList` 增加 enabled 激活门控（对齐 PullRequestsPanel 模式）
5. window 全局桥接改为 `TerminalInsertContext`（Provider + register/useTerminalInsert）
6. `GitControlPanel` 内部接管数据 hooks（wrapper 变薄，props 收敛）

## Requirements

1. **删死代码**：GitCommitPanelWrapper / GitLogPanelWrapper 及导出删除；回滚交给 git 历史。
2. **按面板拆文件**：`src/app/dock/wrappers/<Panel>Wrapper.tsx` 每面板一文件；`registry.ts` 与 `App.tsx` 的 lazy 指向新文件（default export）；每个 wrapper 独立 chunk。
3. **逻辑下沉**：
   - `useRefreshGitInfo(project, commands, connectionContext)`：refreshGitInfo + mergeGitInfoForStore + ahead/behind 同步（ref 读最新值，稳定引用）
   - `useOpenDiffTab(connectionContext, activeWorktreePath)`：打开/激活 Commit Diff tab（去重、worktree tabKey）
   - `useGitLogKeyboardNav({ enabled, commits, selectedHash, files, currentFileIdx, combined, onSelectCommit, onOpenFileDiff, onToggleCombined })`：J/K/j/k/c 键盘导航
4. **激活门控**：`useGitLog(commands, enabled)` / `useStashList(commands, enabled)`；GitControlPanelWrapper 计算 dock isActive 传入；GitControlPanel 内部按 tab 门控（history tab 才加载 log；面板可见才加载 stash）。
5. **Context 化**：`TerminalInsertContext`（shared/contexts，register/unregister + api）；ProjectWorkspace 注册 insertToAgentInput/insertToTerminal（删除 window 全局 `__neekoInsertToAgentInput` / `__neekoInsertToTerminal` / `__neekoReadAgentInput`）；LibraryPanelWrapper 消费 context；Provider 挂 App 层。
6. **GitControlPanel 自取状态**：tab 状态、useGitLog/useCommitDetail/useStashList/useSingletonDiff/useOpenStashDiff/useOpenDiffTab/键盘导航全部内聚到 GitControlPanel（feature 容器），wrapper 保持薄适配（active 门控 + context + effectiveProject + aheadBehind）。

## Acceptance Criteria

- [x] `DockPanelWrappers.tsx` 删除；`src/app/dock/wrappers/` 下每面板一文件；registry/App lazy 引用更新
- [x] 无任何代码引用已删除的 GitCommitPanelWrapper / GitLogPanelWrapper / DockPanelWrappers
- [x] 打开任一 dock 面板不再加载全部面板代码（独立 chunk）
- [x] GitControlPanelWrapper < 150 行，只做 context/active 适配；GitControlPanel 接管数据 hooks
- [x] 面板/History tab 未激活时不发起 git log / stash list 请求；激活后加载；切回保留数据
- [x] `window.__neekoInsertToAgentInput` / `__neekoInsertToTerminal` / `__neekoReadAgentInput` 全部移除；LibraryPanel 插入行为与重构前一致（terminal → agent → clipboard 兜底）
- [x] 新 hooks 均有单测（enabled 门控、键盘导航、refresh 语义、diff tab 去重、context register）
- [x] 质量门禁全绿：pnpm lint / lint:fe / type-check / test:run / cargo test

## Notes

- 行为保持优先：除激活门控（延迟取数）与窗口桥接（改 context 通道）外，不改动既有交互。
- `neeko:insert-to-agent-input` 事件目前无监听方（历史遗留），迁移时保持事件派发语义不变，不扩大范围修复。
- Stash 徽章计数：面板可见时加载 stash list（一次 git 命令），面板不可见时不加载。
- GitLogPanel 的 refresh 由 GitControlPanel 组合（onRefreshGit + log refresh）。
- **DockLayout.tsx 观察项（后续实施遵循）**：现为 305 行（组件体 ≈262 行，未超 300 红线；文件含 imports/注释/interface 样板微超 5 行）。职责仍单一（布局编排）。作为 dock 系统交汇点，若后续新增 zone 逻辑或组件体逼近 300，应将 5 个 zone 几何 effects（left/right expand-collapse + 双 rAF resize、right active panel 切换 resize、`handleLayoutChanged` 持久化、ResizeObserver 宽度上报）抽为 `useDockZoneResize`（+可选 `useDockPanelSizeObserver`）hook，放 `src/layout/dock-layout/` 同级目录（就近管理，非 shared/hooks）。
