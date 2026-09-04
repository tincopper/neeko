# Cmd+W 未保存关闭确认修复

## Goal

修复「新建文件输入内容后，Cmd+W / Ctrl+W 关闭 tab 不提示保存、内容静默丢失」的缺陷：把未保存确认扩展到全部 tab 关闭路径，并闭环 untitled 文件「保存后关闭」语义。

## Background（代码实证，2026-09-04 grill 会话结论）

关闭 tab 共三条路径，确认行为不一致：

| 路径 | 代码链路 | 现状 |
|---|---|---|
| TabBar X / 右键 Close Tab | `usePaneActions.handleCloseTab` → `CloseConfirmDialog` 三选框 | ✅ 有确认 |
| 菜单 File → Close Tab（`CmdOrCtrl+W` accelerator） | `CLOSE_TAB_EVENT` → `closeActiveTabCommand.ts:38` 直接 `closeEditorTab` | ❌ 静默丢弃 |
| 内置快捷键 `Ctrl+W`（`shortcutRegistry.ts` 默认绑定） | `useKeyboardShortcuts` → `useTabManagement.handleCloseTab` 直接 `closeEditorTab` | ❌ 静默丢弃 |

untitled 新建文件创建即 `isDirty: true`（`createUntitledFileTab.ts`），确认条件本可覆盖——缺口仅在键盘/菜单路径未接确认状态机。

## Requirements

- R1 行为对齐：键盘/菜单关闭 dirty 文件 tab → 与 X 按钮完全一致的三选确认框（保存 / 不保存 / 取消）；保存失败或取消 → tab 不关闭。
- R2 全局单例确认：`useCloseConfirmation` 状态机提升为 zustand store（仿 `saveAsStore` 先例，Promise resolver 存 store），对话框渲染挪到 `AppModals`；X / 菜单 / 快捷键三条路径统一调用 `store.request()`；保存动作走 app 级 `FileActionsContext.onFileSaveTab`（已在 `AppProviders.tsx` 全局挂载）。
- R3 untitled 保存闭环：关闭确认中选「保存」→ Save As → **保存成功后自动关 tab**。`SaveAsRequest` 增加 `closeAfterSave` 意图（已携带 `tabId`/`tabKey`），`SaveFileDialog` 成功回调条件执行 `closeEditorTab`；取消 Save As 不关。顺带修复 X 按钮路径「保存后 tab 仍打开」的同一褶皱。
- R4 非 file tab（terminal / agent-chat / browser 等）无 dirty 概念，Cmd+W 行为不变（直接关）。

## Out of Scope（列入已知问题，不在本次）

- 批量关闭（Close Others / All）确认框增加「保存」选项（现为纯丢弃确认）。
- 项目移除 / `clearProjectTabs` 的 dirty 检查。

## Acceptance Criteria

- [ ] `closeConfirmStore` 全局单例：Promise 语义 `request()` 返回 `'save' | 'discard' | 'cancel'`，并发请求排队行为与现 `useCloseConfirmation` 一致（新请求到来时旧 Promise resolve `'cancel'`）。
- [ ] `closeActiveTabCommand` 与 `useTabManagement.handleCloseTab`：dirty 文件 tab → 经 store 弹确认；`'cancel'` 不关；`'discard'` 直接关；`'save'` 保存成功才关。
- [ ] `EditorGroupPane` 的 X 按钮路径改消费全局 store，行为不回归（三选框 UX 不变）。
- [ ] `SaveFileDialog` 保存成功且 `closeAfterSave=true` 时自动 `closeEditorTab`；取消时不动。
- [ ] 非 dirty / 非 file tab 走原直关路径，无弹框。
- [ ] 全程 TDD（red-green-refactor）；`pnpm type-check` / `pnpm test:run` / `pnpm lint:fe` 全绿。

## Notes

- 决策来源：2026-09-04 grill-me 会话（用户逐项确认 R1/R2/R3；范围问题按推荐默认「仅键盘/菜单关闭」）。
- macOS 菜单 accelerator 与 webview 快捷键对 Ctrl+W 的抢占关系无需区分——两条路径都接入确认后行为收敛。
