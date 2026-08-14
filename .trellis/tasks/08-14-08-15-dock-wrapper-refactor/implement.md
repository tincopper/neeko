# Dock 面板 Wrapper 重构 — 执行记录

## 执行顺序（每步保持测试绿 / 编译通过）

### Phase A：新 git feature hooks（TDD Red→Green）
- [x] A1. `useRefreshGitInfo(project, commands, connectionContext)`：refreshGitInfo + mergeGitInfoForStore + ahead/behind 同步（ref 读最新值、稳定引用，消除 wrapper 依赖循环）
- [x] A2. `useOpenDiffTab(connectionContext, activeWorktreePath, projectIdFallback?)`：打开/激活 Commit Diff tab（同文件去重、worktree tabKey、真实 projectId）
- [x] A3. `useGitLogKeyboardNav({ enabled, commits, selectedHash, files, currentFileIdx, combined, onSelectCommit, onOpenFileDiff, onToggleCombined })`：J/K/j/k/c 键盘导航（输入控件跳过、enabled 门控）
- [x] A4. 单测：`useRefreshGitInfo.test.ts`（6）/ `useOpenDiffTab.test.ts`（4）/ `useGitLogKeyboardNav.test.ts`（7）

### Phase B：激活门控（useGitLog / useStashList）
- [x] B1. `useGitLog(commands, enabled = true)`：首次 enabled 加载一次；disabled 保留数据；disabled 期间 refresh 只复位标记、enabled 后自动重载
- [x] B2. `useStashList(commands, enabled = true)`：commands 变化清空重载；enabled 翻转重新拉取；disabled 不清空
- [x] B3. 单测：`useGitLog.test.ts`（6 新增）/ `useStashList.test.ts`（+3 enabled 门控）

### Phase C：TerminalInsertContext（window 全局桥接 → Context）
- [x] C1. `shared/contexts/TerminalInsertContext.tsx`：Provider + register/unregister + api（insertToTerminal / insertToAgentInput）
- [x] C2. `ProjectWorkspace` 改为 register 注册能力；删除 `__neekoInsertToAgentInput` / `__neekoInsertToTerminal` / `__neekoReadAgentInput`（后者无消费方，属死代码）
- [x] C3. `LibraryPanelWrapper` 消费 `useTerminalInsert()`（terminal → agent → clipboard 兜底，行为不变）
- [x] C4. Provider 挂 `App.tsx`（AppProviders 内、DockRegistryProvider 外）；`App.tsx` Library lazy 指向新 wrappers 路径
- [x] C5. 单测：`TerminalInsertContext.test.tsx`（4）

### Phase D：拆分 wrappers + GitControlPanel 接管 hooks
- [x] D1. `src/app/dock/wrappers/` 每面板一文件（default export，独立 lazy chunk）：
  FilesPanelWrapper（303 行）/ GitControlPanelWrapper（100 行）/ SkillsPanelWrapper / LibraryPanelWrapper / ConversationsPanelWrapper / PullRequestsPanelWrapper / SearchPanelWrapper
- [x] D2. 删除 `src/app/dock/DockPanelWrappers.tsx`（1353 行，含死代码 GitCommitPanelWrapper / GitLogPanelWrapper）
- [x] D3. `registry.ts` 全部 lazy 指向新文件（不再共享同一 chunk）
- [x] D4. `GitControlPanel` 接管：tab 状态、useGitLog(active && tab==='history')、useStashList(active)、useCommitDetail、useSingletonDiff、useOpenStashDiff、useOpenDiffTab、useGitLogKeyboardNav(enabled: tab==='history')；props 40 → 10
- [x] D5. GitControlPanelWrapper 薄化为 dock/context 适配层（isActive 门控 + effectiveProject + aheadBehind + useRefreshGitInfo）

### Phase E：质量门禁
- [x] E1. `pnpm lint`（Rust fmt + clippy）全绿
- [x] E2. `pnpm lint:fe`（eslint src/ + tsc + vitest --typecheck）全绿，1621 tests / 无类型错误
- [x] E3. `pnpm type-check` 全绿
- [x] E4. `pnpm test:run` 1621 passed | 1 skipped（基线 1591 → +30）
- [x] E5. `cargo test` 全绿（无 Rust 改动）

### Phase F：spec 同步
- [x] F1. `frontend/directory-structure.md`：wrappers/ 目录与依赖方向更新
- [x] F2. `frontend/component-guidelines.md`：Tabbed Shell 模式更新（hooks 内聚 Shell、激活门控、wrapper 薄化）
- [x] F3. `frontend/quality-guidelines.md`：新增 panel 路径 + 禁止模式（window 全局桥接 / wrapper 内嵌业务编排）
- [x] F4. `frontend/api-layer.md`：文件路径更新

## 验证命令（全部通过）

```bash
pnpm lint
pnpm lint:fe
pnpm type-check
pnpm test:run
cargo test --manifest-path src-tauri/Cargo.toml
```

## 审查门禁

- 公共组件（shared/）无业务逻辑：TerminalInsertContext 仅提供通道与生命周期，不感知业务
- wrapper 薄适配：业务编排全部下沉 feature hooks / GitControlPanel（feature 容器）
- 行为保持：除激活门控（延迟取数）与桥接通道（window → Context）外，交互语义不变
- `neeko:insert-to-agent-input` 事件无监听方（历史遗留），迁移时保持派发语义，未扩大范围
