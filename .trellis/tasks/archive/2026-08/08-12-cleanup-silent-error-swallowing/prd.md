# 清理前端存量 .catch(() => {}) 静默吞错，接入全局错误上报

## Goal

消除前端"故障发生时日志无痕"的隐患：将仓库中 16 个文件、47 处
`.catch(() => {})` 静默吞错改造为「可感知」的错误处理——经统一的
`reportFrontendError(source, error)` 上报（自带 source 级 5s 节流）写入
`~/.neeko/neeko.log`，并对确实无需上报的路径保留明确的豁免注释。

前置依赖：`reportFrontendError` 将由既有任务
`08-12-fix-markdown-link-crash-global-error-guard` 在
`src/app/registerGlobalErrorHandlers.ts` 中提供（本任务开发前需确认该函数存在
且已导出，否则先补齐）。

## Requirements

### R1：逐处改造吞错
1. 将下列 `.catch(() => {})` 改造成 `.catch(reportFrontendErrorFactory(source))`
   或等价形式（见 design.md 最小侵入模式），使被吞错误能上报到 Rust 日志。
2. 覆盖文件清单（47 处，随开发核对）：
   - `src/layout/useFullscreen.ts`（3）
   - `src/shared/store/taskStore.ts`（2）
   - `src/features/session/hooks/useSessionBootstrap.ts`（5）
   - `src/features/session/hooks/useSessionPersistence.ts`（1）
   - `src/shared/components/GitDialog.tsx`（2）
   - `src/features/browser/hooks/useBrowserPicker.ts`（1）
   - `src/features/browser/hooks/useBrowserPanel.ts`（5）
   - `src/features/editor/hooks/usePaneAgents.ts`（1）
   - `src/features/search/store/searchStore.ts`（1）
   - `src/features/terminal/components/TerminalViewBase.tsx`（5）
   - `src/features/project/api/onboardingApi.ts`（1）
   - `src/features/project/hooks/useWorktreeActions.ts`（2）
   - `src/features/project/components/WorktreeList.tsx`（1）
   - `src/features/terminal/components/terminalCommands.ts`（2）
   - `src/features/terminal/components/terminalCache.ts`（7）
   - `src/features/git/components/BranchSwitcherPanel.tsx`（1）
   - `src/features/git/components/GitCommitPanel.tsx`（1）
   - `src/features/git/components/CommitDialog.tsx`（1）
   - `src/features/git/components/PullRequestsPanel.tsx`（2）
   - `src/features/git/components/pr-detail/PRFilesChangedPanel.tsx`（1）
   - `src/features/skill/utils/bindProjectTagGroups.ts`（1）
   - `src/features/settings/components/ProjectPanel.tsx`（1）

### R2：保持合理豁免
3. 对「上报无意义或上报本身会引发循环/性能问题」的路径：
   - 终端高频输入输出（`terminal-input-*` emit、高频 resize 的 catch）——
     这些失败属尽力而为、低频可忽略，**允许保持静默**，但必须加
     `// 静默豁免：高频/尽力而为操作，失败无需上报` 注释。
   - `navigator.clipboard.writeText` 等用户可感知失败由调用方另作处理的，
     允许静默 + 注释。
   - 上报链路自身（`reportFrontendError` 内部 invoke 的 catch）保持静默，
     归属既有豁免。
4. 除上述豁免外，凡能拿到 `Error` / 有意义的 `message` 的一律上报。

### R3：不引入回归
5. 不改变任何成功路径行为。
6. 只在 `.catch` 回调内增加上报，不改变 Promise 链的返回值语义
   （`void promise.catch(...)` 结构保持不变）。
7. `pnpm lint:fe`、`pnpm type-check`、`pnpm test:run` 全部通过。

## Acceptance Criteria

- [ ] 47 处吞错逐一改造或豁免：非豁免项已上报（代码可追踪），豁免项带明确注释。
- [ ] 无新增 `.catch(() => {})`（除上报链路豁免）。
- [ ] 故障路径可在 `~/.neeko/neeko.log` 看到 `[Frontend]` 记录（节流后）。
- [ ] 成功路径行为零变化。
- [ ] `pnpm lint:fe`、`pnpm type-check`、`pnpm test:run` 全绿。

## Out of Scope

- 全面逐行审查所有错误处理（仅针对 `.catch(() => {})` 这一个模式）。
- 引入新的全局错误 UI。
- 后端 Rust 错误处理改造。
- `reportFrontendError` 本身的实现（由前序任务交付）。

## Open Questions

- `reportFrontendError` 在依赖任务合入前不可用：本任务开始前需确认其存在，
  否则阻塞。风险评估见 design.md。
