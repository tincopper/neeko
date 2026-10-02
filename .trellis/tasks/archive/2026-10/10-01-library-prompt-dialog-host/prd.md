# 状态栏 Prompts 表单弹窗不可见（store 驱动弹窗被视图级容器托管）

> 状态：**已实现（代码已合入）**；验收于 2026-10-02 复核补齐自动化证据（见下方 AC 与 `implement.md` Step 10）。本文只登记需求、约束与验收标准；契约与取舍见 `design.md`，执行顺序见 `implement.md`。
> 所有 `file:line` 论断均在 2026-10-01 对当前 `main`（commit `b4a21e34`）逐条核实。

## Goal

让 Library 的三个 store 驱动弹窗（Fill Variables / Prompt 编辑器 / Insert 选择器）在**任何触发点、任何中心视图**下都能出现并被结算，
消除「弹窗跑到 Library 界面才出现，用户在主界面看不到」这一类缺陷。

## Problem Statement（用户可观察症状）

原始反馈：*「状态栏 Prompts 功能，如果涉及到表单弹窗的功能有问题，弹窗没有出现在主界面，而是出现在 library 界面，导致看不到。」*

拆解后可复现症状：

| 症状 | 现场形态 |
| --- | --- |
| S1 静默无响应 | 本次会话从未进过 Library 视图时，状态栏 Prompts 选中含 `{{var}}` 的 prompt：界面上没有任何反应，内容也没进终端 |
| S2 迟到弹窗 | S1 之后再打开 Library 视图，「Fill Variables」表单才弹出来（过期 flag 在别处被消费） |
| S3 设置视图下必失 | `appView === 'settings'` 时 Library 子树整体卸载（`AppCenter.tsx:53-54`），同一条路径 100% 不可用 |

## 问题本质（第一性原理）

**一个 Promise 只能由它的结算者兑现；一个弹窗只能由它的渲染点显示。**

1. `PromptsStatusSection.tsx:94,158-164` → `usePromptInsert.ts:22-31` 在 `{{var}}` 路径上 `await openVariableDialog(content)`；
   `libraryStore.ts:212-227` 只翻 flag，Promise 的**唯一结算者**是渲染 `VariableDialog` 的那个组件。
2. 三个弹窗的**唯一渲染点**在 `LibraryPanel.tsx:94-102`，而 `AppCenter.tsx:38-44,61-73` 是**懒挂载 + 视图级**容器
   （`libraryMounted` 首进 Library 才为 true；settings 分支直接不渲染）。
3. 于是「状态写在全局、渲染点在局部」：flag 翻起时没有消费者 → 弹窗不出现 + Promise 永久悬挂 + 插入静默丢失。
   注意 `ui/Dialog.tsx:51` 走 portal，`DockZone.tsx:42` 的 `hidden` 反而无害 —— 真正的凶手是**真卸载**。

由此得到本任务要立住的不变量：

- **I1 宿主不变量**：store 驱动的弹窗必须有应用级唯一渲染点（本仓库既有范本 `ConfirmHost.tsx` + `AppModals.tsx:151`），
  不得由懒挂载/视图级容器托管。
- **I2 结算不变量**：弹窗持有的 Promise 必须**必然结算** —— 取消/关闭/宿主卸载都要有明确结果，无宿主时 fail-closed，
  绝不允许悬挂（范本 `confirmStore.ts:45-53,64-82`）。
- **I3 浮层不变量**：能在主工作区之上出现的 DOM 弹窗必须向 `overlayStore` 上报，否则被 Browser 子 webview 遮挡
  （消费点 `useBrowserTab.ts:83-87`）。

## Requirements

- R1 三个 prompt 弹窗（`PromptEditorDialog` / `PromptInsertDialog` / `VariableDialog`）的渲染点收敛到一个应用级宿主；`LibraryPanel` 只留布局。
- R2 变量填写流程的结果契约化：确认返回渲染后文本；取消 / 关闭 / 无宿主返回「未获得内容」，调用方据此**既不插入也不计使用次数**。
- R3 触发点与宿主解耦：状态栏 Prompts、命令面板、Library 面板三条入口共用同一套宿主与插入投递语义（terminal → agent → clipboard，范本 `LibraryPanelWrapper.tsx:17-38`，不得复制第二份）。
- R4 命令面板两条 prompt 命令就地打开对应弹窗，不再劫持中心视图；`New Prompt…` 必须打开**编辑表单**（现状：`ProjectWorkspace.tsx:248` 把两者都折叠成 `{kind:'prompt', insert:true}`，`New Prompt…` 实际打开的是插入选择器）。
- R5 同批修掉同源潜在缺陷：`closeConfirmStore.request`（`closeConfirmStore.ts:31-40`）缺宿主守卫，在 `SplashScreen` 期间（`App.tsx:32-34`，`AppModals` 未挂载）会永久挂起。
- R6 把不变量写回规范：`.trellis/spec/frontend/component-guidelines.md:151-171` 目前**正是**把两个弹窗画在 `LibraryPanel` 里（反例被文档固化），必须纠正并补规则。

## Constraints

- C1 只动前端 `src/**`；不改后端、不改 IPC 契约、不动 `tauri.conf.json` / capabilities。
- C2 遵守 `src/AGENTS.md`：跨 feature 只允许 facade / `store/` / `types/` / `api/` 直导；禁止全局 barrel；同一 feature 内部不得自环门面。
- C3 不做向后兼容垫片：被替换的 store 字段与 `openLibraryAt` 的 `insert` 选项一律删除，不保留旧别名或 re-export。
- C4 范围外（登记为 follow-up，不在本任务实现）：`ActionPalette` 仍挂在视图级 `ProjectWorkspace.tsx:301`（今天被 `useKeyboardShortcuts.ts:90-93` 的提前返回掩盖）；`openEditorWithContent` 零调用方；MCP 两个弹窗（flag 只在 Library 子树内翻起，无外部触发点）。
- C5 TDD 硬闸门：先写复现测试并确认 Red，再实现；`pnpm check` 与既有护栏（含 `check_path_identity_scope` 台账计数）必须全绿。

## Acceptance Criteria

- [x] AC1 全新会话、从未打开 Library 视图：状态栏 Prompts 选含 `{{var}}` 的 prompt → 「Fill Variables」表单出现在**主界面之上**；填值确认后渲染文本写入终端并把终端 tab 推到前台。
      → `PromptsStatusSection.test.tsx`「含 {{var}} 的行点击…确认后把渲染文本写入终端」+「插入成功后终端露面」；`PromptDialogHosting.integration.test.tsx`（新）证明表单经 Radix portal 挂在 `document.body`、**不在中心视图子树内**。
- [x] AC2 取消 / × / Esc / 遮罩点击：不插入、不计使用次数、无残留 pending 状态；之后再进 Library 视图不会蹦出过期表单。
      → `PromptsStatusSection.test.tsx`「变量表单经 cancel|close|escape|overlay 关闭」（`it.each` 四形态，断言 `variableRequest === null`、`insertToTerminal` / `recordUsage` 均未调用）。
- [x] AC3 `appView === 'settings'` 时 AC1 同样成立（视图劫持方案在此必然失败，是宿主动机的硬证据）。
      → `PromptDialogHosting.integration.test.tsx`（新）：真 `AppCenter`（settings 分支挂 `view-settings`、卸载 workspace/library）+ 真 `AppModals`，弹窗照常渲染并 `resolves` 渲染文本。
- [x] AC4 命令面板 `New Prompt…` 打开编辑表单、`Insert Prompt…` 打开选择器，两者都**不切换中心视图**。
      → `actionRegistry.test.ts`（既有，`new-prompt` / `insert-prompt` 断言无 `openLibraryAt` 视图切换）。
- [x] AC5 Library 视图原有能力不回归：New/Edit prompt、列表插入 agent/terminal 行为不变。
      → 全量 `pnpm test:fe` 501 files / 4490 passed（仅新增本任务用例）；`PromptDialogHost.test.tsx` / `libraryStore.test.ts` 等既有用例逐条不变。
- [x] AC6 主工作区存在 Browser tab 时，三个弹窗任一打开期间子 webview 被隐藏（`overlayStore` 上报生效）。
      → `PromptDialogHost.test.tsx:189-211` 三个 overlay id（`prompt-editor` / `prompt-insert` / `prompt-variables`）上报与撤销；`useBrowserTab.test.ts`（新）「浮层打开期间隐藏 webview」：`overlayStore.count>0 → visible=false`，关闭后恢复。
- [x] AC7 `PromptDialogHost` 测试证明「仅凭 store flag、不挂 LibraryPanel 也能渲染三个弹窗」；状态栏测试升级为驱动真实弹窗流程（而非只断言 flag）。
      → `PromptDialogHost.test.tsx`（既有）+ `AppModals.test.tsx`（全局宿主）+ `PromptsStatusSection.test.tsx`（升级为真 `PromptDialogHost` 流程）+ `PromptDialogHosting.integration.test.tsx`（新，Library 未挂载）。
- [x] AC8 `pnpm test:fe` / `pnpm lint:fe` / `pnpm guards` / `pnpm check` / `pnpm build` 全绿；台账计数不变。
      → `pnpm test:fe` 501 files / 4490 passed | 1 skipped；`pnpm lint:fe` 0 error（唯一 warning 为既有 `VirtualList.tsx`）；`pnpm guards run --stage local` 9/9 通过（206 条框架自检）、`check_path_identity_scope` debt 0；`pnpm check` 全绿（eslint 0 / tsc 0 / `cargo fmt`+clippy 0 / guards 9/9 / rust lib 1388 passed / host OK）；`pnpm build` 成功（`vite build` 20.1s，唯一输出为既有 chunk-size warning）。
- [x] AC9 规范更新落地：`component-guidelines.md` 示例改正 + 新增「store 驱动弹窗只允许全局宿主渲染，其 Promise 必须取消即结算、无宿主 fail-closed」；`status-bar.md` item 契约补「不得依赖某视图已挂载」。
      → `9a994242 docs(spec): require a global host for store-driven dialogs`（`component-guidelines.md:209`、`status-bar.md:152`）。

## Notes

- 宿主与 `ConfirmHost` 同构，不发明新机制；投递语义抽成一个 hook 供宿主与 dock wrapper 共用（最大化复用）。
- AC1/AC3 的「可见」物理层（OS 是否真把 portal 画在 Browser 子 webview 之上）jsdom 无法证明；本任务以
  **「portal 不在中心视图子树内 + 与既有 `ConfirmHost` / `CloseConfirmDialog` 同一渲染层」** 作为自动化判据，
  物理层由桌面端走查兜底（既有同类浮层已长期生效，属既有事实而非新增风险）。
