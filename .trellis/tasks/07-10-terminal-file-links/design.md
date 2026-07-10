# Design: 终端文件路径点击跳转

## 数据流

```
用户点击终端链路
  │
  ▼
xterm.js ILinkProvider.provideLinks()
  │  match FILE_PATH_REGEX → resolveToAbsolute()
  │
  ▼
activate(event: MouseEvent)
  │  event.metaKey || event.ctrlKey ?
  ├── No  → revealInFileManager(fullPath) [原行为]
  │
  └── Yes → 编辑器打开
       │
       ▼
    readFileContent(transport, fullPath)
       │
       ▼
    useEditorStore.addTab(tabKey, fileTab)
       │  line/col 存在 ?
       ├── No  → 完成
       │
       └── Yes → useEditorStore.setPendingNavigateTarget({ tabKey, tabId, line, col })
```

## 核心类型

```typescript
interface FilePathLinkOptions {
  projectPath: string;   // 项目根路径（含 worktree）
  tabKey: string;        // editor store 的 tabKey (projectId 或 worktree tabKey)
  projectId: string;     // 实际 projectId
  transport: FileTransportKind;  // 用于文件读取
}
```

## 跨层契约

| 层 | 文件 | 职责 |
|---|---|---|
| xterm.js 链接层 | `terminalLinks.ts` | 正则匹配、策略分发、store 写入 |
| 终端策略层 | `local.ts` / `wsl.ts` / `remote.ts` | 构造 FilePathLinkOptions 闭包 |
| Store 层 | `editorStore.ts` | `addTab` / `activateTab` / `setPendingNavigateTarget` (无改动) |
| 文件 API | `fileApi.ts` | `readFileContent` (已有) |
| Tab 导航 | `FileViewer.tsx` | `setPendingNavigateTarget` 消费 (无改动) |
