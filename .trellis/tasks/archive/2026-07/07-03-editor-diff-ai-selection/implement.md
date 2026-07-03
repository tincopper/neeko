# Implementation Plan: 代码编辑器和 Diff 选择代码与 AI 交互

## Execution Order

### Step 1: agentPrompt.ts (新建)

纯工具函数，无外部依赖。

- `buildCodeMessage(action, filePath, startLine, endLine, question?)`
- `buildDiffMessage(action, filePath, lineCount?, question?)`
- 返回纯文本字符串

**验证：** `pnpm type-check`

### Step 2: useEditorAgentActions.ts (新建)

核心 hook，依赖 editorStore / useTerminalTabs / terminalCommands。

- `sendToAgent(action, codeContext)`:
  1. Build message string
  2. Find agent tab via editor store
  3. If found → `sendToTerminal(projectId, msg + "\r")`
  4. If not found → show Toast → wait for "Open Terminal" click → `addTab()` → 1.5s delay → `sendToTerminal`
- `findAgentTab(projectId)`: scan terminal tabs for `agentId != null`
- Toast 用 `setTimeout` + unmount 清理，不引入 toast 库

**验证：** `pnpm type-check`

### Step 3: SelectionToolbar.tsx (新建)

浮动操作条组件。

- 接受 `{ filePath, startLine, endLine, language, onAction }` props
- 渲染 4 个按钮：Ask / Explain / Review / Fix
- Ask 按钮点击后 inline 展开输入框 + Send 按钮
- 定位：基于 CodeMirror 选区 bounding rect（`EditorView.coordsAtPos` 或 `measure`）

**验证：** `pnpm type-check`

### Step 4: FileViewer.tsx (修改)

集成 SelectionToolbar。

- `EditorView.updateListener` 中检测 `selectionSet` / `viewportChanged`
- 读取选区 start/end line numbers
- 选区非空时渲染 SelectionToolbar，定位在选区上方
- 选区消失时隐藏

**验证：** `pnpm type-check`

### Step 5: DiffView.tsx (修改)

- header 加 "Review this change" 按钮
- 点击后用 `useEditorAgentActions.sendToAgent("review", diffContext)`
- 集成 DiffTable/SplitDiffTable 的选择状态

**验证：** `pnpm type-check`

### Step 6: DiffTable.tsx + SplitDiffTable.tsx (修改)

- 行号 (`<td>`) 添加 `onClick` → toggle line selection
- 选中行 `<tr>` 添加高亮 class（`bg-blue-500/10` 等）
- 暴露 `selectedLines` + `toggleLine` 给父组件 DiffView

**验证：** `pnpm type-check`

### Step 7: Quality Gate

```bash
pnpm lint
pnpm type-check
pnpm test:run
cargo test --manifest-path src-tauri/Cargo.toml
```

## Files Modified

| # | File | Action |
|---|------|--------|
| 1 | `src/shared/utils/agentPrompt.ts` | CREATE |
| 2 | `src/features/editor/hooks/useEditorAgentActions.ts` | CREATE |
| 3 | `src/features/editor/components/SelectionToolbar.tsx` | CREATE |
| 4 | `src/features/editor/components/FileViewer.tsx` | MODIFY |
| 5 | `src/features/git/components/diff/DiffView.tsx` | MODIFY |
| 6 | `src/features/git/components/diff/DiffTable.tsx` | MODIFY |
| 7 | `src/features/git/components/diff/SplitDiffTable.tsx` | MODIFY |

## Rollback

```bash
git checkout -- src/features/editor/components/FileViewer.tsx src/features/git/components/diff/DiffView.tsx src/features/git/components/diff/DiffTable.tsx src/features/git/components/diff/SplitDiffTable.tsx
git clean -f src/shared/utils/agentPrompt.ts src/features/editor/hooks/useEditorAgentActions.ts src/features/editor/components/SelectionToolbar.tsx
```
