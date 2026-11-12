# 设计：插入端口注册表 + 按身份仲裁

## 0. 边界

- 新增 `src/shared/inputs/insertPorts.ts`（中立层：端口注册表 + 两种解析）。
- `src/features/file/hooks/useFileDrop.ts`（仲裁改为查端口；`onUnhandled` 注入）。
- 各域自己注册端口：`agent-chat`（composer）、`terminal`（每个渲染中的 pane）、
  `editor`（CodeMirror view）、`shared/inputs`（焦点文本控件的合成端口）。
- 不动：`terminalAddress` 三元组结构、终端/侧栏视觉、Tiptap 与非受控草稿的既有语义。

## 1. 端口模型

```ts
// src/shared/inputs/insertPorts.ts
export type InsertPortKind = 'agent-composer' | 'code-editor' | 'terminal';

export interface InsertPort {
  /** 端口身份（由注册方铸造：terminal key / editor identity / `${tabKey}:${tabId}`）。 */
  id: string;
  kind: InsertPortKind;
  /** 端口所属 session（仲裁只在该 session 内挑端口）。 */
  sessionKey: string;
  /** 端口根元素：pointer / focus 命中的判据（`contains`）。 */
  el: HTMLElement | null;
  /** 该端口当前是否处于「激活」形态（分屏终端的 active pane / 激活 tab 的编辑器）。 */
  isActive: () => boolean;
  /** 真正的插入；`false` = 本次没落地（调用方继续下一个端口）。 */
  insert: (text: string) => boolean;
}

registerInsertPort(port) // 引用计数（StrictMode 双挂载）
unregisterInsertPort(id)
resolvePortAtPoint(sessionKey, x, y)  // ① pointer
resolvePortAtFocus(sessionKey)        // ② focus
portsOf(sessionKey, kind)             // ③④⑤ 按种类取
```

**为什么端口由渲染方注册**：只有它同时知道「PTY sessionId / paneId」「是否激活」
「DOM 根节点」。这让 pane 无关性**从结构上成立** —— 不存在「猜 paneId」这一步，
也就是本次 bug 的根因被消除（R1 不再需要扫缓存）。

## 2. 仲裁（`useFileDrop` 内唯一实现）

```
落点 = 拖拽期间记录的指针坐标（document 'dragover' 只记坐标，不 preventDefault）

① resolvePortAtPoint(session, x, y)                    ← 用户明确把文件丢在这个端口上
② resolvePortAtFocus(session)                          ← 焦点在该端口内（如正在编辑器里打字）
③ 焦点是普通文本控件（input/textarea/contenteditable）  ← 合成端口，见 §3
④ portsOf(session,'agent-composer') 中 isActive 者
⑤ portsOf(session,'code-editor')    中 isActive 者
⑥ portsOf(session,'terminal')      中 isActive 者
⑦ 全部失败 → onUnhandled(text)（toast + console.debug 列出尝试过的端口）
```

每个候选都真的调 `insert()`，返回 `false` 就继续下一个 —— 「能不能落地」由端口回答，
调用方不猜。

### 2.1 与 R6（禁用标签名启发式）的关系

当年的缺陷是：`isTextInputElement(activeElement)` 被当作**「这就是 agent 输入」**的代理，
而 xterm 的 helper textarea 让该判据恒真、文本投给零监听者的 DOM 事件后消失。

现在 ③ 是一个**真实端口**：它插入到聚焦控件的当前光标处，并用「值/选区是否真的变了」
作为返回 `true` 的判据。**标签名只决定「由哪个端口接」，不再决定「文本去哪」** ——
失败会继续降级，不会静默吞掉。这是允许 ③ 的前提，也是它与旧启发式的本质区别。

## 3. 各端口的插入实现

| 端口 | 注册方 | insert |
| --- | --- | --- |
| `agent-composer` | `RichComposer`（已有 Tiptap 实例） | 复用 `insertIntoComposer(tabKey, tabId, text)` |
| `terminal` | `TerminalView`（每个 pane 一个端口） | `pasteToTerminalSession(entry.sessionId, text)`（PTY sessionId 由 strategy 持有） |
| `code-editor` | 编辑器挂载处（CodeMirror view 就绪） | `view.dispatch(view.state.replaceSelection(text))` |
| 文本控件（合成） | 不注册，落点处合成 | 见 §3.1 |

### 3.1 文本控件插入

```ts
function insertIntoTextControl(el: HTMLInputElement | HTMLTextAreaElement, text: string): boolean {
  el.focus();
  const before = el.value;
  const beforeSel = el.selectionStart;
  // WebKit/Chromium 支持且保 undo（React 受控组件也走这条：它派发真实 beforeinput/input）
  const ok = document.execCommand('insertText', false, text);
  if (!ok) return false;
  return el.value !== before && el.selectionStart !== beforeSel;
}
```
`contenteditable`（如未来富文本外的地方）走 `execCommand` 同一路径；失败返回 false 继续降级。
**不**手写 value setter + 手工 dispatch（那条路会绕过 React 的受控状态，产生「界面有、state 没有」）。

## 4. 失败可见（R4）

`useFileDrop(options?: { onUnhandled?: (text: string) => void })`：
- 全部端口失败 → `onUnhandled?.(text)` + `console.debug('[file-drop] no port accepted', { tried })`。
- `ProjectView` 注入 `showToast`（已持有），文案：「这里不能插入路径」。
- `file` 域不 import UI：只接受回调（R5）。

## 5. 失败与边界矩阵

| 场景 | 期望 |
| --- | --- |
| 终端在右侧 dock（非 p1） | ⑥ 命中该 pane 的端口 → 插入（本 bug 修复） |
| 分屏两个终端 | 优先 `isActive()` 的 pane；都激活（不可能）→ 顺序第一个 |
| 拖到编辑器上 | ① 命中 → 插到 CodeMirror 光标处 |
| 焦点在 commit message 输入框，拖到窗口任意处 | ②/③ 命中 → 插到该输入框光标处 |
| 拖到空白区（无任何端口） | ⑦ → toast + debug 日志，不再静默 |
| 端口 insert 返回 false（PTY 未就绪） | 继续下一个候选；最终 ⑦ |
| 同一端口 StrictMode 双挂载 | 引用计数，卸载只减；先卸载不得摘掉仍存活的 |

## 6. 权衡

| 选择 | 代价 | 为什么仍选它 |
| --- | --- | --- |
| 端口由渲染方注册（而非缓存扫描） | 每个渲染点加一行注册 | pane/PTY/激活态只有渲染方知道；扫描会重新引入「猜」 |
| pointer ① 用 `dragover` 记坐标 + `elementFromPoint` | 一个 document 级监听 | HTML5 拖拽的 `drop` 事件我们刻意不用（`dragend` 更可靠、无需 preventDefault），坐标是唯一低耦合手段 |
| `execCommand('insertText')` | 已废弃 API | 唯一既保 undo 又能驱动 React 受控组件的同步路径；失败可检测并降级 |
| 未命中走 toast | 多一个用户可见提示 | 静默失败是这次事故的主因（查了半天） |

## 7. 兼容与回滚

- 纯前端；无 wire / 事件名 / 存储变化。
- 回滚 = revert 单个 commit：回到 composer → 终端两段仲裁（终端 pane 写死 p1 的缺陷一并回来）。
- 风险：`execCommand` 在非 WebKit 内核（未来 Linux/Windows WebView2 也是 Chromium，支持）
  仍失败 → 返回 false → 降级到下一个端口 → 最终 toast（不会更差）。
