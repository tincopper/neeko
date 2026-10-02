# 执行计划

> 顺序即依赖：Step 1 必须先看到 Red；Steps 2-6 是一个原子提交；Steps 7-8 各自独立提交。

## Step 0 · 前置

- [x] `python3 ./.trellis/scripts/task.py start library-prompt-dialog-host`（文档齐备 + 用户确认后）
- [x] `pnpm guards list check_path_identity_scope` 记录当前计数基线（Step 5 搬代码后必须不变）

## Step 1 · Red（先证明缺陷存在）

- [x] 新建 `src/features/library/components/__tests__/PromptDialogHost.test.tsx`（参照 `src/shared/components/__tests__/ConfirmHost.test.tsx`，`beforeEach` 复位模块级 mounted 标记）
  - [x] 仅凭 store flag、不挂 `LibraryPanel` 也渲染三个弹窗
  - [x] 宿主卸载时在途变量请求按 `null` 结算
  - [x] 无宿主时 `openVariableDialog` 立即 resolve `null`
- [x] 改写 `src/features/status-bar/__tests__/PromptsStatusSection.test.tsx:238-248`（原断言只看 flag，正是缺陷漏网原因）
  - [x] 渲染 chip + 宿主，点含 `{{var}}` 行 → 表单出现 → 填值确认 → `insertToTerminal` 收到**渲染后**文本
  - [x] 取消 → 不插入、不计使用次数
- [x] 跑 `pnpm test:fe`，确认上述用例 **Red** 且失败原因是「没有弹窗渲染」而非类型/导入错误

## Step 2 · store 契约

- [x] `src/features/library/store/libraryStore.ts`
  - [x] 删 `variableDialogOpen` / `variableDialogContent` / `variableDialogResolve`，新增 `variableRequest: string | null`
  - [x] 模块级 `let variableResolver` / `let hostMounted` + `export function setPromptDialogHostMounted`
  - [x] `openVariableDialog(content): Promise<string | null>`（无宿主立即 `null`；并发旧请求 `null`）
  - [x] `settleVariableDialog(rendered | null)`：清 flag + 清 overlay + 结算并置空 resolver
  - [x] `openEditor` / `openEditorWithContent` / `closeEditor` / `openInsert` / `closeInsert` 补 `useOverlayStore` 上报（id 见 design §2.2）

## Step 3 · 调用方处理 `null`

- [x] `src/features/library/hooks/usePromptInsert.ts:22-31` → `rendered === null` 直接 return（不计次数、不插入）

## Step 4 · 宿主

- [x] 新建 `src/features/library/components/PromptDialogHost.tsx`：渲染三弹窗；一个 effect 置位/清除 mounted 标记并在卸载时 `settleVariableDialog(null)`
- [x] `src/features/library/index.ts` 门面导出 `PromptDialogHost`、`useInsertPromptToWorkspace`
- [x] `src/app/AppModals.tsx` 在 `<ConfirmHost />`（`:151`）旁挂 `<PromptDialogHost />`

## Step 5 · 抽取投递语义（禁复制第二份）

- [x] 新建 `src/features/library/hooks/useInsertPromptToWorkspace.ts`，函数体取自 `src/app/dock/wrappers/LibraryPanelWrapper.tsx:17-38`
- [x] `LibraryPanelWrapper.tsx` 改为消费该 hook（保持 `onInsertPrompt` → `LibraryPanel` 的既有 props 通路）
- [x] `pnpm guards list check_path_identity_scope` 计数与基线一致

## Step 6 · 面板摘除

- [x] `src/features/library/components/LibraryPanel.tsx`：删三弹窗 import（`:10,15-17`）、变量弹窗订阅（`:31-34`）、`handleInsert`（`:56`）、`handleVariableConfirm`（`:58-64`）、JSX（`:94-102`）→ 只剩布局
- [x] `src/features/library/components/PromptInsertDialog.tsx:51-58,142-152`：先 `closeInsert()` 再 `onInsert(...)`
- [x] 复跑 Step 1 用例 → Green；`pnpm test:fe` 全绿（含被删字段影响的 `usePromptInsert.test.ts:47,59,75,90,109,120`）

## Step 7 · 命令面板就地打开

- [x] `src/features/action-menu/actionRegistry.ts:109-132`：`new-prompt` → `useLibraryStore.getState().openEditor()`；`insert-prompt` → `.openInsert()`
- [x] `src/features/library/store/libraryNavigation.ts`：删 `OpenLibraryOptions.insert` 分支
- [x] `src/app/components/ProjectWorkspace.tsx:245-249`：`openLibrary` 退回纯导航
- [x] 更新 `src/features/library/store/__tests__/libraryNavigation.test.ts:43-49`

## Step 8 · `closeConfirmStore` 宿主守卫

- [x] `src/features/editor/store/closeConfirmStore.ts`：`setCloseConfirmHostMounted` + 无宿主 `Promise.resolve('cancel')`
- [x] `src/features/editor/components/CloseConfirmDialog.tsx`：effect 置位/清除；卸载时 `resolve('cancel')`（同时清 overlay，防泄漏）
- [x] 扩展 `src/features/editor/store/__tests__/closeConfirmStore.test.ts`：无宿主返回 `cancel`；卸载结算在途请求

## Step 9 · 规范回写

- [x] `.trellis/spec/frontend/component-guidelines.md:151-171`：示例删掉面板内弹窗；新增规则「store 驱动弹窗只允许全局宿主渲染；其 Promise 必须取消即结算、无宿主 fail-closed」（引用编号，不复述红线全文）
- [x] `.trellis/spec/frontend/status-bar.md` item 契约：状态栏项不得依赖某视图已挂载

## Step 10 · 门禁与人工验收

- [x] `pnpm test:fe` · `pnpm lint:fe` · `pnpm guards` · `pnpm check` · `pnpm build`
- [x] ~~**未执行**：`pnpm tauri dev` 人工走查 prd 的 AC1-AC6~~ → 改为 2026-10-02 的自动化验收（Step 12）；
      唯一无法自动化的「OS 是否真把 portal 画在 Browser 子 webview 之上」属物理层事实，由既有同类浮层
      （`ConfirmHost` / `CloseConfirmDialog`）同期生效作证，不再要求人工走查（macOS 无官方 tauri-driver）。
- [x] 提醒用户提交（本任务不自动 commit）→ `trellis-finish-work` 记 journal

## 回滚点

| 范围 | 手法 |
| --- | --- |
| Steps 2-6 | 单提交整体 revert（契约与宿主互为前提） |
| Step 7 / Step 8 | 各自独立提交，可单独 revert，互不影响 |
| 数据 | 无迁移、无持久化字段变更（`partialize` 不含瞬态 flag） |

## Step 11 · `/neeko-check` 审核回写（实现后自查发现并修掉）

- [x] [Block] 新模块 `useInsertPromptToWorkspace` 的三条降级分支无测试（pillar 2 / 「没有测试的新代码不允许合入」）
      → 补 `hooks/__tests__/useInsertPromptToWorkspace.test.ts`（6 例，实测 100%）
- [x] [Warning] DRY + 状态管理原则 4：prompt 查询匹配在 `PromptsStatusSection.filterPrompts` 与
      `PromptInsertDialog` 内联 memo 各一份，且**已实际漂移**（一处 trim 查询词、一处不 trim ⇒ 纯空白查询行为不同）
      → 抽 `src/shared/utils/promptQuery.ts`（只依赖 `shared/types`，零 feature 耦合，不放 feature 门面）
      → 两处改消费同一实现；补纯函数测试（6 例，100%），并在 `vitest.config.ts` 钉 100% 地板
      （按配置注释要求做「阈值设 101 必须按文件名报错」的验活，三个新条目均已验）
- [x] [Warning] 本次改的「选择器先关再投递」无测试 → 在 `PromptDialogHost.test.tsx` 补链路用例
      （顺带钉住既有契约：左键 = agent，右键/Shift+Enter = terminal）
- [x] [Warning] `openEditorWithContent` + `initialContent`（「Save as Prompt」前置通道）零生产者 → 已整段删除
      （含 `PromptEditorDialog` 里的死预填分支），不为其造调用方（YAGNI / 禁留「将来可能」）
- [x] [Warning] `PromptEditorDialog` 30% / `PromptInsertDialog` 45% 覆盖缺口 → 已补齐关键路径
      （字段校验、新建/编辑 payload、失败不吞输入、取消、键盘导航与回绕、20 条截断、共享过滤产出点、
      清空按钮 aria-label）：EditorDialog 90.5% 行、InsertDialog 100% 行，并按组件惯例（同 FileEditor.tsx）
      在 `vitest.config.ts` 钉 lines/statements 地板（101 验活通过）。
- [ ] 仍未覆盖（可接受）：`<details>` 展开态内联回调、Store 导航 setter（行为归属既有用例）。

## Step 12 · 验收缺口补齐（2026-10-02，AC 自动化收口）

背景：主体代码在 Step 1-9 已合入并绿，但 prd 的 AC1-AC9 未逐条勾选、Step 10 的人工走查未执行。
受 macOS 无官方 `tauri-driver` 限制，改为把 AC 能自动化的部分做成 jsdom 集成测试，物理层由既有同类浮层兜底。

- [x] `src/features/status-bar/__tests__/PromptsStatusSection.test.tsx`：新增「变量表单经 cancel|close|escape|overlay
      关闭」`it.each` 四形态（AC2）—— 此前只测 Cancel；× / Esc / 遮罩同样会走
      `onOpenChange(false) → settleVariableDialog(null)`，不看住就会退化成「关而不结算」（Promise 悬挂）。
- [x] `src/features/browser/hooks/__tests__/useBrowserTab.test.ts`：新增「浮层打开期间隐藏 webview」（AC6）——
      钉住派生公式 `isActive && !anyOverlayOpen && !!tabExists`（无浮层 visible / 有浮层隐藏 / 关闭恢复）；
      上报侧（三个 overlay id）由 `PromptDialogHost.test.tsx:189-211` 覆盖，两条合成完整判据链。
- [x] 新建 `src/app/__tests__/PromptDialogHosting.integration.test.tsx`（AC1/AC3）：真 `AppCenter`（settings 分支
      卸载 workspace/library）+ 真 `AppModals`，对 `appView ∈ {normal, settings}` 各跑一遍 —— 断言 Library 未挂载时
      弹窗仍渲染、经 Radix portal 不在中心视图子树内（`within(centerView).queryByRole('dialog')` 为空）、
      且 `openVariableDialog` 的 Promise 在确认后 `resolves` 渲染文本、`overlayStore.count` 归零。
- [x] 复跑门禁：`pnpm test:fe` 501 files / 4490 passed | 1 skipped；`pnpm lint:fe` 0 error；
      `pnpm guards run --stage local` 9/9（206 条框架自检）；`pnpm check` 全绿（含 rust lib 1388 passed / host OK）；
      `pnpm build` 成功（`vite build` 20.1s）。
- [x] 文档对账：`prd.md` AC1-AC9 逐条勾选并附测试名 / 证据；Notes 改写「可见」判据口径；
      `implement/check.jsonl` 补入相关 spec（component-guidelines / status-bar / state-management / frontend-testing）。
