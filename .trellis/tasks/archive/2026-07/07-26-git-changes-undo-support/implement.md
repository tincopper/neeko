# 执行计划：Git Changes 一键撤销全部改动

## Phase 1：类型与能力层（约 10 分钟）

1.1 `src/shared/types/project.ts`
- 在 `ProjectCommands` 接口中 `discardFile` 下方增加：
  ```ts
  discardAll(): Promise<void>;
  ```

1.2 `src/features/project/hooks/use-active-project/commandFactory.ts`
- 在返回对象中 `discardFile` 下方增加：
  ```ts
  discardAll(): Promise<void> {
    return invoke<void>('discard_all', { projectId, worktreePath });
  },
  ```

## Phase 2：API 层确认（约 5 分钟）

2.1 `src/features/git/api/gitApi.ts`
- 确认 `discardAll` 函数签名正确（已存在），无需改动。
- 注意：前端统一走 `ProjectCommands`，不再直接 import `gitApi.discardAll`。

## Phase 3：UI 层实现（约 30 分钟）

3.1 `src/features/git/components/ChangesList.tsx`
- Props 接口增加 `onDiscardAll?: () => void`。
- 在 Changes section 的 header row 右侧增加按钮：
  - 使用 `Undo2` 图标，size=14。
  - title="Discard all changes"。
  - onClick 调用 `onDiscardAll?.()`。
  - disabled 条件：`loading || trackedFiles.length === 0 || !onDiscardAll`。
  - 样式对齐现有 headerAction。
- 注意保持 filter 与 headerAction 的 `ml-auto` 布局规则。

3.2 `src/features/git/components/GitCommitPanel.tsx`
- 引入 `Dialog` 组件与 `Undo2` 图标（如尚未引入）。
- 将原来的 `handleDiscardFile` 直接执行逻辑改为统一确认对话框。
- 新增 state：
  ```ts
  const [discardConfirm, setDiscardConfirm] = useState<
    | { type: 'file'; path: string }
    | { type: 'all'; count: number }
    | null
  >(null);
  ```
- 修改并新增回调：
  ```ts
  const handleDiscardFile = useCallback((path: string) => {
    setDiscardConfirm({ type: 'file', path });
  }, []);

  const handleDiscardAllRequest = useCallback(() => {
    setDiscardConfirm({ type: 'all', count: changedFiles.length });
  }, [changedFiles.length]);

  const handleCancelDiscard = useCallback(() => {
    setDiscardConfirm(null);
  }, []);

  const handleConfirmDiscard = useCallback(async () => {
    if (!discardConfirm) return;
    setDiscardConfirm(null);
    setLoading(true);
    try {
      if (discardConfirm.type === 'file') {
        await withTimeout(commands.discardFile(discardConfirm.path), TIMEOUT_LOCAL_MS, 'discard');
      } else {
        await withTimeout(commands.discardAll(), TIMEOUT_LOCAL_MS, 'discard-all');
      }
      await onRefreshGit();
      if (discardConfirm.type === 'all') {
        setSelectedFiles(new Set());
      } else {
        setSelectedFiles((prev) => {
          const next = new Set(prev);
          next.delete(discardConfirm.path);
          return next;
        });
      }
      onShowToast?.(
        discardConfirm.type === 'all' ? 'Discarded all changes' : 'Discarded changes',
        'info',
      );
    } catch (e: unknown) {
      onShowToast?.(String(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [commands, onRefreshGit, onShowToast, discardConfirm]);
  ```
- 在 render 中增加统一确认对话框（建议在 `BranchInfo` 之后、`ChangesList` 之前）：
  ```tsx
  <Dialog open={!!discardConfirm} onOpenChange={(open) => !open && setDiscardConfirm(null)}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {discardConfirm?.type === 'all' ? 'Discard all changes?' : 'Discard changes?'}
        </DialogTitle>
      </DialogHeader>
      <p className="text-[13px] text-text-secondary">
        {discardConfirm?.type === 'all'
          ? `This will discard all ${discardConfirm.count} changes and delete untracked files. This action cannot be undone.`
          : `This will discard changes in '${discardConfirm?.path}' and cannot be undone.`}
      </p>
      <DialogFooter>
        <Button variant="outline" onClick={handleCancelDiscard}>Cancel</Button>
        <Button variant="destructive" onClick={handleConfirmDiscard}>
          {discardConfirm?.type === 'all' ? 'Discard All' : 'Discard'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  ```
- 将 `onDiscardAll={handleDiscardAllRequest}` 传入 `ChangesList`。

## Phase 4：测试补充（约 20 分钟）

4.1 `src/features/project/hooks/use-active-project/__tests__/commandFactory.test.ts`
- 在 Local 测试 suite 中增加：
  ```ts
  it('discardAll should call discard_all', async () => {
    await commands.discardAll();
    expect(mockInvoke).toHaveBeenCalledWith('discard_all', wtPayload());
  });
  ```
- 在 worktreePath 测试 suite 中增加对应的 worktree 版本。

4.2 检查现有 ChangesList/GitCommitPanel 测试
- 如存在，补充「Discard All 按钮可见性」与「点击触发确认」测试。
- 如不存在，本任务暂不强制新增（遵循现有测试覆盖度）。

## Phase 5：验证（约 15 分钟）

5.1 类型检查
```bash
pnpm type-check
```

5.2 前端测试
```bash
pnpm test:run
```

5.3 Rust 测试
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

5.4 手动验证（在 `pnpm tauri dev` 中）
- 打开一个存在多个改动的项目。
- 进入 Git Changes 面板：
  - 悬停某个文件行，点击「Discard changes」按钮，确认弹出对话框显示文件路径。
  - 点击 Cancel，确认对话框关闭、该文件改动保留。
  - 再次点击「Discard changes」并确认，确认该文件改动被撤销、toast 提示「Discarded changes」。
- 确认头部出现「Discard All」按钮。
- 点击「Discard All」，确认弹出对话框并显示正确文件数量。
- 点击 Cancel，确认对话框关闭、改动未被撤销。
- 再次点击「Discard All」并确认，确认所有改动被撤销、列表刷新为空、toast 提示「Discarded all changes」。

## 提交信息

```
feat(git): add discard all changes action in changes panel
```

## 回滚方案

- 若确认对话框文案引发用户困惑，可在不改动功能的情况下仅调整文案。
- 若发现 WSL/Remote 下 `discard_all` 行为不一致，先禁用 Remote 环境的 `canDiscard` 能力，再修复 transport 层。
