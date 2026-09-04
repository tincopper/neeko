# Design: StatusBar prompts 快捷入口

## 链路

```
PromptsStatusSection（新，features/status-bar/）
 → useLibraryStore.prompts / refreshPrompts        // features/library/store/libraryStore.ts
 → usePromptInsert 放宽版（recordUsage + 变量框）    // features/library/hooks/usePromptInsert.ts
 → useTerminalInsert().api.insertToTerminal(text)  // shared/contexts/TerminalInsertContext.tsx
 → ProjectWorkspace 注册实现（按环境分发）          // app/components/ProjectWorkspace.tsx:188-201
 → pasteToTerminal（新）/ sendToTerminal            // features/terminal/components/terminalCommands.ts
 → emit(terminal-input-{sessionId}, bytes)          // shared/utils/terminalEvents.ts
 → PTY（local terminalCache / wsl wslTerminalCache / remote remoteTerminalCache）
```

## 变更点

1. **新 `src/features/status-bar/PromptsStatusSection.tsx`**
   - chip 按钮 + 弹窗：复用 `LspStatusSection.tsx` 骨架（`buttonRef.getBoundingClientRect()` 上弹 `bottom = innerHeight - rect.top + 4` + portal + Esc/外部关闭），内部自订阅 store，props 最小化。
   - 弹窗体：搜索 input + scroll 列表 + 空态；行 `px-3 py-1.5 hover:bg-bg-hover`；`testid`: `prompts-status-chip/dropdown/row-*`。
   - `StatusBar.tsx` 右簇 `NotificationButton` 前插入（样式 `cn hover:text-text-primary + title`，参考 Console/Debug 按钮）。
2. **`usePromptInsert.ts`**：`if (target === 'agent')` 放宽为 agent + terminal 均走 `detectVariables → openVariableDialog`。
3. **`terminalCommands.ts`**：新增 `pasteToTerminal(projectId, text, tabId?)` = `sendToTerminal` 的 bracketed 包裹版（`\x1b[200~ + text + \x1b[201~` 后编码 emit）；`sendToTerminal` 本体不动（`terminalCache.ts:152` 尾 `\r` 执行路径不受影响）。
4. **`ProjectWorkspace.tsx:188-201`**：`insertToTerminal` 按项目环境分发 local/WSL/remote（参照 `terminalCache.ts:457 resolveBackendForKey` 模式；WSL key `wslCacheKey(distro, projectId)`，remote key `remoteCacheKey(entryId, projectId)`），并按是否命中返回 boolean（现状永远 `true`，miss 仅 `log`）。
   - 消费侧（`LibraryPanelWrapper.handleInsertPrompt` 逻辑复用）：terminal 目标失败 → toast“无活动终端”，不落 agent/clipboard。

## 约束（repo 规范）

- feature `index.ts` 仅门面；store 经 `./store` 直导；图标经 `shared/icons`；`mod.rs` 极薄（本次无 Rust 变更）。
- bar 高 `h-4`，弹窗必须 portal；TDD：先补测试再实现。

## 测试

- `status-bar/__tests__/PromptsStatusSection.test.tsx`（参照 `LspStatusSection.test.tsx`）：chip 渲染/门控、dropdown 开关、搜索过滤、空态、行点击回调。
- `usePromptInsert` terminal 变量用例；`pasteToTerminal` 包裹标记断言。
