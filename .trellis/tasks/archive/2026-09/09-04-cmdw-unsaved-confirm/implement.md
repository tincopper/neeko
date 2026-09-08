# Implement Plan — Cmd+W 未保存关闭确认修复

> 依据：prd.md（grill 会话四项决策）。全程 TDD：先写失败测试（Red）→ 最小实现（Green）→ 重构。
> 不做：批量关闭保存选项、clearProjectTabs dirty 检查（Out of Scope）。

## M1 全局确认 store（closeConfirmStore）

1. 新建 `src/features/editor/store/closeConfirmStore.ts`（zustand，仿 `action-menu/store/saveAsStore.ts` 先例）：
   - 状态：`{ pending: { fileName: string } | null }` + `request(fileName): Promise<'save'|'discard'|'cancel'>` + `resolve(action)`。
   - Promise resolver 存模块级变量（store 外）；并发请求到来时旧 Promise resolve `'cancel'`（对齐现 `useCloseConfirmation` 排队语义，参考其测试 `useCloseConfirmation.test.ts`）。
   - 保留 overlay z-order 语义：沿用现 `useCloseConfirmation` 的 `useOverlayStore` 计数（'close-confirm' overlay id）——在 store 的 request/resolve 内加减。
2. 迁移测试：把 `useCloseConfirmation.test.ts` 的行为断言平移到 store 版（open/close、save/discard/cancel 回传、并发排队、overlay 计数）。

## M2 对话框挪到 AppModals + EditorGroupPane 改消费

1. `AppModals.tsx`：挂载 `CloseConfirmDialog`（props 接 store 状态），沿用现文案「has unsaved changes」与三按钮。
2. `EditorGroupPane.tsx`：移除本地 `useCloseConfirmation` 实例与 `CloseConfirmDialog` 渲染；`usePaneActions.handleCloseTab` 的确认改调 `closeConfirmStore.request(fileName)`（原 `onRequestCloseTab` 参数链路收敛为 store 调用，删除不再需要的 prop 透传）。
3. 回归测试：`usePaneActions.test.ts` 现有 dirty 确认断言改桩 store；`CloseTabContent.test.tsx` 等既有测试不回归。

## M3 键盘/菜单路径接入

1. `src/app/hooks/closeActiveTabCommand.ts`：`closeActiveTabForTabKey` 关闭前检查 `isDirtyFileTab(tab)`（`@/shared/utils/fileTree`）→ dirty 则 `await closeConfirmStore.request(getTabDisplayName(tab))`，按选择执行（save → `FileActionsContext.onFileSaveTab(tabId)`，失败不关；discard → 关；cancel → 不关）。注意：此文件是纯模块函数（非 hook），保存需经 store/桥——实现方式：在 `useAppShellData` 已把 `onFileSaveTab` 注册进可全局访问的位置，或将 save 动作作为模块级注册器（仿 `registerTabCleanup` 先例）注入；选实现成本最小者，保持模块可测试性。
2. `src/features/editor/hooks/useTabManagement.ts` `handleCloseTab`：同样接入确认（此为 hook，可直接消费 store + useFileActionsContext）。
3. 新测试：`closeActiveTabCommand.test.ts` 补 dirty 分支（cancel 不关 / discard 关 / save 成功关 / save 失败不关）；`useTabManagement.test.ts` 同理。非 file tab、非 dirty 直关路径断言不变。

## M4 untitled Save As 闭环（closeAfterSave）

1. `saveAsStore.ts`：`SaveAsRequest` 增加 `closeAfterSave?: boolean`。
2. `useFileViewTabOps.ts` `saveFile` untitled 分支：`requestSaveAs` 传入 `closeAfterSave: true`（调用来源是关闭确认场景；Ctrl+S 手动保存场景不传——需区分入口：`saveTabById`（关闭确认用）传 true，直接 Ctrl+S 的 `saveFile` 不传。实现时以参数或两个入口区分）。
3. `SaveFileDialog.tsx` `handleSubmit` 成功回调：`request.closeAfterSave` 为 true → `closeEditorTab(request.tabKey, request.tabId)`（经 `@/features/terminal` 门面）。
4. 测试：Save As 成功关 tab / 取消不关；`useFileViewTabOps` 相应分支。

## M5 回归

```bash
pnpm type-check
pnpm test:run
pnpm lint:fe
```

## 关键约束（AGENTS.md 红线）

- store 放 feature `store/` 目录；跨模块直导 store 文件（防火墙白名单 `./store`）。
- 关闭 tab 一律经 `closeEditorTab`（`@/features/terminal` 门面 re-export），不直接调 `editorStore.closeTab` 绕过 PTY 回收。
- `React.memo` / `useCallback` 既有性能模式不回退。
- 不改 Rust 后端；不改 Event 名。
