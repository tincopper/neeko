# Hook 指南

> 本项目中 Hooks 的使用方式。

---

## 概述

所有自定义 Hooks 位于 `src/shared/hooks/`（跨域共享）或 `src/features/<domain>/hooks/`（域内）中。项目以 **React 内置 Hooks** 为主，并使用 **Zustand 域 store**（`src/shared/store/` + feature `store.ts`）作为跨域共享状态源。项目没有外部数据获取库。所有后端通信通过 **Tauri IPC** 进行，通过 `src/features/<domain>/api/<domain>Api.ts` 中的 API wrapper 封装。

Hook 分两类：
- **领域 Hook**：管理特定领域状态（项目、WSL、SSH、Worktree），放在 `src/features/<domain>/hooks/`
- **编排 Hook**：横切逻辑（保存、Context 组装、视图状态回写），放在 `src/app/hooks/`（如 `useAppShellData` / `useAppStoreSync` / `useAppGlobalEffects`）；纯共享工具型 hook 在 `src/shared/hooks/`（如 `useKeyboardShortcuts` / `useTauriEvent`）

---

## 自定义 Hook 模式

### 标准 Hook 结构

```tsx
// src/shared/hooks/useToast.ts
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
- 优先从对应域的 store 读取跨域状态（`useProjectStore` / `useWorkspaceStore` / `useEditorStore` / `@/features/file/store` …），减少参数数量 —— 没有单一 app store 可查
- 仅暴露本领域回调，使用 `useCallback` 保持引用稳定
- Hook 文件规模以 ≤300 行为红线：超线时按职责拆出独立 hook（如 `useSessionBootstrap` 的 git 事件监听块抽为 `useGitStatusEventsSync`，监听注册/清理与恢复逻辑解耦）

### Store 快照模式

非渲染路径（全局事件处理器、命令式分支）用 `getState()` 读最新值，避免 stale closure 和大量 Ref 同步。
**按需取那一个域的 store**，而不是抓一个「全量快照」：

```tsx
// src/shared/hooks/useKeyboardShortcuts.ts（真实用法，节选）
const projectId = useProjectStore.getState().activeProjectId;
const worktreePath = selectActiveCheckoutPath(useWorkspaceStore.getState(), projectId);
useDockStore.getState().togglePanel('projects');
```

该模式用于跨域读取场景。领域状态直接由各自的域 store 持有。把「视图状态 + 动作引用」回写到
`projectStore` 的那一段是 `useAppStoreSync`（`src/app/hooks/useAppStoreSync.ts`），它**不再镜像
project/file 状态字段**（镜像 = 第二份表示）。

---

## 场景：FileView Hook 单源状态契约 2026-04-21

> **结论仍是硬约束，符号已随迁移改名**：要根治的是「文件树/Tab 状态由 `useState` 持有并跨层透传」
> ⇒ 状态归所属 store、hook 只出动作与派生值。名称对照：`src/hooks/useFileView.ts` →
> `src/features/editor/hooks/useFileView.ts`；`useAppContainer` → `useAppShell`（`src/app/hooks/`）；
> `AppLayout` / `FileViewer` → 现在是 `src/app/shell/` + `src/features/editor/components/FileViewer.tsx`
> 与 `src/features/file/components/FilesPanel.tsx`；`useAppStore` → 域 store（树在
> `@/features/file/store`，tab 在 `shared/store/editorStore`）。`fileTabs` / `activeFileTabId` /
> `fileTree` / `fileViewLoading` **都不是 store 字段**（见下第 2 节）。

### 1. Scope / Trigger

- Trigger：文件树和 Tab 状态由 `useState` 持有并跨层透传，消费端难以统一，易产生双源读取。
- Scope：`src/features/editor/hooks/useFileView.ts`、`src/features/file/store.ts`、
  `src/shared/store/editorStore.ts`、`src/app/hooks/`、`src/features/editor/FileActionsContext.tsx`、
  `src/features/file/components/FilesPanel.tsx`。

### 2. Signatures

```ts
// src/features/editor/hooks/useFileView.ts（现状；tab 操作为主签名，其余见源码）
export function useFileView(
  externalCommands?: ProjectCommands | null,      // WSL/Remote 经 ProjectCommands 接入
  externalWorktreePath?: string | null,
): {
  activeFilePath: string | null;                              // 派生值：不是 store 字段
  error: string | null;
  loadFileTree: (projectId: string, worktreePath?: string, force?: boolean) => Promise<void>;
  expandSubTree: (dirPath: string) => Promise<void>;
  openFile: (rawPath: string) => Promise<boolean>;
  closeTab: (tabId: string) => void;
  activateTab: (tabId: string) => void;                       // 内部走 editorStore.activateTab(tabKey, tabId)
  updateTabContent: (tabId: string, content: string) => void;
  saveFile: (content: string, tabId?: string, closeAfterSave?: boolean) => Promise<boolean>;
  saveTabById: (tabId: string) => Promise<boolean>;
  setTabDirty: (tabId: string, isDirty: boolean) => void;
  clearFileView: () => void;
};
```

`fileTabs` / `activeFileTabId` 是 hook 内部由 `editorStore.tabs[tabKey]` **派生**的 `useMemo`
结果，不再作为 store 字段存在。

### 3. Contracts

1. `useFileView` 不持有文件树/tab 的本地 `useState`：树进 `@/features/file/store`（`dirs` /
   `loadStates` / `owner`），tab 进 `editorStore`（`tabs[tabKey]` / `activeTabId`）。
2. **tab 空间按复合 `tabKey` 分槽**：`tabKey = resolveTabKey(projectId, worktreePath)`
   （`src/shared/utils/tabKey.ts`），主仓单元的 key 就是 `projectId`。worktree 因此有独立 tab 空间，
   不再靠 `${projectId}:${filePath}` 这类自造身份。
3. `activeFilePath` 是**派生值**（由当前 `tabKey` 的激活 file tab 推出），在 hook 内 `useMemo`
   计算，禁止在组件层重复推导、也不要为它另建一份 store 状态。
4. `FilesPanel` / `FileViewer` 只经 selector 读 store，动作通过 `FileActionsContext` 下发。

### 4. Validation & Error Matrix

| 场景 | 输入 | 预期 | 错误处理 |
|------|------|------|---------|
| 打开重复文件 | 同一 tab 身份 | 只切换激活 tab | 不触发 IPC |
| 打开新文件 | 新 tab 身份 | 创建 tab 并激活 | IPC 失败写 `error` |
| 关闭活动 tab | `tabId` 命中活动项 | 激活相邻 tab 或置空 | 无 |
| 保存文件 | 活动 tab 存在 | 返回 `true` 并清除脏标记 | IPC 失败返回 `false` |
| 目录加载失败 | loader 抛错 | **保留旧内容** + 标 error | 不置空（`file/store` 语义） |

### 5. Good/Base/Bad Cases

- Good：`openFile` 新建 tab，`activeFilePath` 同步为目标路径。
- Base：连续切换 tab，`activeFilePath` 始终和激活 tab 对齐。
- Bad：`saveFile` 在无活动 tab 时直接返回 `false`，不触发写文件命令。

### 6. Tests Required

- Hook 断言
`openFile` 重复打开同一路径不增加 file tab 数量。
`closeTab` 关闭最后一个 tab 后该 `tabKey` 的 `activeTabId` 为 `null`。
`updateTabContent` 后 `isDirty` 与原始内容比较一致。
- 集成断言
`FilesPanel` 切到 files 面板时触发目录加载；`onFileSave` 的返回值决定脏标记是否维持。
`FileActionsContext` 只提供动作，状态一律从 store 读。

### 7. Wrong vs Correct

#### Wrong

```tsx
// 状态在组件/hook 内 useState 持有，再跨层透传（双源）
const [tabs, setTabs] = useState<FileTab[]>([]);
const [activeTabId, setActiveTabId] = useState<string | null>(null);
```

#### Correct

```tsx
// tab 状态归 editorStore，按复合 tabKey 分槽；hook 只负责动作与派生
const projectTabs = useEditorStore((s) => s.tabs[tabKey]);
const activeTabId = projectTabs?.activeTabId ?? null;
useEditorStore.getState().activateTab(tabKey, tabId);
```

---

## 跨域共享切片的「单一编排 hook」模式

当某份数据按 active 目标获取（不批量预热）、且三个域（local / WSL / SSH）都要消费时，**只允许
一份编排 hook 写入共用切片**，各域不自己持状态。

**实例**：`useAheadBehindSync`（`shared/hooks/useAheadBehindSync.ts`）

- 一个 `useEffect`，依赖 `(activeProjectId, activeCheckoutPath, commands)`。`commands` 来自
  `useActiveProject()`，**已按当前单元绑定**，所以取回的就是该单元的数字；
- 结果写进 `gitStore.aheadBehind`，**键 = Workspace身份 `WorkspaceKey`**
  （`workspaceKeyOf(activeProjectId, activeCheckoutPath)`），不带 `{source}:{connectionId}` 前缀 ——
  理由与「为什么前缀必错」见 `state-management.md` 场景「Workspace分槽 + 激活态单源」第 7 条；
- 它在 `ProjectsPanel` 顶层挂一次。与 `useRefreshGitInfo` 是**同一事实的两个触发时机**
  （切换项目 vs 手动刷新），键与语义必须同形。

**契约**：
1. 只在 active 切换时触发，不批量预热（避免 SSH 网络抖动放大成本）
2. 失败路径调用 `setAheadBehind(workspaceKey, null)`，让消费侧不渲染陈旧 chip
3. 键由唯一产出点 `workspaceKeyOf` 给出；禁止消费侧另算一份「等价键」
4. hook 在跨域容器（如 `ProjectsPanel`）顶层调用一次即可，禁止在每个 ProjectGroup 内重复挂载

**反模式**：让 `useLocalProjects` / `useWslProjects` / `useRemoteProjects` 各自 invoke + 自己持状态
——三处 staleness 难以统一。

**好坏对照**：

```tsx
// Wrong —— 每个领域 hook 各自维护一份：消费侧从 3 处来源取数据，永远不一致
function useLocalProjects() {
  const [aheadBehind, setAheadBehind] = useState<Record<string, AheadBehind>>({});
}
function useWslProjects() { /* 同上 */ }
// 更隐蔽的错法：切片共用了，但键各拼一份前缀 ⇒ 读侧永远拼不出写侧的键
setAheadBehind(aheadBehindKey('wsl', `${host}:${port}`, projectId), info);
```

```tsx
// Correct —— 一份编排 hook + 共用切片 + 单元身份键
function useAheadBehindSync(commands?: AheadBehindCommands | null) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeCheckoutPath = useActiveCheckoutPath();
  const setAheadBehind = useGitStore((s) => s.setAheadBehind);

  useEffect(() => {
    if (!commands || !activeProjectId || !activeProject?.git_info) return;
    const workspaceKey = workspaceKeyOf(activeProjectId, activeCheckoutPath);
    let cancelled = false;
    commands
      .getAheadBehind()
      .then((info) => { if (!cancelled) setAheadBehind(workspaceKey, info); })
      .catch(() => { if (!cancelled) setAheadBehind(workspaceKey, null); });
    return () => { cancelled = true; };
  }, [activeProjectId, activeProject, activeCheckoutPath, commands, setAheadBehind]);
}

// ProjectsPanel.tsx 顶层一次调用（commands 已按当前单元绑定）
const { commands } = useActiveProject();
useAheadBehindSync(commands);
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

对于后端推送的事件，优先用 `useTauriEvent`（自动 listen/unlisten、竞态安全），事件名与载荷类型
必须来自单一事实源（`shared/events.ts` 常量 + `shared/types`）：

```tsx
import { GIT_CHANGED_EVENT } from "@/shared/events";
import { useTauriEvent } from "@/shared/hooks/useTauriEvent";
import type { GitChangedEvent } from "@/shared/types";

useTauriEvent<GitChangedEvent>(
  GIT_CHANGED_EVENT,
  useCallback((payload) => {
    if (payload.project_id !== projectId) return;
  }, [projectId]),
);
```

> ⚠️ 禁止 `listen<string>("git-changed")` 这类裸写法：既绕过常量源，又会在载荷形状演进时静默死亡
> （详见 `api-layer.md` 事件监听）。

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
| 文件名（编排）：`use<Domain>Actions.ts` / `use*ToStore.ts` | `useAgentActions.ts`、`useWorktreeActions.ts`、`useAppStoreSync.ts` |
| 导出：命名函数 | `export function useAppConfig()` |
| 返回值：带命名字段的对象 | `{ config, saveConfig, settingsOpen }` |
| 回调：动作动词 | `showToast`、`saveConfig`、`updateWtPath` |

---

## 现有 Hooks 参考

> 落点速查：跨域共享的放 `src/shared/hooks/`，域内的放 `src/features/<domain>/hooks/`，
> 应用编排的放 `src/app/hooks/`。

### 领域 Hook

| Hook | 落点 | 用途 | 关键返回值 |
|------|------|------|-----------|
| `useAppConfig` | `features/settings/hooks/` | 应用配置持久化 | `config`、`saveConfig`、`settingsOpen` |
| `useToast` | `shared/hooks/` | Toast 通知（3 秒自动消失） | `toast`、`showToast` |
| `useLocalProjects` | `features/project/hooks/` | 本地项目 CRUD 与状态 | 项目列表、CRUD 回调、Agent 管理 |
| `useConnectionProjects` | `shared/hooks/` | WSL/Remote 统一入口 | 连接条目、CRUD 回调 |
| `useWorkspaceState` | `features/project/hooks/` | 按项目追踪激活单元（worktree） | `activePath`、`activeBranch`、`opened` |
| `useFileView` | `features/editor/hooks/` | 文件树与 tab 的动作/派生（状态在 store） | `loadFileTree`、`openFile`、`saveFile` |
| `useKeyboardShortcuts` | `shared/hooks/` | 全局键盘快捷键 | （仅副作用） |
| `useDeltaBatcher` | `features/agent-chat/hooks/` | 流式增量 rAF 批处理 | `flush`、批处理后的 state |
| `useDiagnosticQuickFix` | `features/lsp/hooks/` | 单条诊断 quickfix 状态机（展开才拉 codeAction） | 展开/应用动作 |
| `useLspDefinition` | `features/lsp/hooks/` | Go to Definition + Find References | `goToDefinition`、`findReferences` |
| `useLspLinkHighlight` | `features/lsp/hooks/` | Cmd/Ctrl + hover 定义探针（去抖 + pending 去重） | 高亮状态 |

> `useWslProjects` / `useRemoteProjects`（`features/connection/hooks/`）仍在，但已 **deprecated** ——
> 新代码走 `useConnectionProjects`。

### 编排 Hook（`src/app/hooks/`）

| Hook | 用途 | 关键返回值 |
|------|------|-----------|
| `useAppShell` | 薄组合器：`useAppGlobalEffects` + `useAppShellData` + `buildAppShellValues` | `initializing`、`appProvidersProps`、`appModalsProps` |
| `useAppShellData` | 领域 Hook 编排 + 副作用注册 | `AppShellData` + `toolbarProps` |
| `useAppStoreSync` | 同步视图状态与动作引用到 `projectStore` | （仅副作用，无返回值） |
| `useSessionPersistence` | 统一会话保存逻辑 | `saveSession`、`saveWorktreeState`、`saveSidebarWidth` |
| `useActiveWorkspaceSync` | 反应激活单元变化、请求后端挂载（唯一发起点） | （仅副作用） |

---

## 流式增量 rAF 批处理模式（useDeltaBatcher）

**问题**：流式增量事件（如 agent 的 `text_delta` / `reasoning_delta`）逐 token 到达，若每个事件都 `setState` 全量追加，高频率下（尤其是长回复）会触发海量重渲染，把页面卡死。

**解决方案**：把增量累积到 ref buffer，由 `requestAnimationFrame` 每动画帧合并一次 flush 到 state；同时提供 `flush()` 供「话轮边界」等强一致时刻立即落盘。

```tsx
// src/features/agent-chat/hooks/useDeltaBatcher.ts（要点）
export interface PendingDelta { kind: 'text' | 'reasoning'; delta: string }

export function useDeltaBatcher(onFlush: (deltas: PendingDelta[]) => void) {
  const bufferRef = useRef<PendingDelta[]>([]);
  const rafRef = useRef<number | null>(null);
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush; // 始终读取最新回调，避免闭包过期

  const push = useCallback((kind, delta) => {
    bufferRef.current.push({ kind, delta });
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(flush);
    }
  }, []);

  const flush = useCallback(() => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    const deltas = bufferRef.current;
    bufferRef.current = [];
    if (deltas.length > 0) onFlushRef.current(deltas);
  }, []);

  useEffect(() => () => { // 卸载清理
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  return { push, flush };
}
```

**消费方契约**：
1. **flush 顺序即渲染顺序**：`appendDelta` 必须按 buffer 到达顺序逐条应用，思考/文本相对顺序保持事件真实时序。
2. **话轮边界必须 `flush()`**：`turn_start` / `turn_end` / `session_done` / `error` 事件处理时先 flush，避免边界后残留半帧增量。
3. **清理**：卸载时取消挂起的 rAF。
4. **单帧多 delta 合并**：测试断言「N 个 delta 只调度一次 rAF」与「flush 后完整拼接」。

> **测试要点**：jsdom 下用可控 rAF stub（`vi.stubGlobal('requestAnimationFrame', stub)`）收集回调、手动 `flushRaf()` 执行，才能断言「批处理窗口内未渲染 / flush 后才渲染」的中间态。

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

// 正确 —— 从对应域 store 的命令式快照读取
const handler = useCallback(() => {
  console.log(useProjectStore.getState().activeProjectId); // 始终是最新的
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
