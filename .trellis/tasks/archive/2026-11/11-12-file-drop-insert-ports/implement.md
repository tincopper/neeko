# 实施计划：插入端口注册表

```bash
npx vitest run src/shared/inputs src/features/file src/features/terminal src/features/agent-chat src/features/editor
pnpm check:quick
```

---

## S1 · 端口注册表 + 仲裁 + composer/终端端口（修掉本次 bug）

- [x] **Red**（`src/shared/inputs/__tests__/insertPorts.test.ts`）：
  - `resolve_at_point_prefers_containing_port`（`elementFromPoint` 桩）
  - `resolve_at_focus_finds_port_containing_active_element`
  - `registration_is_ref_counted`（StrictMode 双挂载：先卸载不摘除）
- [x] **Red**（`useFileDrop.test.ts` 扩展）：
  - `terminal_in_a_non_default_pane_receives_the_path` —— 注册一个 id 含 `:p2` 的终端端口，
    拖拽后该端口 `insert` 被调用（**这是本次 bug 的回归钉**）
  - `unhandled_drop_calls_onUnhandled` —— 无端口 → 回调一次（且不再静默）
- [x] **Green**：`shared/inputs/insertPorts.ts`；`useFileDrop` 改仲裁（①→⑦）；
      `RichComposer` 注册 composer 端口；`TerminalView` 按 pane 注册终端端口
      （`insert` 用该 pane 自己的 PTY sessionId）；`ProjectView` 注入 `onUnhandled: showToast`。
- [ ] **Gate A**：`rg -n "resolveTerminalEntry\(" src/features/file src/features/terminal/components/terminalRouting.ts`
      在拖拽路径上零命中（终端不再靠写死 paneId 解析）。

## S2 · 代码编辑器端口（AC3 / AC5）

- [x] **Red**：`active_editor_port_receives_the_path` —— 注册一个假 editor 端口（`insert` 改 doc），
      焦点/指针都不在端口上、但它是本 session 激活 tab 的编辑器 → ④ 命中；终端端口不被调用。
- [x] **Green**：CodeMirror 挂载处注册 editor 端口（`el = view.dom`，`isActive = 激活 tab`，
      `insert = dispatch(replaceSelection)`）。
- [ ] **Gate B**：`rg -n "editorViews" src/shared/inputs` 零命中（端口由 editor 域注册，不反向 import）。

## S3 · 焦点文本控件端口（AC4）

- [x] **Red**：`focused_input_receives_text_at_cursor` / `focused_textarea_receives_text_at_cursor`
      / `focused_button_is_not_a_text_port`（jsdom 里 `execCommand` 需 stub：断言调用 + 值变化）。
- [x] **Green**：`shared/inputs/textControlPort.ts`（§3.1），在 ③ 使用。
- [ ] **Gate C**：`rg -n "isTextInputElement" src/` 零命中（旧启发式不得复活）。

## S4 · 收尾

- [x] `npx vitest run`（相关域）全绿；`pnpm check:quick` 全绿。
- [ ] **手工验证并记录**（AC7）：窄窗口分屏终端拖入 / 编辑器拖入 / commit 输入框拖入 / 空白处 toast。
- [ ] spec：`.trellis/spec/frontend/` 对应文件（state-management 或新增 inputs 段）记
      「插入端口模型 + 仲裁顺序 + 禁止标签名启发式」；`file` 域与 UI 的边界（回调注入）。

## 回滚点

- S1 独立（修 bug）；S2/S3 各自独立（新增端口）。
- 无后端 / wire 变化，无需迁移。

## 手工验证结果（AC7，2026-11-12 用户确认）

用户实测通过：分屏/右侧 dock 终端拖入 ✅ · 代码编辑器拖入 ✅ · 普通输入框拖入 ✅ ·
空白处给 toast ✅ · agent-chat composer 回归 ✅。

## 实施记录（与计划的偏差）

- **多修一处（更有价值）**：`resolveTerminalEntry` 的 `paneId` **默认值被删除**（它才是 bug 本体），
  新增 `resolveTerminalEntryOfTab`（pane 无关、按键字典序确定性）服务「只知道 tab」的写侧调用方
  —— `sendToTerminal` 那条同源路径一并修好。
- 终端端口 `el` 用 getter 惰性投影（`TerminalViewBase` 在字体门闩后才建 DOM）：登记时通常还没有
  元素，指针/焦点判据每次读当前值，不需要重挂。
- `shared/inputs/textControlPort.ts` 以「值或选区真的变了」判成功，`execCommand` 失败即 false 继续降级。
