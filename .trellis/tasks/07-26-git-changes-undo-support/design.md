# 技术设计：Git Changes 一键撤销全部改动

## 总体架构

本功能 purely 是前端能力补齐 + 少量类型扩展。后端命令 `discard_all` 已存在，无需新增 Rust 代码。

```
用户点击 "Discard changes"（单文件）或 "Discard All"
    │
    ▼
ChangesList 触发 onDiscardFile(path) 或 onDiscardAll
    │
    ▼
GitCommitPanel 打开统一确认对话框
    │
    ▼
确认后根据类型调用 commands.discardFile(path) 或 commands.discardAll()
    │
    ▼
Tauri 执行对应 Git 命令
    │
    ▼
返回后 onRefreshGit() 刷新状态 + toast
```

## 文件改动清单

### 类型与能力层

1. `src/shared/types/project.ts`
   - 在 `ProjectCommands` 接口增加 `discardAll(): Promise<void>;`。

2. `src/features/project/hooks/use-active-project/commandFactory.ts`
   - 在返回对象中增加 `discardAll()`，调用 `discard_all` 并透传 `worktreePath`。

3. `src/features/project/hooks/use-active-project/capabilities.ts`
   - 现有 `canDiscard` 已覆盖单文件 discard，本次可复用该字段表示「具备 discard 能力（含批量）」。
   - 如需更细粒度，可新增 `canDiscardAll: true`；评估后建议复用 `canDiscard`，减少能力矩阵膨胀。

### API 层

4. `src/features/git/api/gitApi.ts`
   - `discardAll` 已存在，无需改动。但需确认 WSL/Remote 路径下未被直接引用；统一走 `ProjectCommands`。

### UI 层

5. `src/features/git/components/ChangesList.tsx`
   - Props 增加 `onDiscardAll?: () => void`。
   - 单文件行的「Discard changes」按钮行为不变，仍调用 `onDiscardFile(file.path)`。
   - 在 Changes section header 增加「Discard All」按钮（仅在 tracked files 存在且传入回调时显示）。
   - 复用现有 `Undo2` 图标（size=14），title="Discard all changes"。
   - 按钮样式与现有 headerAction 保持一致：`p-0.5 rounded text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-100`。
   - 当 `loading` 或 tracked files 为空时 disabled。

6. `src/features/git/components/GitCommitPanel.tsx`
   - 用统一的确认对话框状态替换原来的直接执行逻辑。
   - 新增 `discardConfirm` 状态：
     ```ts
     const [discardConfirm, setDiscardConfirm] = useState<
       | { type: 'file'; path: string }
       | { type: 'all'; count: number }
       | null
     >(null);
     ```
   - 修改 `handleDiscardFile(path)`：改为打开 `type: 'file'` 确认对话框。
   - 新增 `handleDiscardAllRequest`：打开 `type: 'all'` 确认对话框。
   - 新增 `handleConfirmDiscard`：根据 `discardConfirm.type` 执行单文件或全部撤销。
   - 确认后执行：
     ```ts
     setLoading(true);
     if (discardConfirm.type === 'file') {
       await withTimeout(commands.discardFile(discardConfirm.path), TIMEOUT_LOCAL_MS, 'discard');
     } else {
       await withTimeout(commands.discardAll(), TIMEOUT_LOCAL_MS, 'discard-all');
     }
     await onRefreshGit();
     setSelectedFiles((prev) => { /* 移除已 discard 文件 */ });
     onShowToast?.(
       discardConfirm.type === 'all' ? 'Discarded all changes' : 'Discarded changes',
       'info',
     );
     ```
   - 错误处理与现有 `handleDiscardFile` 保持一致。
   - 将 `onDiscardAll={handleDiscardAllRequest}` 传入 `ChangesList`。

### 测试层

7. `src/features/project/hooks/use-active-project/__tests__/commandFactory.test.ts`
   - 增加测试：`discardAll should call discard_all with worktreePath`。

8. 新增或扩展 ChangesList/GitCommitPanel 测试（如已有测试文件）
   - 验证「Discard All」按钮在有改动时可见、空列表时 disabled。
   - 验证点击后弹出确认、确认后调用 onDiscardAll。

## 确认对话框设计

使用现有 `Dialog` / `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogFooter` / `Button` 组件。

文案：
- 单文件
  - Title: `Discard changes?`
  - Body: `This will discard changes in '{path}' and cannot be undone.`
  - Primary button: `Discard`（变体 `destructive`）
  - Secondary button: `Cancel`
- 全部
  - Title: `Discard all changes?`
  - Body: `This will discard all {count} changes and delete untracked files. This action cannot be undone.`
  - Primary button: `Discard All`（变体 `destructive`）
  - Secondary button: `Cancel`

## 状态与并发

- `loading` 状态由 `GitCommitPanel` 统一管理，`ChangesList` 只接收 `loading` prop。
- 确认对话框打开期间，`ChangesList` 与 `CommitForm` 仍显示但受 `loading` 保护；确认瞬间设置 `loading=true`。
- 避免在 `discardAll` 执行期间重复触发：按钮 disabled 由 `loading` 控制。

## 错误边界

- `commands.discardAll()` 失败时通过 `onShowToast?.(String(e), 'error')` 提示。
- 成功后必须 `await onRefreshGit()`，确保 changes 列表为空后再 toast。

## 兼容性

- Local / WSL / Remote 统一通过 `ProjectCommands` 调用，无需区分 transport。
- `worktreePath` 由 `commandFactory` 在创建 commands 时注入，与 `discardFile` 保持一致。

## 不回滚点

- 若确认对话框实现复杂，可先复用 `window.confirm` 作为临时方案，但正式实现必须替换为项目内的 `Dialog` 组件。
- 若后端 `discard_all` 语义变更（如不删除 untracked），需同步更新确认文案。
