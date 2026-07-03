# Design: 代码编辑器和 Diff 支持选择代码与 AI 交互

## Architecture

```
User selects code in CodeMirror → tooltip appears
  ┌───────────────────────────────────┐
  │ Ask(⌨) │ Explain │ Review │ Fix   │
  └───────────────────────────────────┘
         │ click
         ▼
  useEditorAgentActions.sendToAgent(action, agentTab?)
         │
         ├─ agentTab found → sendToTerminal("msg\r")
         │
         └─ no agentTab → Toast
                           "Open {agentName} Terminal"
                           → addTab() → sendToTerminal("msg\r") after 1.5s
```

## Data Flow

### Editor selection → text message

```
1. CodeMirror "selectionSet" / "viewportChanged" updateListener
   → check if selection is non-empty
   → show/hide SelectionToolbar

2. User clicks a button in SelectionToolbar
   → useEditorAgentActions.sendToAgent(actionType, codeContext)
     - codeContext = { filePath, startLine, endLine, language }
     - build message string: "explain the code at src/foo.rs:42-67"
     - find agentTab for current projectId
     - if found: sendToTerminal(projectId, message + "\r")
     - if not found: show Toast → user clicks "Open Terminal"
       → addTab(projectId, agentId, agentName)
       → setTimeout(1500, () => sendToTerminal(projectId, message + "\r"))
```

### Diff line selection → text message

```
1. User clicks line number in DiffTable/SplitDiffTable
   → toggle line selection (Set<string>)
   → show/hide selection count & floating "Ask AI" button

2. User clicks "Ask AI about N lines" or "Review this change" (full diff)
   → same sendToAgent flow as editor
   - message: "review the changes in src/foo.rs:15-30 (git diff)"
```

## Component Tree

```
FileViewer (CodeMirror)
  ├── SelectionToolbar (floating, conditional)
  │     └── AskInput (inline input, conditional)

DiffView
  ├── "Review this change" button (header, always visible)
  ├── DiffTable / SplitDiffTable
  │     └── clickable line numbers (toggle selection)
  └── SelectionToolbar (conditional, when lines selected)
```

## Key Decisions

### 1. Agent tab detection

Check store for terminal tabs with `tab.agentId != null && tab.projectId == currentProjectId`.

```typescript
function findAgentTab(projectId: string): Tab | null {
  return tabs.find(t => t.kind === 'terminal' && t.projectId === projectId && t.agentId);
}
```

### 2. No inline code in message

Agent CLI 在项目目录下运行，能自行读盘。消息只传路径+行号，不传代码本体。

### 3. Toast with action button

复用 AppToast 的 action button 能力。需要确认现有 toast 是否支持按钮，若不支持则用短命 `div` 替代。

### 4. No loading/error states

所有操作直接执行，不 try-catch。sendToTerminal emit 失败 → 忽略（用户可见终端输出）。
addTab 失败 → 忽略（终端创建有自身的上报机制）。

## Files to Create/Modify

| File | Status |
|------|--------|
| `src/shared/utils/agentPrompt.ts` | CREATE |
| `src/features/editor/hooks/useEditorAgentActions.ts` | CREATE |
| `src/features/editor/components/SelectionToolbar.tsx` | CREATE |
| `src/features/editor/components/FileViewer.tsx` | MODIFY |
| `src/features/git/components/diff/DiffView.tsx` | MODIFY |
| `src/features/git/components/diff/DiffTable.tsx` | MODIFY |
| `src/features/git/components/diff/SplitDiffTable.tsx` | MODIFY |
