# 文件拖拽投递：推广到任意输入面

## Goal

把「从文件树拖一个文件/目录进来」的落地目标，从硬编码的两段（agent composer → 终端）改成
**按插入端口身份仲裁**：只要落点上有一个「能接收文本的端口」，文本就进去；一个都没有时
**明确告诉用户**，而不是像现在这样静默无操作。

## Background

用户实测：从 Neeko 自己的文件树拖文件到输入位置 —— Console 无错、窗口里有激活终端，
**什么都没发生**。代码核查（本次会话）：

1. **终端降级分支的解析写死了 pane**：
   `terminalRouting.ts::insertToTerminalTarget` → `resolveTerminalEntry(session, tabId)`
   （`terminalCache.ts:261`，`paneId` 默认 `'p1'`）。而终端缓存键是三元组
   `terminalAddress(session, tabId, paneId)`（`terminalAddress.ts:18`），`paneId` 由**渲染它的
   `PaneContent` / dock 槽位**传入 ⇒ 终端只要不在第一个 pane（右侧 dock / 分屏），
   精确键必然 miss → `{ ok: false }`。
2. **`{ ok: false }` 是静默的**：`useFileDrop` 的降级链（`insertToSessionAgent` → `insertToSessionTerminal`）
   拿到 false 后既不打日志也不提示 ⇒ 用户侧「无反应」，Console 干净。这正是这次难定位的原因。
3. **可投递面太少**：只有 agent-chat composer（Tiptap 注册表）与终端。代码编辑器（CodeMirror）
   与普通文本输入（input/textarea）完全没有插入通道。
4. 已有的正确先例（照它们做，不要另起）：
   - `agent-chat/api/agentInputRegistry.ts`（身份键 + 引用计数 + 未命中 false）
   - `agent-chat/components/composer/editorRegistry.ts`（Tiptap 实例登记 + `insertIntoComposer`）
   - `editor/api/editorViews.ts`（`getEditorView(identity)` / `editorIdentityOfTab`）
   - `terminalAddressPrefixOfTab`（按 tab 扫所有 pane 的现成前缀）

## Requirements

- **R1（pane 无关的终端解析）**：按 `terminalAddressPrefixOfTab(session, tabId)` 扫
  local / wsl / remote 三个后端缓存，取存活条目；多 pane 同时存在时优先**激活 pane**。
  禁止再依赖 `paneId` 默认值。
- **R2（统一插入端口注册表）**：新增 `src/features/file/api/insertPorts.ts`（或 `shared/inputs/`，
  见 design §2）：端口 = `{ insert(text) => boolean }`，按**身份键**登记（引用计数），
  不允许 DOM 猜测。四类端口：
  `agent-composer`（复用现有 Tiptap 注册表）· `code-editor`（CodeMirror view）·
  `text-control`（聚焦的 input/textarea，进光标处）· `terminal`（R1 的解析）。
- **R3（仲裁顺序，第一个落地成功者胜）**：
  ① 拖拽期间指针落点所在的**已注册端口**（记 `dragover` 坐标 + `elementFromPoint` 判包含）
  ② 当前焦点落在某个已注册端口的 DOM 内
  ③ 本 session 的 agent-chat composer
  ④ 本 session 激活 tab 的代码编辑器
  ⑤ 本 session 的终端（R1）
  ⑥ 全部未命中 → 显式失败（R4）
- **R4（未命中必须可见）**：`useFileDrop` 接受 `onUnhandled(text)` 回调（ProjectView 注入
  `showToast`），失败时提示「这里不能插入路径」并 `console.debug` 记录尝试过的端口；
  **禁止**静默 return。
- **R5（域边界）**：`file` 域不得 import UI（toast / store 组件）；可见性由调用方注入。
  端口实现落在各自的域内（editor 端口在 `features/editor`，text-control 在 `shared/inputs`）。
- **R6（不重蹈覆辙）**：**禁止**用 `document.activeElement` 的标签名（`isTextInputElement`）
  当判据 —— 当年 xterm 的 `<textarea class="xterm-helper-textarea">` 让该判据恒真，
  把文本投给零监听者的 DOM 事件后丢弃（见 `useFileDrop.ts` 顶部事故记录）。焦点只允许作为
  「命中**已注册**端口的键」。

## Acceptance Criteria

- **AC1**：`insertToTerminalTarget` 对非 `p1` 的终端也能落地（单测：登记 `…:p2` 的条目 →
  `insertToSessionTerminal` 返回 ok，且 paste 用那条目的 sessionId）。
- **AC2**：未命中 → `onUnhandled` 被调用一次（单测：无 composer / 无编辑器 / 无终端），
  且不再静默。
- **AC3**：代码编辑器端口：激活 tab 是文件时，拖入的路径插到 CodeMirror 光标处
  （单测用真 `EditorView` 或既有测试替身，断言 doc 变化 + 返回 true）。
- **AC4**：文本控件端口：焦点在 `<input>` 时光标处插入（`document.execCommand('insertText')`
  路径），`<textarea>` 同理；焦点在**非**输入控件（如按钮）时不命中。
- **AC5**：仲裁顺序有判据：同时存在 composer 与编辑器时，指针落在编辑器上 → 进编辑器
  （①）；只在编辑器上、指针不在任何端口 → 仍进编辑器（④，按下标优先于终端）。
- **AC6**：`pnpm check:quick` + `cargo test` 不受影响；新增单测覆盖正常 / 边界 / 失败三面。
- **AC7**：真实拖拽手工验证（记录到 implement.md）：分屏终端（非 p1）拖入成功、
  编辑器拖入成功、普通输入框拖入成功、空白处拖入给 toast。

## Out of Scope

- **外部文件拖入**（Finder / 资源管理器 → 窗口）：全仓零 `onDragDropEvent` 监听，
  `dragDropEnabled` 默认 true 由 Tauri 在 WKWebView 层接管。属独立特性（需要窗口级事件接线，
  且与内部 HTML5 拖拽互斥策略要一起定），另立项。
- 终端 / 侧栏视觉与布局；`terminalAddress` 三元组结构本身（只改「怎么找」，不改「怎么命名」）。
- 反向能力（从输入框拖出去）。
