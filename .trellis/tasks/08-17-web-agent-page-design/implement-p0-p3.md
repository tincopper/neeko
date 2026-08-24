# Conversation 查看器 UI 优化 — P0-P3 实现计划

> 挂靠任务：08-17-web-agent-page-design（用户指定，不新建任务）
> 范围：现有 `src/features/conversation/` 历史会话查看器 + `src/ui/MarkdownPreview.tsx` 优化。
> P3 仅含会话内搜索；实时聊天（Agent Chat Tab 集成）不在本轮范围。

## 验收标准

- [x] P1a 工具图标/摘要抽取 `utils/toolPresentation.ts`，`ConversationViewer` 与 `MessageBlocks` 共用，重复消除
- [x] P1b Markdown fenced code block 增加「复制」按钮（复用 `useCopyToClipboard`）
- [x] P2a `toolUse` + `toolResult` 按 `id`/`toolUseId` 配对展示，成功默认折叠、错误默认展开
- [x] P2b `MessageBubble` hover 显示「复制整条消息」操作
- [x] P2c `ConversationItem` 支持 `highlightQuery`，标题/preview 匹配词 `<mark>` 高亮
- [x] P0 `ConversationViewer` 消息分组虚拟滚动（`@tanstack/react-virtual`）
- [x] P3 会话内消息搜索：toolbar 搜索框 + 结果导航（上一条/下一条）+ 高亮
- [x] 全程 TDD：先写失败测试（红）→ 最小实现（绿）→ 重构（蓝）
- [x] 回归通过：`pnpm type-check`、`pnpm test:run`、`pnpm lint`（2026-08-21 复测全绿：type-check / test:run 2108 passed / lint + cargo test 825+99）

## 实施顺序

1. P1a → P1b → P2a → P2b → P2c（纯前端、低风险）
2. P0 虚拟滚动（引入依赖 `@tanstack/react-virtual`）
3. P3 会话内搜索（独立于虚拟滚动，基于 `visibleMessages` 内存搜索）

## 关键约束

- 遵守 AGENTS.md 防火墙：conversation 内部跨组件共享工具放 `utils/`；组件间直导
- 纯前端改动，不动 Rust 命令层
- 保持 `React.memo` / `useCallback` 既有性能模式
- 不改 Event 名、不新增 Tauri 命令