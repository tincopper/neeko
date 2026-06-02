# PRD: Terminal Scroll-to-Bottom Button

## Summary

在终端区域添加一个 "滚动到底部" 浮动按钮。Agent 流式输出期间，若用户手动上翻查看历史内容，按钮浮现；点击后立即滚动到终端最底部并恢复自动跟随。

## Design Decisions

| 决策点 | 结论 |
|--------|------|
| 可见性 | 条件显示：viewport 不在底部时显示，在底部时隐藏 |
| 位置 | 终端区域底部水平居中，absolute 浮动 |
| auto-follow | 不加额外状态机，依赖 xterm 原生行为 |
| 检测方式 | 单一 `term.onScroll` 事件，检查 `viewportY >= baseY` |
| 动画 | opacity fade ~150ms transition |
| 生命周期 | effect 内注册 `onScroll`，cleanup dispose |
| 点击行为 | `scrollToBottom()` → `focus()` |
| 修改范围 | 仅 `TerminalViewBase.tsx`，三种项目源自动复用 |

## Acceptance Criteria

- [ ] 终端 viewport 在底部时按钮透明/不可见
- [ ] 用户向上滚动后按钮浮现（opacity fade in）
- [ ] 点击按钮后 viewport 滚动到最底部
- [ ] 点击后终端恢复焦点（可继续键盘输入）
- [ ] 切换 tab 后 listener 正确清理，无泄漏
- [ ] Local / WSL / Remote 三种终端均生效
