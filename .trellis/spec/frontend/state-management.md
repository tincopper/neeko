# 状态管理

> 本项目中的状态管理方式。

---

## 概述

本项目仅使用 **React 内置状态** —— `useState`、`useRef`、`useCallback`、`useEffect`。**没有外部状态管理库**（没有 Redux、Zustand、Jotai 等），也**没有使用 Context API**。

`App.tsx` 作为**中央状态协调器**，持有所有状态并通过 Props 下传给子组件。

---

## 状态分类

### 1. 应用级状态（由 `App.tsx` 持有）

所有跨组件状态通过领域特定的 Hooks 在 `App.tsx` 中管理：

```tsx
// App.tsx —— 状态协调
function App() {
  const { config, saveConfig, settingsOpen, setSettingsOpen } = useAppConfig();
  const { toast, showToast } = useToast();
  const { projects, activeProjectId, ... } = useLocalProjects(...);
  const { wslEntries, activeWslProjectId, ... } = useWslProjects();
  const { remoteEntries, activeRemoteProjectId, ... } = useRemoteProjects();
  const { activeWorktreeBranch, ... } = useWorktreeState(activeProjectIdRef);

  // 跨领域协调通过回调实现
  // Props 下传给子组件
}
```

### 2. 组件本地状态

仅与 UI 相关的状态放在组件内部：

```tsx
// 本地开关、输入状态、下拉菜单可见性
const [showAddMenu, setShowAddMenu] = useState(false);
const [editingName, setEditingName] = useState("");
```

### 3. 基于 Ref 的可变状态

用于不需要触发重渲染的状态——计时器、缓存、最新值镜像：

```tsx
const activeProjectIdRef = useRef<string | null>(null);
const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

### 4. 模块级缓存（React 外部）

终端实例（xterm.js）缓存在模块级 `Map` 对象中，以在组件重新挂载时保持存活：

```tsx
// 在 TerminalView.tsx 中（模块作用域，不在组件内部）
export const terminalCache = new Map<string, Terminal>();
```

### 5. 持久化状态（通过 Tauri 后端）

应用配置和会话数据通过 Tauri IPC 保存到磁盘：

```tsx
await invoke("save_config", { config });
await invoke("save_session", { session: { ... } });
```

---

## 何时使用全局状态

在本项目中，"全局状态"指由 `App.tsx` 持有并通过 Props 下传的状态。

**使用应用级状态的场景：**
- 多个组件需要访问相同数据
- 需要跨领域协调（例如：选择 WSL 项目时取消选择本地项目）
- 状态需要持久化到后端

**保持状态本地化的场景：**
- 只有一个组件使用（下拉菜单可见性、输入值、悬停状态）
- 状态纯粹与 UI 相关且是临时的

---

## 服务端状态

没有 HTTP API —— 所有"服务端状态"来自 **Tauri Rust 后端**，通过 IPC 传输。

### 加载模式

```tsx
useEffect(() => {
  (async () => {
    try {
      const saved = await invoke<SessionData>("load_session");
      // 校验并设置状态
    } catch (e) {
      console.error("[App] Failed to load session:", e);
    }
  })();
}, []);
```

### 保存模式（防抖）

```tsx
const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const debouncedSave = useCallback(() => {
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(async () => {
    await invoke("save_session", { session: buildSessionData() });
  }, 500);
}, []);
```

### 事件驱动更新

后端推送事件触发状态更新：

```tsx
listen<string>("git-changed", (event) => {
  // 刷新项目的 git 信息
});
```

---

## 架构图

```
┌──────────────────────────────────────────────┐
│ App.tsx（状态协调器）                          │
│                                              │
│  useAppConfig()    → 配置状态                │
│  useLocalProjects() → 项目状态               │
│  useWslProjects()  → WSL 状态                │
│  useRemoteProjects() → SSH 状态              │
│  useWorktreeState() → Worktree 状态          │
│  useToast()        → 通知状态                │
│                                              │
│  跨领域协调回调                               │
│                                              │
│  ┌──────────┐ ┌───────────┐ ┌────────────┐  │
│  │ TitleBar │ │ProjectSide│ │MainContent │  │
│  │ (props)  │ │bar (props)│ │  (props)   │  │
│  └──────────┘ └───────────┘ └────────────┘  │
│                                              │
└──────────────────────────────────────────────┘
         ↕ Tauri IPC (invoke / listen)
┌──────────────────────────────────────────────┐
│ Rust 后端 (src-tauri/)                        │
│  - 会话持久化（JSON 文件）                     │
│  - 终端管理（PTY）                            │
│  - Git 操作（git2）                           │
│  - SSH 连接（russh）                          │
└──────────────────────────────────────────────┘
```

---

## 常见错误

### 1. 添加状态管理库

本项目有意避免使用外部状态库。应用是单视图桌面工具——从 `App.tsx` 进行 Props 下传已经足够，且保持了数据流的显式性。

### 2. 没有使用 ref 镜像模式

当 `useCallback` 的依赖为 `[]` 但需要读取当前状态时，使用 ref 镜像：

```tsx
// 设置镜像
const valueRef = useRef(value);
useEffect(() => { valueRef.current = value; }, [value]);

// 在回调中从 ref 读取
const stableCallback = useCallback(() => {
  doSomething(valueRef.current);
}, []);
```

### 3. 忘记持久化状态变更

修改了应该在应用重启后保留的状态后，调用相应的 `invoke("save_...")` 命令。防抖保存模式可防止过于频繁的磁盘写入。

### 4. 模块级缓存泄漏

终端缓存（`terminalCache` 等）在移除项目时必须显式清理。务必调用对应的 `destroyXxxCache()` 函数。
