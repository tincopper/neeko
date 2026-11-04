# 交互模式指南

> 本项目中复杂交互（拖拽、手势等）的实现模式。

---

## 概述

本项目使用 **@dnd-kit** 库实现拖拽排序。之前的自研 Pointer Events 方案因存在抖动和列表边缘无法落点的 bug，在 2026-06-02 被替换。

---

## 场景：项目列表拖拽排序（@dnd-kit，2026-06-02）

### 1. 背景

- HTML5 `draggable` + `onDragStart/onDragOver/onDrop` 在 Windows/Tauri 环境下与 `data-tauri-drag-region` 冲突。
- 自研 Pointer Events 方案存在：CSS transition 与 pointermove 冲突导致抖动；`document.elementsFromPoint` 在列表边缘返回 null 导致无法排序。
- 最终选择 `@dnd-kit`：hook-based API、内置 collision detection、无 DOM 查询、支持键盘/触摸。

### 2. 依赖

```
@dnd-kit/core       — DndContext, closestCenter, DragEndEvent
@dnd-kit/sortable   — SortableContext, useSortable, verticalListSortingStrategy
@dnd-kit/modifiers  — restrictToVerticalAxis, restrictToParentElement
@dnd-kit/utilities  — CSS.Transform.toString
```

### 3. 核心架构

```
┌───────────────────────────────────────────────────┐
│  DndContext (每个独立列表一个)                      │  ← 拖拽事件总线 + collision detection
│  modifiers: restrictToVerticalAxis,               │
│             restrictToParentElement               │
│  onDragEnd: (event) => handler(active.id, over.id)│
├───────────────────────────────────────────────────┤
│  SortableContext                                  │  ← 排序容器，声明 items 列表
│  items: projects.map(p => p.id)                   │
│  strategy: verticalListSortingStrategy            │
├───────────────────────────────────────────────────┤
│  useSortable({ id })                              │  ← 每个可排序项目卡片
│  返回: attributes, listeners, setNodeRef,         │
│        transform, transition, isDragging          │
└───────────────────────────────────────────────────┘
```

### 4. 每个独立排序区域有自己的 DndContext

| 区域 | DndContext 位置 | onDragEnd 处理器 |
|------|----------------|-----------------|
| Local 项目 | `ProjectsPanel.tsx` | `useLocalProjects.handleDragEnd(draggedId, targetId)` |
| WSL entry 内 | `RemoteItems.tsx > WSLItem` | `useWslProjects.handleWslDragEnd(entryId, draggedId, targetId)` |
| Remote entry 内 | `RemoteItems.tsx > RemoteItem` | `useRemoteProjects.handleRemoteDragEnd(entryId, draggedId, targetId)` |
| 左右 DockBar（**共用同一个**） | `DockBarDnd.tsx`（DockLayout 顶层） | `onMoveView(view, slot, index)` → `dockStore.moveView` |

跨 entry 拖拽不支持（每个 entry 独立的 DndContext 天然隔离）。

#### 偏差：左右两条 DockBar 必须共用**一个** DndContext

上表最后一行是本节的**有意例外**（2026-11-03 `11-03-dock-placement` P0）：

- 需求是「图标可从左栏拖到右栏」，而 **dnd-kit 不支持跨 `DndContext` 拖拽**。拆成两个 context
  的话，跨栏移动在构造上不可能 —— 不是难写，是库层面没有事件通路。
- 因此「一个排序区域」的判据不是「一块 DOM」，而是「一次排序操作能触及的 id 集合」：
  跨栏移动使左右两栏构成**同一个**排序语义区域。
- 落点解析保持纯粹：`resolveDropTarget(overId, slotViews)` 只把 id 翻译成 `(slot, index)`
  （栏容器 marker → 追加；某条图标 → 它所在栏 + 槽内下标）。**id 里不编码槽位** ——
  那样槽位就有了第二份表示，图标换边后还可能读到过期值。
- 不得再拆的理由反过来也成立：两个 context 各自只能看见自己那一栏的 droppable，
  `over` 永远是本栏元素（含本栏容器），于是「拖出去」只能被解释成「拖回本栏末尾」。

键盘等价操作不走 dnd 的 `KeyboardSensor`，而是在按钮上直接给 `Alt+←/→`
（`DockBarButton`）：`KeyboardSensor` 的激活键是 Space/Enter，与按钮自身的激活语义
叠在同一节点上就说不清该发生哪一件事（同 §4 上方「只接指针」的理由）。

### 5. 可排序卡片组件契约

```tsx
// ProjectItem.tsx / ConnectionProjectCard.tsx
const {
  attributes,  // aria 属性
  listeners,   // pointer/keyboard event handlers
  setNodeRef,  // DOM ref 绑定
  transform,   // 当前拖拽 transform
  transition,  // CSS transition string
  isDragging,  // 是否正在被拖拽
} = useSortable({ id: project.id });

const style = {
  transform: CSS.Transform.toString(transform),
  transition: transition ?? undefined,
};

return (
  <div
    ref={setNodeRef}
    style={style}
    className={cn(
      "relative mb-0.5 rounded-md overflow-visible",
      isDragging && "opacity-50 scale-[1.02] shadow-lg shadow-black/20 z-50",
      !isDragging && "cursor-grab",
    )}
    {...attributes}
    {...listeners}
  >
    {/* 卡片内容 */}
  </div>
);
```

### 6. 域 Hook 排序算法

本地、WSL、SSH 远程的排序逻辑结构一致：

```ts
function handleDragEnd(draggedId: string, targetId: string) {
  if (draggedId === targetId) return;
  const draggedIndex = items.findIndex(i => i.id === draggedId);
  const targetIndex = items.findIndex(i => i.id === targetId);
  if (draggedIndex < 0 || targetIndex < 0) return;

  const newItems = [...items];
  const [dragged] = newItems.splice(draggedIndex, 1);
  newItems.splice(targetIndex, 0, dragged);
  // persist...
}
```

**WSL/SSH 特殊行为**：
- 拖拽范围限定在同一 entryId 内（独立 DndContext 保证）
- 持久化通过 `saveSession` 而非 `reorderProjects` API

### 7. Tests Required

| 测试目标 | 断言点 |
|---------|--------|
| `handleDragEnd`（本地） | 正常排序；同位置不操作；持久化 `reorder_projects` 被调用 |
| `handleWslDragEnd` | 同 entryId 内排序；`saveSession` 被调用 |
| `handleRemoteDragEnd` | 同 entryId 内排序；`saveSession` 被调用 |

### 8. Anti-patterns

#### ❌ 使用 HTML5 Drag API（Windows/Tauri 冲突）

```tsx
// 不要这样做
<div draggable onDragStart={...} onDragOver={...} onDrop={...} />
```

#### ❌ 自实现 Pointer Events 拖拽

```tsx
// 不要这样做 — 已被替换
// document.elementsFromPoint + setPointerCapture + manual transform
```

#### ❌ 在 DndContext.onDragEnd 中做复杂逻辑

```tsx
// 不要这样做
onDragEnd={(event) => {
  // 复杂的 splice + API call + state update
}}
```

应将排序逻辑封装在域 hook 中，DndContext 只负责提取 `active.id` / `over.id` 并调用 handler。

## 网络操作超时模式

所有 git 网络操作（push/pull/fetch）必须使用 `withTimeout` 包装，防止后端阻塞时 UI 永久挂死：

```typescript
import { withTimeout } from '@/shared/utils/withTimeout';

// 网络操作：60 秒超时
await withTimeout(commands.push(false), 60_000, 'push');
await withTimeout(commands.pull(), 60_000, 'pull');

// 本地操作：30 秒超时
await withTimeout(commands.commitFiles(files, message), 30_000, 'commit');
```

当前已覆盖的网络操作路径（需保持同步）：

| 触发路径 | 文件 | push | pull | fetch |
|---------|------|------|------|-------|
| Git Control → Changes | `GitCommitPanel.tsx`（由 `GitControlPanel` 挂载） | ✅ | ✅ | ✅ |
| CommitDialog | `CommitDialog.tsx` | ✅ | ✅ | - |
| ProjectsPanel 右键 | `ProjectsPanel.tsx` | ✅ | ✅ | - |

---

## 键盘快捷键按 Tab 域限定

### 背景

合并后 Dock 面板（如 GitControlPanel）包含多个 Tab，各 Tab 有各自的键盘快捷键。需要在全局 `keydown` 监听中根据当前激活 Tab 做域限定，防止快捷键跨 Tab 误触。

### 模式

```tsx
const handleKeyDown = useCallback((e: KeyboardEvent) => {
  // 1. 让出非当前 Tab
  if (tab !== 'history') return;

  // 2. contentEditable / input guard
  const target = e.target as HTMLElement;
  if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return;
  }

  // 3. 快捷键处理
  switch (e.key) {
    case 'c': handleCopyDiff(...); break;
    case 'k': handleMoveUp(); break;
    case 'j': handleMoveDown(); break;
  }
}, [tab, ...]);
```

### 规则

1. **第一道关卡**：`tab !== 'xxx'` return，非当前 Tab 直接放行
2. **第二道关卡**：`contentEditable / INPUT / TEXTAREA` 守卫，防止编辑器内触发热键
3. **依赖数组包含 `tab`**：确保 `keydown` 回调能感知 Tab 切换
4. **顶层解绑**：Wrapper 的 `useEffect` 返回 `removeEventListener` 清理

### 反模式

❌ 非当前 Tab 的子组件依然绑定全局 `keydown` 监听：

```tsx
// Changes tab 下 GitLogPanel 依然监听 J/K → 按键被误吞
```

❌ 缺少 contentEditable 守卫：

```tsx
// 用户在 commit message 输入框按 'j' → 触发了 GitLog 光标移动
```

---

## 终端 IME 输入：精确抑制 compositionend 后的 onData

### 背景

xterm.js 的 `onData` 与浏览器 `compositionend` 存在时序问题。如果 `compositionend` 后**无条件抑制下一个 `onData`**，按空格确认 IME 候选时，紧随其后的空格 `onData(' ')` 会被吞掉，表现为终端里空格键失效。

### 正确做法

记录 `compositionPendingText`，仅抑制内容与 pending text 完全相同的 `onData`。

```ts
let compositionPendingText: string | null = null;

compositionStartHandler = () => {
  composing = true;
  compositionPendingText = null;
};

compositionEndHandler = (e: CompositionEvent) => {
  composing = false;
  const text = e.data;
  if (text) {
    compositionPendingText = text;
    sendInput(text);
  }
};

term.onData((data) => {
  if (composing) return;

  if (compositionPendingText !== null) {
    if (data === compositionPendingText) {
      compositionPendingText = null;
      return;
    }
    compositionPendingText = null;
  }

  sendInput(data);
});
```

### 错误做法

```ts
// 不要这样做 —— 会吞掉 IME 确认后紧随的空格
suppressNextOnData = true;
setTimeout(() => {
  suppressNextOnData = false;
}, 0);
```

### 测试断言

| 场景 | 期望行为 |
|------|---------|
| 普通空格 `onData(' ')` | 正常转发到 PTY |
| `compositionend('中')` 后 `onData(' ')` | 空格正常转发，不被抑制 |
| `compositionend('中')` 后 `onData('中')` | 被抑制，避免重复发送 |

---

## WKWebView 拼音缓冲区空格剥离（2026-08-07）

### 背景

macOS WKWebView（Tauri WebView）中，中文拼音输入法在组字中输入 `haihao` 后按中英文切换键放弃组字时，WebKit 会把未确认的拼音缓冲区以**分词空格**形式提交（`hai hao`）。原生 macOS app 走 `NSTextInputClient` 会自动去空格，WebView 不会，导致终端显示 `hai hao`。实现位于 `terminalInput.ts`。

### 正确做法

判定「被放弃的拼音缓冲区」（纯 ASCII 可打印 + 含空格 + 去空格后非空），对 `compositionend` 与 `onData` 两路径剥离空格发送；`compositionPendingText` 仍记录**原始带空格文本**，使 xterm 随后发出的 `onData('hai hao')` 被既有去重逻辑拦截。

```ts
/** 真实 CJK 提交含非 ASCII 字符，不匹配；正常单字符空格（' '）不匹配；
 *  全角空格（\u3000）兼容：部分 WebView 平台可能以全角空格做分词分隔。 */
export function isAbandonedImeAsciiBuffer(data: string): boolean {
  return /^[\x21-\x7e \u3000]+$/.test(data) && /[ \u3000]/.test(data) && data.trim() !== '';
}
export function stripImeSegmentationSpaces(data: string): string {
  return data.replace(/\s+/g, '');
}
```

### 反模式

❌ **无条件剥离空格**：xterm 会把**粘贴文本整段**通过 `onData` 发出（shell 未启用 bracketed paste 时），`git commit -m "hello world"` 会被误判为 abandoned buffer 而剥离成 `gitcommit-m"helloworld"`，破坏终端最常用操作。

修复：capture 阶段 `paste` 事件置标记（仅当 `event.target === textarea`，避免多终端共享 document 监听互相污染），`onData` 消费该标记时原样转发；`dispose` 移除监听。该标记为单次消费，组字中粘贴的极端情况会残留为「本次不剥离」，仅退化为不修复，不破坏正确性。

### 测试断言

| 场景 | 期望行为 |
|------|---------|
| `compositionend('hai hao')` | `sendInput('haihao')`（空格剥离） |
| 剥离后紧随 `onData('hai hao')` | 被去重，不重复发送 |
| 无 compositionend，`onData('hai hao')` | `sendInput('haihao')` |
| 粘贴 `git commit -m "hello world"` 后 `onData(同串)` | 原样转发，不剥离 |
| 其他终端的 paste 事件 | 不影响本终端拼音剥离 |
| 中文 `'中'` / 纯空格 `' '` / 空串 | 不匹配 abandoned buffer，不受影响 |
| 全角空格分隔 `'hai\u3000hao'` | 判定命中，剥离为 `'haihao'` |

### 共享工具与跨宿主扩展（2026-08-07）

同一 WebView 级行为影响 **所有文本输入**（终端 textarea、CodeMirror contenteditable、普通 input/textarea）。判定与剥离函数已抽为共享模块，供三类宿主复用：

**`src/shared/utils/ime.ts`**（单一事实源）：
```ts
export function isAbandonedImeAsciiBuffer(data: string): boolean;
export function stripImeSegmentationSpaces(data: string): string;
```
`terminalInput.ts` 改为 `import` + 本地 `export { ... }`（re-export 保持测试对 `'../terminalInput'` 的 import 兼容）。

**平台行为（三端一致性）**：该修复面向 WKWebView 系（macOS 与 Linux WebKitGTK，均可能产生半角/全角分词空格）。Windows WebView2 无此行为，但判定正则只匹配「纯 ASCII 可打印 + 半角/全角空格」，正常中文、单空格、空串均不命中，误伤面为零，无需平台门控。

**CodeMirror 扩展 `imeSpaceGuard()`（`src/shared/utils/codemirrorIme.ts`）**：
- 挂到 `EditorView.domEventHandlers` 的 `compositionend`。**签名是 `(event, view)`**（不是 `(view, e)`）。
- compositionend 派发时从光标 head 回退 `data.length`，核对 `view.state.doc.sliceString(from, head) === data` 才替换为剥离版本；不匹配跳过（防误伤光标处恰好相同的既有文本）。
- **时序坑**：`@codemirror/view` 内部 `observers.compositionend` 先执行且**只调度异步 flush**（不读 DOM），因此 handler 同步阶段 `view.state` 可能尚未包含 `data`。实现须先同步 `tryFix()`，失败则 `queueMicrotask` 延迟重试一次（在 flush 之后）；`tryFix` 内 try-catch 防御 view 销毁。
- 接入点：`FileViewer.tsx`、`MarkdownEditor.tsx` 的 `extensions` useMemo；必须放在 useMemo 内（保持扩展引用稳定）。

**通用 hook `useImeSpaceGuard<T>`（`src/shared/hooks/useImeSpaceGuard.ts`）**：
- 返回 `onCompositionEnd`，挂到 input/textarea 上。命中 abandoned buffer 时以 `selectionStart` 为锚点回退 `data.length` 定位（IME 提交总是发生在光标处，与 CodeMirror 端 head 回退保持一致；**禁止用 `lastIndexOf`**——值中已存在的相同文本会导致修错位置），核对原文一致后替换 DOM value，再 `dispatchEvent(new InputEvent('input', { bubbles: true }))` 驱动 React 受控组件 `onChange` 同步 state（React onChange 监听冒泡的 input 事件）。
- 接入约定：`ui/Input.tsx` 的 Input/Textarea 已内置（guard 先、父级 `onCompositionEnd` 后）。其他 raw textarea（Git commit、PR 评论、LSP 配置、MCP/Prompt 编辑等）逐个合并 guard 回调。

### 扩展反模式

❌ **假定 compositionend 时 CodeMirror 文档已包含 `data`**：真实 WKWebView 时序下内部 observers 尚未 flush，同步核对必失败，guard 静默失效。测试若预先构造「doc 已含 data」会恰好绕过该时序而假绿。

❌ **为 CodeMirror 或 input 无条件剥离空格**：与终端一致，必须先用 `isAbandonedImeAsciiBuffer` 前置过滤（中文、单空格、空串、粘贴含空格文本均不命中），否则破坏正常输入。

---

### 9. Modifiers 说明

- `restrictToVerticalAxis`：锁定垂直轴，防止水平漂移
- `restrictToParentElement`：限制拖拽范围在父容器内，防止拖出可见区域

---

## editor TabItem：关闭按钮 pointer 隔离

### 背景

`TabItem` 根 div 同时挂载 dnd-kit `listeners`（拖拽排序）与关闭按钮 `×`（子元素）。`PointerSensor` 的 `activationConstraint: { distance: 5 }` 只控制何时开始拖拽，但 `×` 上的 pointerdown 仍会冒泡到父 div 被 PointerSensor 捕获。用户在 `×` 上轻微移动（≥5px）会触发拖拽重排而非关闭，体感为「关错了 / 没关成」。

### 正确做法

在关闭按钮 `×` 上 `onPointerDown` 阻止冒泡，让 dnd-kit 忽略关闭按钮的指针按下：

```tsx
<button
  onPointerDown={(e) => e.stopPropagation()}  // 阻断 dnd-kit 捕获
  onClick={handleClose}
  title="Close tab"
>
  ×
</button>
```

`handleClose` 的 `e.stopPropagation()` 只在 click 阶段生效，dnd-kit 在 pointerdown 阶段就开始监听，所以必须额外阻断 pointerdown。

### 反模式

❌ 只在 `onClick` stopPropagation，不处理 pointerdown -- `×` 上轻微移动仍触发拖拽，关闭被劫持。

### 泛型化 + renderLeading 多态

`TabItem` 泛型化为 `<T extends TabLike>`（`{ id; title }`）纯展示组件，editor 特有的图标/状态点逻辑通过 `renderLeading?: (tab) => ReactNode` 注入（editor 用 `renderEditorTabLeading`）。`React.memo` 通过 `as unknown as typeof TabItem` 保留泛型签名。

### 测试断言

| 场景 | 期望行为 |
|------|---------|
| reorderable 模式下点 `×` | `onClose` 被调用，不触发拖拽 |
| `×` 上 pointerdown 后移动 | 不触发 reorder |

---
## 文件/目录拖拽到输入框（HTML5 dragend + 身份仲裁双目标，2026-10-13 重写）

### 1. 背景

文件树中的节点（文件 + 目录）支持拖拽到输入框：松开后将被拖拽的路径粘贴到目标输入框。与 dnd-kit 拖拽排序不同，此场景使用原生 HTML5 `draggable` + `dragend` 事件（不冲突、无需 `preventDefault`、保证 fire）。

> **本节为何重写**：原版（2026-08-17）描述的「焦点在文本元素 ⇒ 判定为 agent 输入」这条启发式
> 已被实测证伪并删除，且 `INSERT_TO_AGENT_INPUT_EVENT` 已整体退出（决议 Q5=A）。
> 留着它 = 文档与实现相反，读者会照抄一个静默失效的形态。旧组件名也写错了
> （`FileTreeNode.tsx` 不存在，实为 `FileTreeRow.tsx`）。

### 2. 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│  FileTreeRow.tsx                                             │
│  draggable={!!projectId}  onDragStart → setDragFile(path, projectId)
│  （文件 + 目录均触发，is_dir 不门控）                          │
└──────────────────────┬──────────────────────────────────────┘
                       │ 模块级 pendingDrag: { path, projectId }
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  useFileDrop hook（ProjectView 顶层挂载一次）                 │
│  document.addEventListener('dragend', handleDragEnd)         │
│                                                              │
│  session = activeWorkspaceSession(projectId)   ← 身份唯一来源 │
│  Priority 1: insertToSessionAgent(session, text)             │
│              （agent-chat/api/insertToSessionAgent.ts 编排）   │
│              ├ agent-chat composer（已登记在注册表）          │
│              └ 降级 Agent CLI 终端 tab（terminal + agentId）   │
│  Priority 2: insertToSessionTerminal(session, text)          │
│              └ 本 session 前台终端（无前台则视觉序（布局 tabIds）首个）│
└─────────────────────────────────────────────────────────────┘
```

### 3. 设计要点

1. **`dragend` 而非 `drop`**：`dragend` 保证在源元素上 fire（无论落点在哪），无需 `preventDefault`，无 `data-tauri-drag-region` 冲突。
2. **模块级 `pendingDrag`**：`setDragFile` 写入、`handleDragEnd` 消费并清零，天然配对。
3. **仲裁走身份，不走焦点**：目标由 `terminalRouting` 的唯一前台仲裁给出（决议 R1/Q2），
   与「此刻哪个元素有焦点」无关。
   **「前台」的唯一权威是布局**（2026-10-15 单源化）：`tabs[key].activeTabId` 与 `Tab.order`
   两个字段已**删除**；前台 = `editorLayout[key].groups[activeGroupId].activeTabId`，顺序 = 各组的
   `tabIds`。二者的唯一派生点是 `src/shared/store/editorTabSelectors.ts`
   （`selectActiveTabId` / `selectOrderedTabs`）。
   历史缺陷：分屏迁移与换 pane 只改布局而不更新那两个投影时，编辑器高亮与仲裁对「前台」给出
   两个答案 —— **分屏后拖文件总落到上一个 pane 的输入框**（回归用例见 `editorStore.test.ts`）。
   删字段后该缺陷在**编译期**不可再表示。
4. **路径格式化**：统一 `path + ' '`（尾部空格，方便继续输入），不自动提交（无 `\r`），不额外加引号/转义。

### 4. 组件契约

```tsx
// FileTreeRow.tsx —— 文件 + 目录均可拖动，is_dir 不门控
const handleDragStart = useCallback(
  (e: React.DragEvent) => {
    if (!projectId) return;            // 仅 projectId 缺失时阻止
    e.dataTransfer.effectAllowed = 'copy';
    setDragFile(node.path, projectId);
  },
  [projectId, node],                    // 依赖不含 node.is_dir
);

// <div draggable={!!projectId} onDragStart={handleDragStart} … />
```

```ts
// useFileDrop.ts —— 两个分支都走唯一仲裁，不再有代理判据
export function useFileDrop(): void {
  useEffect(() => {
    const handleDragEnd = () => {
      if (!pendingDrag) return;
      const { path, projectId } = pendingDrag;
      pendingDrag = null;

      const session = activeWorkspaceSession(projectId);
      const text = path + ' ';

      // Priority 1: agent 目标（composer 优先 → 降级 Agent CLI 终端）
      // Priority 2: 本 session 的前台终端
      if (insertToSessionAgent(session, text).ok) return;
      insertToSessionTerminal(session, text);
    };

    document.addEventListener('dragend', handleDragEnd);
    return () => document.removeEventListener('dragend', handleDragEnd);
  }, []);
}
```

### 5. 反模式

#### ❌ 用「焦点在文本元素」判定 agent 输入（已删除的缺陷）

```ts
// 不要这样做 —— 该判据在终端聚焦时恒为 true
const activeEl = document.activeElement;
if (activeEl && isTextInputElement(activeEl)) { /* 投给 agent */ }
```

xterm 的输入载体本身就是 `<textarea class="xterm-helper-textarea">`（且 attach 时调
`entry.term.focus()`），所以「焦点在 textarea」**不能区分 agent composer 与终端**。
旧实现据此分流，结果是文本被投给一个零监听者的 DOM 事件后丢弃 —— 拖到 agent 输入与拖到
终端**两端都是静默 no-op**，Priority 2 在最主要的场景下永不执行。

#### ❌ 用 DOM CustomEvent 做「必须知道成败」的投递

```ts
// 不要这样做 —— dispatchEvent 的返回值只表示「有无 preventDefault」，不表示「有无接收者」
window.dispatchEvent(new CustomEvent(SOME_INSERT_EVENT, { detail: { text } }));
```

需要「有人接住了吗」就用身份注册表（`agent-chat/api/agentInputRegistry.ts`，与
`editor/api/aiActionRegistry.ts` / `editorViews.ts` 同构：身份键 + handler + 引用计数卸载 +
未命中返回 false）。`INSERT_TO_AGENT_INPUT_EVENT` 有三个派发点、**全历史零个监听者**
（`git log --all -S"addEventListener(INSERT_TO_AGENT_INPUT_EVENT"` → 0 条），
而派发方判的是「函数存在吗」（恒真），于是连 clipboard 兜底都进不去。
护栏 A4 拦「声明了没人听的 `neeko:*` 事件」，护栏本体见
`tools/guards/checks/check_terminal_foreground_arbitration.py`。

#### ❌ 用 `drop` / `onDrop` 替代 `dragend`

```tsx
// 不要这样做 — drop 在源元素上不 fire（落点不在同一元素时丢失事件）
<div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()} />
```

#### ❌ 在 handleDragStart 中区分文件/目录

```ts
// 不要这样做 — 目录与文件应同等对待
if (node.is_dir) return;
```

路径是 opaque 字符串，终端与 composer 对文件/目录路径的处理一致（无需 shell 转义，直接写 PTY / 插入文本）。

#### ❌ 在消费侧自己找「首个终端」

```ts
// 不要这样做 — 这是同一问题的第二套实现（护栏 A1/A2 会拦）
const tabs = useEditorStore.getState().tabs[session.key];
const target = tabs.tabs.find((t) => t.data.kind === 'terminal');
```

一律走 `foregroundTerminalTab` / `foregroundAgentCliTab`（视觉序（布局 `tabIds`），唯一实现处）。

#### ❌ 路径加引号或尾部斜杠

```ts
// 不要这样做 — 破坏用户连续输入
insertToSessionTerminal(session, `"${path}" `);  // 多余引号
insertToSessionTerminal(session, `${path}/`);    // 多余斜杠（目录）
```

### 6. 测试断言

| 场景 | 期望行为 |
|------|---------|
| 文件 / 目录节点 `draggable` 属性 | `"true"`（projectId 非空时；两者一致） |
| 拖拽目录 → `setDragFile` | `setDragFile('src', projectId)` |
| `projectId` 为空 | 节点 `draggable="false"`，不触发 `setDragFile` |
| agent 目标命中（composer 或 Agent CLI） | `insertToSessionAgent` 返回 ok → **不调**终端分支 |
| agent 目标不可用 | 落 `insertToSessionTerminal`（同 session 前台终端） |
| **终端正被聚焦**（xterm helper textarea） | 终端分支**仍然执行**（反证 `isTextInputElement` 已删） |
| 普通 textarea 聚焦（commit message 等） | 不劫持：按 agent → terminal 顺序仲裁 |
| 两分支收到的身份 | 同一个 `activeWorkspaceSession(projectId)` 对象（非各算一遍等价键） |
| 文本形态 | `path + ' '`，无引号 / 无尾斜杠 / 无 `\r` |
| 无 pendingDrag / 第二次 dragend | 不重复投递 |
| hook 卸载后 dragend | 不响应（监听器已摘） |

对应文件：`src/features/file/hooks/__tests__/useFileDrop.test.ts`（编排与生命周期）、
`src/features/file/components/__tests__/FilesPanel.test.tsx`（`draggable` 与 `setDragFile`）、
`src/features/terminal/components/__tests__/terminalRouting.test.ts`（仲裁 + 编排降级链）、
`src/features/agent-chat/api/__tests__/agentInputRegistry.test.ts`（注册表显式成败）。

## Composer 补全弹层与 chip token（Tiptap，2026-10-24 重写）

> **本节在 `10-24-composer-token-editor` 后重写。** 旧形态（textarea + 镜像高亮层 +
> `handleKeyDown → boolean` 自研消费契约）已被 Tiptap 富文本 composer 取代：
> 触发、过滤、键盘导航、chip 插入全部交给 `@tiptap/suggestion` 与 ProseMirror 事务。
> 保留下面的「历史形态」一小段，只作为**其他 textarea 场景**的通用思路参考 ——
> 不要照抄进 agent chat composer。

### 1. 为什么换编辑器（原理性上限，不是偏好）

textarea 里不可能内嵌 DOM 元素，所以「带图标、可整块删、类型化配色」的 chip 只能靠
**镜像层**模拟：textarea 文字透明 + 同排版 div 逐字渲染。该架构有两个死结：

1. **逐像素对齐**：镜像必须与透明文字完全同排版，因此 chip 内不能有任何宽度差异
   （图标一放，token 之后全部错位）—— 视觉上限就是「彩色文字」。
2. **WebKit IME**：透明 textarea 的 CJK 组合文本在 WKWebView 下会腐坏（实测豆腐块 /
   乱码），需要 `-webkit-text-fill-color` + 组合期重同步 + 镜像 `visibility` 三层加固。

换 contenteditable 后两条都消失：chip 是真实节点，组合文本由 ProseMirror 的
DOM observer 直接观察。**这是删掉一层易腐中间层，不是新增一层。**

### 2. 结构（含 chip 种类的单一事实源）

```
composer/editorSchema.ts    两套 Mention 实例（CommandChip / FileChip）+ docToPromptText
composer/suggestionWiring.ts  Suggestion × 2（'/' 与 '@'）+ 能力位门 + chip 插入
composer/PalettePopup.tsx     ComposerPalette 的 suggestion 桥接（高亮状态）
composer/RichComposer.tsx     EditorProvider + 键盘/草稿/空态投影
composer/editorRegistry.ts    (tabKey, tabId) → Editor，「外部投递」的唯一落地点
composer/submitComposer.ts    Enter 与发送按钮的**单一**提交实现
composer/ChipView.tsx         chip 的 node view（图标 + 类型化配色 pill）
composer/chipSpec.ts          **chip 种类的单一事实源**（触发符 · 节点名 · 序列化）
```

**新增一种 chip 只改一处**（`CHIP_SPECS` 加一条）。表里涵盖：触发符、ProseMirror
节点名、**属性定义**（HTML 往返自动生成）、HTML 类名、纯文本展示、chip 序列化、
以及「这个 chip 是否进 `files`」（`filePathAttr`）。`editorSchema` 按表**循环装配**
扩展（无逐条手写块），`suggestionWiring` 按 `kind` 索引 PluginKey 与数据源。

> 这是本任务自查时修掉的真实缺陷，两轮：
> 第一轮发现 `'/'` 与 `'@'` 在 **7 处**硬编码（两处 `char:`、`insertChip` 三元、
> `createPaletteRender` 的 kind 反推、字面量联合）；第二轮发现**收表只收了一半**
> —— 节点定义（属性 schema + renderHTML）与扩展数组仍逐条手写，`docToRequestFiles`
> 里还硬编码 `'fileChip'` / `'path'`。补全后判据才真正成立：
> **新增 chip 不应修改 `chipSpec.ts` 之外的任何 switch / 三元 / 手写扩展条目**。

**表必须自洽**（第三轮自查补的）：`attrs` 声明属性 schema（未声明的属性会被
ProseMirror 丢弃），`attrsOf` 负责插入时写值。两者一旦分家，坏法极隐蔽——曾有
`attrsOf` 多产出一个未声明的 `label`，于是所有 `?? attrs.label` 兜底**永不可达**
（读起来像有兜底，实际是死代码）。`chipSpec.test.ts` 用双向断言钉住
（不得多产、不得少产），并钉住「声明了 `filePathAttr` 就必须真的声明该属性」。

**序列化 ≠ 展示**：`displayText` 给人看（文件 chip 显示文件名），`toPromptText`
给 agent 看（必须是完整 `@path`，pi 才能定位）。两者不同源是**有意的**，不要
「统一」成同一个函数。

**分层**：`chipSpec` 不 import React / Tiptap 运行时；`editorSchema` 是纯 schema +
序列化层（`docToPromptText` / `docToRequestFiles` 可在 node 环境单测），
**不 import `ChipView`** —— chip 的 React node view 由装配点（`RichComposer`）
经 `buildComposerExtensions({ nodeViews })` 注入。把 React 拉进 schema 层会让
「序列化契约」的测试被迫跑在 jsdom + 图标生态里。

**schema 故意窄**：只有段落 / 文本 / 两种 chip，不引入加粗、标题、代码块。schema 越窄，
IME 与序列化的暴露面越小。

### 3b. 空内容判据必须唯一（`isComposerEmpty`）

「有没有内容」有两个消费点：发送前校验、发送按钮禁用。它们曾用**不同判据**——
按钮用 `editor.isEmpty`（ProseMirror 语义：有文本节点即非空），发送用
`promptText.trim()`——于是**只输入空格时按钮可点、点了什么都不发生**。

现在唯一实现是 `submitComposer.ts::isComposerEmpty(doc)`（取序列化后 trim），
按钮经 `onEmptyChange` 只做投影。

**测试分层的教训**：ChatComposer 层只拿到一个布尔，把判据换回 `editor.isEmpty`
那边用例**仍然绿**（实测）。有判别力的位置是判据本身 —— `submitComposer.test.ts`
直测 `isComposerEmpty`（空格 / 换行 / tab 算空，chip 算内容，且与
`docToPromptText` 逐例一致）。**别在只拿得到结果的层去测判据的对错。**

### 3c. 测试里程序化插入必须带 `emitUpdate: true`

Tiptap 的 `editor.commands.insertContent(text)` 程序化调用**默认不发 `update`
事件**（只有真实用户输入才发），而草稿持久化与 `onEmptyChange` 都挂在 `update` 上。
测试辅助里漏掉它 → 用例看到「什么都没发生」→ 假绿。

```ts
function typeText(editor: Editor, text: string) {
  editor.commands.insertContent(text, { emitUpdate: true }); // 必须
}
```

### 3. 序列化契约（pi 展开依赖，golden 锁死）

`docToPromptText(doc)` 是纯函数：命令 chip → `/name `，文件 chip → `@path `，
chip 自带**尾随空格**（因此插入 chip 时不要再插文本空格，否则双空格破坏形状）。
`editorSchema.test.ts` 用 golden 覆盖混排 / 相邻 chip / 末尾 chip / CJK + 路径分隔符 /
空文档。**任何改变该形状的改动都必须同时确认 pi 仍能展开命令。**

### 4. 受控回环：单向闸门

Tiptap 是非受控编辑器，而草稿的真相在 tab data 的 `composerDoc`。规则只有一条：
**`setContent` 只发生在「编辑器实例创建后恢复本 tab 草稿」这一次**（按实例身份判定，
StrictMode 重挂载下新实例各自恢复一次）；`onUpdate` → `mergeTabData({ composerDoc })`
**只出不进** —— store 回流永不回写编辑器，死循环在结构上不可达。

护栏：`RichComposer.test.tsx` 断言「恢复之后 `setContent` 全程调用次数 = 1」；
`composerWiring.test.ts` 断言 update handler 体内不出现 `setContent`。
变异验证：把 `setContent` 放进 update 处理器 → 回环用例立刻红。

### 4b. 附件：**一份表示**，`files` 是文档的投影（B 方案）

文件附件曾有第二份 state（`useChatAttachments.attachments`）：`@` 提及与附件按钮
都往里写。它与编辑器文档**没有任何同步** —— 用户退格删掉 `@path` chip 后，附件仍在
上方 chips 区，且照样随消息的 `files` 字段发出去（「以为移除了、实际没有」）。

现在文件只有一份表示：

| 入口 | 落到哪 |
| --- | --- |
| `@` 提及 | 编辑器 `fileChip` |
| 「Attach files」按钮 | `insertIntoComposer(tabKey, tabId, '@' + path)` —— **同一条路径** |
| 文件拖拽 | 同上（`insertIntoComposer`） |

请求的 `files` 由 `editorSchema.ts::docToRequestFiles(doc)` 投影得出（首现顺序去重）。
不变量：**chip 在文档里存在 ⇔ 该文件随消息发送**。护栏杆位：

- `editorSchema.test.ts` 的「files 是文档的投影」组（顺序 / 同名不同目录 / 去重 /
  **删 chip 即不再发送** / 空文档）
- `composerWiring.test.ts` 的「route the file picker through the editor」用例：
  视图层不得再出现 `addAttachment` / `fileCount`，`handleSend` 不得再用 `toRequestFiles`

`useChatAttachments` 因此只剩 skill 槽（skill 无文本表示，不能进文档），
且**只暴露 `skillCount` / `toRequestSkills`** —— `attachments` / `remove` 曾留在
出口但已无消费方（死接口），一并删除。**注意**：
当前没有 skill 附件生产者（无 `addSkill` 调用点），`skills` 恒为空 —— 那是后续
接 skill 选择器的任务，不要因为「反正恒空」把它删掉（后端 `ContextManifest.skills`
契约仍在）。

> 判据（可推广）：**同一事实的第二份表示只要无法与真相同步，就一定会分叉。**
> 这里真相是「用户在输入框里看得见、删得掉的东西」= 编辑器文档；任何绕过它的
> 附属 state 都是 bug 温床，而不是便利。

### 5. 外部投递走编辑器实例，不走 state

「往输入框塞文本」（文件拖拽、prompts 面板）在受控时代是 `setInput(...)`；换成非受控
编辑器后这条路**静默失效**（state 变了但编辑器不动）—— 正是本仓「函数存在但什么都不做」
的经典形态。正确做法：`editorRegistry` 按 `(tabKey, tabId)` 登记编辑器实例，
`insertIntoComposer` 命中则插入、未命中返回 `false` 让调用方降级（clipboard + toast）。
`composerWiring.test.ts` 钉住 `useAgentInputRegistration` 不再出现 `setInput`。

### 6. 能力位门控落在 `shouldShow`，不是条件注册扩展

`SessionStart.capabilities.commands` 为 false 时 `/` 不激活。实现是 suggestion 的
`shouldShow: () => pickSource() !== null`（运行时门），**不是**"把 slash chip 扩展
从 extensions 数组里拿掉"：能力位可能在 tab 挂载后才翻转（会话握手时序），条件注册会让
extensions 身份漂移 → 编辑器重建 → 打破上面那条 setContent=1 的单向闸门。

语义等价：位为 false 时 `items` 不被问、弹层不渲染；IPC 查询侧的门在
`useAgentCommands`（`enabled=false` 连查询都不发）。**禁止前端硬编码命令清单**
（护栏：`paletteSources.test.ts` 的 AC2 用例）。

### 6b. 弹层：分组 + 图标 + 多词搜索

弹层按**分组**渲染（`Skills / Commands / Extensions / Files`），每组带图标、标题与
计数；组顺序由 `PALETTE_GROUP_ORDER` 决定（不依赖数据到达顺序）。`highlight` 始终是
**扁平下标**（与 suggestion 引擎的 item 数组同序）—— 分组只改渲染结构，不改下标语义，
否则引擎选中与视觉高亮会分叉。

| 关注点 | 落点 |
| --- | --- |
| 分组归一 | `groupOfSource`：`prompt→command`、`skill→skill`、`extension→extension`、其余 `other` |
| 搜索 | `searchPaletteItems`：**按空格分词的每个 token 都必须命中**，不是整串子串 |
| 排序 | 命中 `label` 前缀的排前，其余保持数据源原序（不做模糊打分，顺序可解释） |
| 滚动 | 高亮行 `scrollIntoView({block:'nearest'})`（引擎只改下标，滚动是渲染层的职责） |
| 类型 | `PaletteKind` **就是** `chipSpec.ChipKind`（同一条轴）—— 不再有第二个同形类型 |
| 吸顶 | 分组标题 `position: sticky`，长列表滚动时始终知道在读哪一组 |

**为什么搜索要按 token**：直接子串匹配对多词输入是全灭的（`trellis cont` 匹配不到
`trellis-continue`、`chat composer` 匹配不到 `ChatComposer.tsx`），而用户搜索时几乎
总是打关键词而非完整标识符。命令的 `description` 与文件的目录片段也入关键词。

> 测试注意：jsdom 没有布局，`scrollIntoView` 由 `src/testing/setup.ts` 在
> `HTMLElement.prototype` 注入 `vi.fn()` 垫片；**要断言它被调用必须替换
> `HTMLElement.prototype` 上的那个**（`Element.prototype` 上赋值是静默失败的）。

### 7. 数据源复用（未变）

`paletteSources.ts` 的 `ComposerPaletteSource { kind, emptyText, getItems, onPick? }`
两件套原样保留：`/` 与 `@` 的差异只剩「数据从哪来」与「选中后做什么」。命令列表来自
`list_agent_commands`（按 agentId 缓存，会话期内不变），文件树来自 `readDirTree`
摊平（`@` 提及与附件弹窗共用一份）。

### 8. 键盘与 IME

- Enter 发送、Shift+Enter 换行；**弹层有候选时 Enter 归弹层**（AC7）。实现要点：
  PM 的 `someProp` 先跑 editorProps 再跑插件，所以发送分支必须**主动**问
  `controller.isPopupConsumingEnter()` 并让路 —— 不能假设「插件会先消费」。
- 候选为空时弹层只消费 Escape，Enter 回到发送（空态契约）。
- IME：ProseMirror 原生处理组合；`handleKeyDown` 里 `event.isComposing` 时直接放行。
  **不要**再叠一层自研 composition 拦截（与上述三层加固同族的过度补偿）。

### 9. 已退役符号（不得回潮）

`ComposerMirror` / `paletteHighlight`（`tokenizeHighlights`、`segmentHighlights`）/
`paletteTrigger` 的 `findTrigger`、`applySelection`、`triggerStartAt` / `.composer-mirror`
与 `.composer-token*` CSS / `.composer-textarea` 与组合期门控 CSS。

护栏：`composerWiring.test.ts` 的「retired textarea/mirror architecture」用例 ——
**剥注释后**扫描 `agent-chat/` 生产文件（注释里提「已删除」不算回潮，参照
quality-guidelines §18b）。

### 10. 对应测试

| 文件 | 覆盖 |
| --- | --- |
| `composer/__tests__/editorSchema.test.ts` | 序列化 golden（形状 / 空格 / CJK / 旧草稿迁移） |
| `composer/__tests__/RichComposer.test.tsx` | Enter 发送 / Shift+Enter / IME / 草稿恢复 / **回环 setContent=1** |
| `composer/__tests__/RichComposerSuggestions.test.tsx` | `/` 与 `@` 触发、↑↓、Enter 选中（AC7）、能力位门控（AC1）、Esc 恢复发送 |
| `composer/__tests__/ChipView.test.tsx` | chip 渲染 / 类型化配色 / 整块删 |
| `__tests__/ChatComposerPalette.test.tsx` | ChatComposer 接线：序列化交 onSend、按钮 disabled 派生、附件共存 |
| `__tests__/ComposerPalette.test.tsx` | 弹层骨架（纯展示 + 点击选中；键盘不在此层） |
| `__tests__/composerWiring.test.ts` | 能力位链路 / 回环结构 / 外部投递 / 退役符号 四处静态护栏 |

### 历史形态（textarea 时代，仅供其他纯文本场景参考）

旧契约是 `handleKeyDown(e) → boolean`：弹层先收、返回值即「是否已消费」，调用方据此
`preventDefault` 并短路发送；未打开或 IME 组合中恒返回 `false`。**只要输入载体仍是
textarea 且弹层是自己实现的状态机，这个契约就成立**（返回 `void` 会让调用方猜，猜错
就是 Enter 双触发）。agent chat 不再属于这个场景 —— 它由 suggestion 引擎承担。
