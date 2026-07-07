# Hook 指南

> 本项目中 Hooks 的使用方式。

---

## 概述

所有自定义 Hooks 位于 `src/hooks/` 扁平目录或 `src/features/<domain>/hooks/` 中。项目以 **React 内置 Hooks** 为主，并使用 **Zustand** 作为跨域共享状态源。项目没有外部数据获取库。所有后端通信通过 **Tauri IPC** 进行，通过 `src/features/<domain>/api/<domain>Api.ts` 中的 API wrapper 封装。

Hook 分两类：
- **领域 Hook**：管理特定领域状态（项目、WSL、SSH、Worktree）
- **编排 Hook**：从 `useAppContainer` 提取的横切逻辑（保存、Context 组装、快捷键同步）

---

## 自定义 Hook 模式

### 标准 Hook 结构

```tsx
// src/hooks/useToast.ts
import { useState, useRef, useCallback } from "react";

export function useToast() {
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: "info" | "error" = "info") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  return { toast, showToast };
}
```

### 关键模式

1. **命名导出函数**（非默认导出）：`export function useXxx()`
2. **用 `useCallback` 包裹回调**，保持引用稳定以配合 Props 与 Context Provider value
3. **用 `useRef` 管理可变状态**，适用于不需要触发重渲染的数据（计时器、缓存、当前值镜像）
4. **返回对象**，包含状态值和操作回调

### 交互 Hook 模式（拖拽、手势等）

项目列表拖拽排序已迁移至 `@dnd-kit` 库，不再使用自研 hook。卡片组件内直接调用 `useSortable`：

```tsx
const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
  useSortable({ id: project.id });
```

排序逻辑保留在域 hook（`useLocalProjects.handleDragEnd` 等），由父级 `DndContext.onDragEnd` 调用。

详见 [交互模式指南](./interaction-patterns.md)。

---

### 编排 Hook 模式

当容器层职责区域变得臃肿时，按领域拆分为小型编排 Hook：

```tsx
export function useAgentActions(params: {
  terminal: { fontSize: number; shell: string; fontFamily: string };
  handleOpenIde: (project: { id: string; selected_ide: string | null }) => Promise<void>;
  showToast: (message: string, type?: "info" | "error") => void;
}) {
  // 单领域职责：本地 Agent + IDE + 项目配置保存
}
```

**规则**：
- 编排 Hook 按领域命名，避免“全局回调大杂烩”
- 优先从 `useAppStore` 读取跨域状态，减少参数数量
- 仅暴露本领域回调，使用 `useCallback` 保持引用稳定

### Store 快照模式

全局事件处理器通过 `useAppStore.getState()` 读取最新快照，避免 stale closure 和大量 Ref 同步：

```tsx
// src/hooks/useKeyboardShortcuts.ts
useEffect(() => {
  const handleKeyDown = () => {
    const snapshot = useAppStore.getState();
    // 读取 snapshot.activeProjectId / snapshot.wslEntries / snapshot.selectProject
  };
  window.addEventListener("keydown", handleKeyDown, true);
  return () => window.removeEventListener("keydown", handleKeyDown, true);
}, []);
```

该模式用于跨域读取场景。领域状态直接写入 `useAppStore`。`useSyncToStore` 仅负责连接快照和快捷键依赖动作引用的同步，不再镜像 project/file 字段。

---

## 场景：FileView Hook 单源状态契约 2026-04-21

### 1. Scope / Trigger

- Trigger：文件树和 Tab 状态由 `useState` 持有并跨层透传，消费端难以统一，易产生双源读取。
- Scope：`useFileView`、`useAppContainer`、`FileActionsContext`、`AppLayout`、`FileViewer`。

### 2. Signatures

```ts
// src/hooks/useFileView.ts
export function useFileView(): {
  fileTree: FileNode[];
  tabs: FileTab[];
  activeTabId: string | null;
  activeTab: FileTab | null;
  activeFilePath: string | null;
  isLoading: boolean;
  error: string | null;
  loadFileTree(projectId: string): Promise<void>;
  openFile(projectId: string, filePath: string): Promise<void>;
  closeTab(tabId: string): void;
  activateTab(tabId: string): void;
  updateTabContent(tabId: string, content: string): void;
  saveFile(content: string): Promise<boolean>;
  clearFileView(): void;
}
```

### 3. Contracts

1. `useFileView` 不持有 `fileTree/fileTabs/activeFileTabId` 的本地 `useState`，统一使用 `useAppStore`。
2. `openFile` 的 tab 唯一键为 `tabId = \`${projectId}:${filePath}\``。
3. `activeFilePath` 由 `fileTabs + activeFileTabId` 派生并写回 store，禁止在组件层重复推导。
4. `FileViewer` 与 `AppLayout` 只读 store 状态，动作通过 `FileActionsContext` 下发。

### 4. Validation & Error Matrix

| 场景 | 输入 | 预期 | 错误处理 |
|------|------|------|---------|
| 打开重复文件 | 现有 `tabId` | 只切换激活 tab | 不触发 IPC |
| 打开新文件 | 新 `tabId` | 创建 tab 并激活 | IPC 失败写 `error` |
| 关闭活动 tab | `tabId` 命中活动项 | 激活相邻 tab 或置空 | 无 |
| 保存文件 | 活动 tab 存在 | 返回 `true` 并清除脏标记 | IPC 失败返回 `false` |

### 5. Good/Base/Bad Cases

- Good：`openFile` 新建 tab，`activeFilePath` 同步为目标路径。
- Base：连续切换 tab，`activeFilePath` 始终和 `activeFileTabId` 对齐。
- Bad：`saveFile` 在无活动 tab 时直接返回 `false`，不触发写文件命令。

### 6. Tests Required

- Hook 断言  
`openFile` 重复打开同一路径不增加 tab 数量。  
`closeTab` 关闭最后一个 tab 后 `activeFileTabId` 为 `null`。  
`updateTabContent` 后 `isDirty` 与原始内容比较一致。
- 集成断言  
`FileViewer` 调用 `onFileSave` 时根据返回值维持脏标记。  
`AppLayout` 切到 files 面板时触发 `onLoadFileTree(activeProjectId)`。

### 7. Wrong vs Correct

#### Wrong

```tsx
const [tabs, setTabs] = useState<FileTab[]>([]);
const [activeTabId, setActiveTabId] = useState<string | null>(null);
```

#### Correct

```tsx
const tabs = useAppStore((s) => s.fileTabs);
const activeTabId = useAppStore((s) => s.activeFileTabId);
useAppStore.setState({ fileTabs: nextTabs, activeFileTabId: nextId });
```

---

## 跨域 active-切换 lazy invoke 模式

当某项数据需要 per-active-target、按需获取（不批量预热），且三域（local / WSL / SSH）各有独立 active 概念时，用三个并列 effect 分别响应各自的 active 变化、写入同一张共用切片。

**实例**：`useAheadBehindSync`（`src/hooks/useAheadBehindSync.ts`）
- 一份 hook 同时挂三个 `useEffect`：分别监听 `useAppStore.activeProjectId`、`activeWslProject`、`activeRemoteProject`
- 每个 effect 在切换时单次 invoke 对应后端命令（`get_ahead_behind_command` / `wsl_get_ahead_behind` / `remote_get_ahead_behind`）
- 结果统一写到 `aheadBehind: Record<key, AheadBehind>`，key 由 `aheadBehindKey()` 派生（参见 `state-management.md` 跨域共用切片场景）

**契约**：
1. effect 仅在 active 切换时触发，不批量预热（避免 SSH 网络抖动放大成本）
2. 失败路径调用 `setAheadBehind(key, null)`，让消费侧不渲染陈旧 chip
3. 三个 effect 互不依赖；不要合并成一个"超级 effect" + 大型 switch
4. hook 在跨域容器（如 `ProjectsPanel`）顶层调用一次即可，禁止在每个 ProjectGroup 内重复挂载

**反模式**：在 `useLocalProjects` / `useWslProjects` / `useRemoteProjects` 各自 invoke + 自己持状态——三处 staleness 难以统一。

**好坏对照**：

```tsx
// Wrong —— 在每个领域 hook 里各自维护 ahead/behind
function useLocalProjects() {
  const [aheadBehind, setAheadBehind] = useState<Record<string, AheadBehind>>({});
}
function useWslProjects() {
  const [aheadBehind, setAheadBehind] = useState<Record<string, AheadBehind>>({});
}
// 消费侧从 3 处来源取数据，永远不一致
```

```tsx
// Correct —— 一份编排 hook + 共用切片
function useAheadBehindSync() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const activeWslProject = useAppStore((s) => s.activeWslProject);
  const activeRemoteProject = useAppStore((s) => s.activeRemoteProject);

  useEffect(() => { /* local invoke + setAheadBehind */ }, [activeProjectId]);
  useEffect(() => { /* wsl invoke + setAheadBehind */ }, [activeWslProject]);
  useEffect(() => { /* remote invoke + setAheadBehind */ }, [activeRemoteProject]);
}

// ProjectsPanel.tsx 顶层一次调用
useAheadBehindSync();
```

---

## 数据获取

### 所有数据通过 Tauri IPC 传输

没有 HTTP 客户端、REST API 或 GraphQL。所有后端通信使用 Tauri 的 `invoke`，通过 **Feature API Wrapper** 封装：

```tsx
import { listProjects } from "@/features/project/api/projectApi";

// 带类型的 API wrapper 调用
const projects = await listProjects();
```

API wrapper 文件位于 `src/features/<domain>/api/<domain>Api.ts`，集中封装 `invoke` 调用：

```typescript
// src/features/project/api/projectApi.ts
import { invoke } from '@tauri-apps/api/core';
import type { Project } from '../types';

export function listProjects(): Promise<Project[]> {
  return invoke<Project[]>('list_projects');
}

export function addProject(path: string, agentId?: string | null): Promise<Project> {
  return invoke<Project>('add_project', { path, agentId });
}
```

> ⚠️ Hooks 和组件**禁止**直接 import `invoke`，必须通过 API wrapper。ESLint 的 `no-restricted-imports` 规则强制执行此约束。

### 事件监听

对于后端推送的事件，使用 Tauri 的 `listen`：

```tsx
import { listen } from "@tauri-apps/api/event";

useEffect(() => {
  const unlisten = listen<string>("git-changed", (event) => {
    // 处理 event.payload
  });
  return () => { unlisten.then(fn => fn()); };
}, []);
```

### 配置持久化模式

参见 `useAppConfig.ts` 了解标准的加载/保存模式：

```tsx
export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

  // 同步 CSS 变量：appearanceFontSize → --font-size，terminalFontSize → --terminal-font-size
  useEffect(() => {
    document.documentElement.style.setProperty("--font-size", `${config.appearanceFontSize}px`);
  }, [config.appearanceFontSize]);

  useEffect(() => {
    document.documentElement.style.setProperty("--terminal-font-size", `${config.terminalFontSize}px`);
  }, [config.terminalFontSize]);

  // 挂载时加载（含旧字段迁移：fontSize → terminalFontSize）
  useEffect(() => {
    (async () => {
      const saved = await loadConfigApi();
      // 校验并与默认值合并
      setConfig({ ... });
    })();
  }, []);

  // 保存时浅比较，避免不必要的写入
  const saveConfig = useCallback(async (next: AppConfig) => {
    setConfig(prev => { /* 浅比较 */ });
    await saveConfigApi(next);
  }, []);

  return { config, saveConfig };
}
```

#### AppConfig 字体字段

| 字段 | 默认值 | 用途 |
|------|--------|------|
| `appearanceFontSize` | `12` | 整体 UI 字体，驱动 `--font-size` CSS 变量 |
| `editorFontSize` | `14` | CodeMirror 编辑器字体，通过 prop 传入 `FileViewer` |
| `terminalFontSize` | `14` | 终端字体，驱动 `--terminal-font-size` CSS 变量 |

> ⚠️ 旧字段 `fontSize`（单一字体大小）已在 2026-04-14 拆分为上述三字段。`useAppConfig` 中包含迁移逻辑，读取旧配置时将 `fontSize` 迁移为 `terminalFontSize`。新代码中**不得**使用 `config.fontSize`。

### 会话保存防抖模式

```tsx
// useSessionPersistence.ts
const saveWorktreeState = useCallback((projectId: string, wtPath: string | null) => {
  // 更新本地 state，并把 next 传给防抖持久化
  setWorktreeState((prev) => {
    const next = { ...prev };
    if (wtPath) next[projectId] = wtPath;
    else delete next[projectId];
    persistWorktreeState(next);
    return next;
  });
}, []);
```

---

## 命名约定

| 约定 | 示例 |
|------|------|
| 文件名：`use<Domain>.ts` | `useAppConfig.ts`、`useLocalProjects.ts` |
| 文件名（编排）：`use<Domain>Actions.ts` / `use*ToStore.ts` | `useAgentActions.ts`、`useWorktreeActions.ts`、`useSyncToStore.ts` |
| 导出：命名函数 | `export function useAppConfig()` |
| 返回值：带命名字段的对象 | `{ config, saveConfig, settingsOpen }` |
| 回调：动作动词 | `showToast`、`saveConfig`、`updateWtPath` |

---

## 现有 Hooks 参考

### 领域 Hook

| Hook | 用途 | 关键返回值 |
|------|------|-----------|
| `useAppConfig` | 应用配置持久化 | `config`、`saveConfig`、`settingsOpen` |
| `useToast` | Toast 通知（3 秒自动消失） | `toast`、`showToast` |
| `useLocalProjects` | 本地项目 CRUD 与状态 | 项目列表、CRUD 回调、Agent 管理 |
| `useFileView` | 文件树和编辑 Tab 状态动作 | `loadFileTree`、`openFile`、`saveFile` |
| `useWslProjects` | WSL 发行版管理 | WSL 会话、CRUD 回调 |
| `useRemoteProjects` | SSH 远程管理 + 认证 | 远程条目、CRUD 回调、认证状态 |
| `useKeyboardShortcuts` | 全局键盘快捷键 | （仅副作用） |
| `useSideTerminalResize` | 拖拽调整终端面板大小 | 宽度状态、鼠标事件处理 |
| `useWorktreeState` | 按项目追踪 worktree 状态 | 路径、分支、已打开的 worktrees |
| `useLsp` | LSP 文档生命周期（打开/变更/关闭） | `openDocument`, `changeDocument`, `closeDocument`, `request` |
| `useLspDiagnostics` | LSP 诊断事件监听（Tauri event） | `diagnosticsMap`, `getDiagnostics`, `clearDiagnostics` |
| `useLspHover` | LSP hover 请求（防抖） | `hoverState`, `setDocument`, `onMouseMove`, `hideHover` |
| `useLspDefinition` | Go to Definition + Find References | `goToDefinition`, `findReferences` |
| `useLspCompletion` | LSP 自动补全源 | `setContext`, `getCompletions` |
| `useLspDiagnosticExtensions` | CodeMirror 诊断装饰（波浪线 + gutter） | `Extension[]` |
| `useLspHoverExtension` | CodeMirror hover 鼠标事件处理器 | `Extension` |

### 编排 Hook（从 App.tsx 提取）

| Hook | 用途 | 关键返回值 |
|------|------|-----------|
| `useSessionPersistence` | 统一会话保存逻辑 | `saveSession`、`saveWorktreeState`、`saveSidebarWidth`、`worktreeState` |
| `useSyncToStore` | 同步连接快照与快捷键动作引用到 app store | （仅副作用，无返回值） |
| `useAgentActions` | 本地 agent、IDE、项目设置保存 | Agent 与 IDE 回调 |
| `useWorktreeActions` | 本地 worktree 导航与 diff 切换 | Worktree 回调 |
| `useRemoteAuthActions` | SSH 认证取消与确认 | Remote auth 回调 |

---

## 常见错误

### 1. 作为 Props 或 Context value 传递的回调忘记用 `useCallback`

由于本项目同时使用 Props 与 Context 分发，没有 `useCallback` 的回调会导致消费者无效重渲染：

```tsx
// 错误 —— 每次渲染产生新的函数引用
const handleSelect = (id: string) => { ... };

// 正确 —— 引用稳定
const handleSelect = useCallback((id: string) => { ... }, [deps]);
```

### 2. 在事件处理器中读取过期状态

当回调需要最新跨域状态值时，优先使用 store 快照模式：

```tsx
// 错误 —— 闭包捕获了初始值
const handler = useCallback(() => {
  console.log(activeProjectId); // 过期了！
}, []); // 空依赖以保持引用稳定

// 正确 —— 从 store 快照读取
const handler = useCallback(() => {
  console.log(useAppStore.getState().activeProjectId); // 始终是最新的
}, []);
```

### 3. 没有清理 Tauri 监听器

使用 `listen` 时务必在 `useEffect` 中返回清理函数：

```tsx
useEffect(() => {
  const unlisten = listen("event", handler);
  return () => { unlisten.then(fn => fn()); };
}, []);
```

### 4. 编排 Hook 缺少 `useCallback` 包裹返回的回调

编排 Hook 返回的回调必须用 `useCallback` 包裹，否则每次渲染破坏下游 `React.memo`：

```tsx
// 错误 —— 每次渲染创建新函数
return { handleSelect: (id) => { ... } };

// 正确 —— 引用稳定
const handleSelect = useCallback((id) => { ... }, [deps]);
return { handleSelect };
```
