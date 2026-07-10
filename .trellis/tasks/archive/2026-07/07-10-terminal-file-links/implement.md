# Implement: 终端文件路径点击跳转

## 执行清单

### 1. `src/features/terminal/components/terminalLinks.ts`
- 新增 `FilePathLinkOptions` 接口
- 新增 `readFileContent` 导入（已有 `revealInFileManager` 导入）
- 修改 `createFilePathLinkProvider` 入参为 `options: FilePathLinkOptions`
- 实现 `activate` 中 `metaKey/ctrlKey` 分支
- 文件打开逻辑：读内容 → 构造 Tab → addTab → 设置 pendingNavigateTarget
- 修改 `setupTerminalLinks` 入参为 `(term, options)`

### 2. `src/features/terminal/strategies/local.ts`
- 计算 `tabKey` (`projectId` 或 `buildWorktreeTabKey`)
- 构造 `transport: FileTransportKind`
- `setupFileLinks` 中传入完整 `FilePathLinkOptions`

### 3. `src/features/terminal/strategies/wsl.ts`
- 新增 `setupFileLinks`（当前没有）
- 计算 `tabKey` 和 `transport`
- 导入 `setupTerminalLinks` 和 `buildWorktreeTabKey`

### 4. `src/features/terminal/strategies/remote.ts`
- 新增 `setupFileLinks`（当前没有）
- 计算 `tabKey` 和 `transport`
- 导入 `setupTerminalLinks`

## 验证命令

```bash
pnpm lint
pnpm type-check
pnpm test:run
```
