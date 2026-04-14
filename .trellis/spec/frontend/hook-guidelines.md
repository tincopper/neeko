# Hook 指南

> 本项目中 Hooks 的使用方式。

---

## 概述

所有自定义 Hooks 位于 `src/hooks/` 扁平目录中。项目仅使用 **React 内置 Hooks** —— 没有外部数据获取库（没有 React Query、SWR 等）。所有后端通信通过 **Tauri IPC**（`invoke`）进行。

Hook 分两类：
- **领域 Hook**：管理特定领域状态（项目、WSL、SSH、Worktree）
- **编排 Hook**：从 App.tsx 提取的横切逻辑（保存、回调、ref 同步）

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
2. **用 `useCallback` 包裹回调**，保持引用稳定以配合 Props 下传
3. **用 `useRef` 管理可变状态**，适用于不需要触发重渲染的数据（计时器、缓存、当前值镜像）
4. **返回对象**，包含状态值和操作回调

### 编排 Hook 模式

当 App.tsx 的某个职责区域变得臃肿时，提取为编排 Hook：

```tsx
// 编排 Hook 接受大量参数（状态 + refs + setters），返回操作回调
export interface UseAppCallbacksParams {
  activeProject: Project | null;
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  // ... 更多参数
}

export interface UseAppCallbacksResult {
  handleSelectLocalAgent: (agent: AgentConfig | null) => void;
  handleOpenIdeCallback: (project: { id: string; selected_ide: string | null }) => void;
  // ... 更多回调
}
```

**规则**：
- 编排 Hook 的文件名以 `useApp` 开头（如 `useAppCallbacks`、`useAppRefSync`）
- 编排 Hook 接受状态/setter/ref 作为参数，不自行创建领域状态
- 编排 Hook 内部使用 `useCallback` 保证返回的回调引用稳定

### Ref 镜像模式

本代码库的特色模式：将状态值镜像到 ref，使回调能读取最新值而不产生过期闭包：

```tsx
// src/App.tsx —— 常见模式
const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
const activeProjectIdRef = useRef<string | null>(null);
useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

// 现在回调可以读取 activeProjectIdRef.current 而不依赖 activeProjectId
```

该模式在 `App.tsx` 和 `useWorktreeState` 等 Hook 中广泛使用。

---

## 数据获取

### 所有数据通过 Tauri IPC 传输

没有 HTTP 客户端、REST API 或 GraphQL。所有后端通信使用 Tauri 的 `invoke`：

```tsx
import { invoke } from "@tauri-apps/api/core";

// 带类型的 invoke 调用
const result = await invoke<SomeType>("command_name", { param1, param2 });
```

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
      const saved = await invoke<Record<string, any>>("load_config");
      // 校验并与默认值合并
      setConfig({ ... });
    })();
  }, []);

  // 保存时浅比较，避免不必要的写入
  const saveConfig = useCallback(async (next: AppConfig) => {
    setConfig(prev => { /* 浅比较 */ });
    await invoke("save_config", { config: next });
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
  // 更新 ref
  worktreeStateRef.current[projectId] = wtPath;
  // 防抖保存（500ms）
  if (wtSaveTimerRef.current) clearTimeout(wtSaveTimerRef.current);
  wtSaveTimerRef.current = setTimeout(() => {
    invoke("save_session", { worktreeState: worktreeStateRef.current }).catch(() => {});
  }, 500);
}, []);
```

---

## 命名约定

| 约定 | 示例 |
|------|------|
| 文件名：`use<Domain>.ts` | `useAppConfig.ts`、`useLocalProjects.ts` |
| 文件名（编排）：`useApp<Purpose>.ts` | `useAppCallbacks.ts`、`useAppRefSync.ts` |
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
| `useWslProjects` | WSL 发行版管理 | WSL 会话、CRUD 回调 |
| `useRemoteProjects` | SSH 远程管理 + 认证 | 远程条目、CRUD 回调、认证状态 |
| `useKeyboardShortcuts` | 全局键盘快捷键 | （仅副作用） |
| `useSideTerminalResize` | 拖拽调整终端面板大小 | 宽度状态、鼠标事件处理 |
| `useWorktreeState` | 按项目追踪 worktree 状态 | 路径、分支、已打开的 worktrees |

### 编排 Hook（从 App.tsx 提取）

| Hook | 用途 | 关键返回值 |
|------|------|-----------|
| `useSessionPersistence` | 统一会话保存逻辑 | `saveSession`、`saveWorktreeState`、`saveSidebarWidth`、`saveSideTerminalWidth`、相关 refs |
| `useAppRefSync` | 批量同步状态到 refs | （仅副作用，无返回值） |
| `useSideTerminalState` | 本地/WSL/远程 side terminal 统一管理 | `sideTerminalOpenSet`、`setSideTerminalOpen`、open handlers、focus 状态 |
| `useAppCallbacks` | IDE、agent、worktree、auth、UI 回调 | 所有 `handle*` 回调 |

---

## 常见错误

### 1. 作为 Props 传递的回调忘记用 `useCallback`

由于本项目使用 Props 下传 + `React.memo` 组件，没有 `useCallback` 的回调会破坏记忆化：

```tsx
// 错误 —— 每次渲染产生新的函数引用
const handleSelect = (id: string) => { ... };

// 正确 —— 引用稳定
const handleSelect = useCallback((id: string) => { ... }, [deps]);
```

### 2. 在事件处理器中读取过期状态

当回调需要最新状态值时，使用 ref 镜像模式：

```tsx
// 错误 —— 闭包捕获了初始值
const handler = useCallback(() => {
  console.log(activeProjectId); // 过期了！
}, []); // 空依赖以保持引用稳定

// 正确 —— 从 ref 读取
const handler = useCallback(() => {
  console.log(activeProjectIdRef.current); // 始终是最新的
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
