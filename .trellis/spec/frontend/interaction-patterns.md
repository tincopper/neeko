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

跨 entry 拖拽不支持（每个 entry 独立的 DndContext 天然隔离）。

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

## 文件/目录拖拽到输入框（HTML5 dragend + 双目标分发，2026-08-17）

### 1. 背景

文件树中的节点（文件 + 目录）支持拖拽到输入框：松开后将被拖拽的路径粘贴到目标输入框。与 dnd-kit 拖拽排序不同，此场景使用原生 HTML5 `draggable` + `dragend` 事件（不冲突、无需 `preventDefault`、保证 fire）。

### 2. 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│  FileTreeNode                                                │
│  draggable={!!projectId}                                    │
│  onDragStart → setDragFile(path, projectId)                 │
│  （文件 + 目录均触发，is_dir 不再门控）                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ 模块级 pendingDrag: { path, projectId }
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  useFileDrop hook（ProjectWorkspace 顶层挂载）                │
│  document.addEventListener('dragend', handleDragEnd)         │
│                                                              │
│  Priority 1: document.activeElement 是 textarea /            │
│              contenteditable / text input →                  │
│              dispatchEvent(INSERT_TO_AGENT_INPUT_EVENT)       │
│                                                              │
│  Priority 2: editorStore 激活 tab 是 terminal →              │
│              sendToTerminal(projectId, path + ' ', tabId)     │
└─────────────────────────────────────────────────────────────┘
```

### 3. 设计要点

1. **`dragend` 而非 `drop`**：`dragend` 保证在源元素上 fire（无论落点在哪），无需 `preventDefault`，无 `data-tauri-drag-region` 冲突。
2. **模块级 `pendingDrag`**：`setDragFile` 写入、`handleDragEnd` 消费并清零，天然配对。
3. **双目标分发**：优先判断焦点是否在文本输入元素（agent input），否则回退到 terminal tab。复用既有 `INSERT_TO_AGENT_INPUT_EVENT` 事件机制，agent 输入组件监听该事件接收路径。
4. **路径格式化**：统一 `path + ' '`（尾部空格，方便继续输入），不自动提交（无 `\r`），不额外加引号/转义。
5. **isTextInputElement 判定**：`TEXTAREA` → true；`INPUT` → 仅 `text`/`search`/`url`/空类型；`contenteditable=true` → true；其他（`checkbox`/`radio`/`button` 等）→ false。

### 4. 组件契约

```ts
// FileTreeNode.tsx
// 文件 + 目录均可拖动，is_dir 不再门控
const handleDragStart = useCallback(
  (e: React.DragEvent) => {
    if (!projectId) return;  // 仅 projectId 缺失时阻止
    e.dataTransfer.effectAllowed = 'copy';
    setDragFile(node.path, projectId);
  },
  [node.path, projectId],  // 依赖不含 node.is_dir
);

// JSX
<div
  draggable={!!projectId}  // 文件 + 目录均 true
  onDragStart={handleDragStart}
  ...
/>
```

```ts
// useFileDrop.ts
// 模块级 pendingDrag 存储
export function setDragFile(path: string, projectId: string): void {
  pendingDrag = { path, projectId };
}

// hook 内部分发
export function useFileDrop(): void {
  useEffect(() => {
    const handleDragEnd = () => {
      if (!pendingDrag) return;
      const { path, projectId } = pendingDrag;
      pendingDrag = null;

      // Priority 1: agent input（textarea / contenteditable）
      const activeEl = document.activeElement;
      if (activeEl && isTextInputElement(activeEl)) {
        window.dispatchEvent(
          new CustomEvent(INSERT_TO_AGENT_INPUT_EVENT, { detail: { text: path + ' ' } }),
        );
        return;
      }

      // Priority 2: terminal tab
      const entry = useEditorStore.getState().tabs[projectId];
      if (!entry) return;
      const activeTab = entry.tabs.find((t) => t.id === entry.activeTabId);
      if (!activeTab || activeTab.data.kind !== 'terminal') return;
      sendToTerminal(projectId, path + ' ', activeTab.id);
    };

    document.addEventListener('dragend', handleDragEnd);
    return () => document.removeEventListener('dragend', handleDragEnd);
  }, []);
}
```

### 5. 反模式

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

路径是 opaque 字符串，终端与 agent input 对文件/目录路径的处理一致（无需 shell 转义，直接写 PTY / 插入文本）。

#### ❌ 在 dispatchEvent 中硬编码事件名

```ts
// 不要这样做 — 事件名必须来自 @/shared/events 常量
window.dispatchEvent(new CustomEvent('neeko:insert-to-agent-input', ...));
```

#### ❌ 路径加引号或尾部斜杠

```ts
// 不要这样做 — 破坏用户连续输入
sendToTerminal(projectId, `"${path}" `, tabId);  // 多余引号
sendToTerminal(projectId, `${path}/`, tabId);   // 多余斜杠（目录）
```

### 6. 测试断言

| 场景 | 期望行为 |
|------|---------|
| 文件节点 `draggable` 属性 | `draggable="true"`（projectId 非空时） |
| 目录节点 `draggable` 属性 | `draggable="true"`（与文件一致） |
| 拖拽目录 → `setDragFile` 调用 | `setDragFile('/dir/path', projectId)` |
| `dragend` 时 textarea 聚焦 | `INSERT_TO_AGENT_INPUT_EVENT` 被 dispatch，`sendToTerminal` 不调用 |
| `dragend` 时 contenteditable 聚焦 | `INSERT_TO_AGENT_INPUT_EVENT` 被 dispatch |
| `dragend` 时 checkbox 聚焦 | 不走 agent input，回退到 terminal（非文本 input） |
| `dragend` 时 terminal tab 激活 | `sendToTerminal` 被调用，带 `path + ' '` |
| `dragend` 时无 pendingDrag | 不调用任何分发 |
| 第二次 `dragend`（pendingDrag 已清空） | 不重复分发 |
| `projectId` 为空 | 节点 `draggable="false"`，不触发 `setDragFile` |
