# Phase 3A-2: Local TerminalView → TerminalViewBase

## Goal

`TerminalView.tsx` (358行) 迁移为 `TerminalViewBase` 适配器（~100行），消除与 WSL/Remote 视图的重复。

## Approach

创建 `strategies/local.ts`，提供 Local 特有的 `createSession`（调用 `invoke("create_terminal_session")`），TerminalViewBase 处理 xterm 生命周期。

Local 特有差异：executedAgentKeys dedup、task terminal、window resize 监听。通过扩展 `TerminalStrategy` 接口支持。

## Acceptance Criteria

- [ ] `npx tsc --noEmit` 零 error
- [ ] `pnpm test:run` 全部通过
- [ ] TerminalView.tsx → ~100行适配层
- [ ] 手动测试：本地终端可正常打开、resize、agent 启动
