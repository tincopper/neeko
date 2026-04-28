# 修复终端模块 Fast Refresh 警告

## Goal

消除 Vite React Fast Refresh 对终端组件模块的 incompatible export 警告，保持开发时 HMR 行为稳定。

## Requirements

- `TerminalView.tsx`、`RemoteTerminalView.tsx`、`WSLTerminalView.tsx` 不再导出非组件工具函数或缓存对象。
- 保留现有外部导入 API，优先通过 `components/terminal/index.ts` 桶文件继续导出终端工具。
- 不改变 local、WSL、Remote 终端运行行为。
- 保持缓存清理、刷新、Agent 启动、sessionId 获取等能力可用。

## Acceptance Criteria

- [ ] 不再出现 `Could not Fast Refresh ... export is incompatible` 日志。
- [ ] `pnpm type-check` 通过。
- [ ] 终端相关单测通过。
- [ ] 变更范围限定在前端终端模块。

## Technical Notes

- 根因是组件文件同时导出 React 组件和非组件值，破坏 Vite React Fast Refresh 的 consistent component exports 规则。
- 采用拆分纯 TS helper/cache 模块的方式修复，而不是关闭 Fast Refresh 或改 Vite 配置。
