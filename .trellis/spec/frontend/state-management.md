# 状态管理

> 本项目中的状态管理方式。

---

## 概述

本项目使用 **React 内置状态** —— `useState`、`useRef`、`useCallback`、`useEffect`，并使用 **Context API** 作为跨组件分发层。项目仍然不引入外部状态管理库。

状态协调已从 `App.tsx` 主文件下沉到 `useAppContainer`。`App.tsx` 仅保留壳层编排，避免巨型组件继续膨胀。

---

## 状态分类

### 1. 应用级状态源 `useAppContainer`

跨领域状态由 `useAppContainer` 调用领域 Hook 持有：

```tsx
export function useAppContainer() {
  const local = useLocalProjects();
  const wsl = useWslProjects(saveSession);
  const remote = useRemoteProjects(saveSession);
  const worktree = useWorktreeState(activeProjectIdRef);
  const fileView = useFileView();
  const callbacks = useAppCallbacks(...);

  return {
    appProvidersProps,
    appLayoutProps,
    appModalsProps,
    titleBarProps,
  };
}
```

### 2. Context 分发层

用于消除 prop drilling，按职责拆分为细粒度 Context：

| Context | 作用范围 | 典型消费者 |
|--------|---------|-----------|
| `AppContext` | 全局配置、agents、toast | `ProjectsPanel`、`MainContent` |
| `SidebarContext` | 左侧面板切换与宽度 | `ActivityBar`、`PanelArea` |
| `ProjectStateContext` | 本地项目状态与文件视图状态 | `AppLayout`、`ProjectsPanel`、`MainContent` |
| `ProjectActionsContext` | 本地项目动作回调 | `AppLayout`、`ProjectsPanel`、`MainContent` |
| `WslContext` | WSL 项目状态 + 操作 | `ProjectsPanel`、`MainContent` |
| `RemoteContext` | SSH 项目状态 + 操作 | `ProjectsPanel`、`MainContent` |
| `EditorContext` | 终端 tabs 与 agent bar | `MainContent` |
| `SkillContext` | skill 面板领域状态 | `SkillsPanel`、`SkillContent` |

### 3. 组件本地状态

仅与当前组件 UI 行为相关的状态保留在组件内部：

```tsx
const [showAddMenu, setShowAddMenu] = useState(false);
const [dialog, setDialog] = useState<DialogState | null>(null);
```

### 4. 基于 Ref 的可变状态

用于不触发重渲染的数据镜像与计时器：

```tsx
const activeProjectIdRef = useRef<string | null>(null);
const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

### 5. 模块级缓存

终端实例在模块作用域缓存，跨 unmount/remount 保持会话：

```tsx
export const terminalCache = new Map<string, Terminal>();
```

### 6. 持久化状态

通过 Tauri IPC 写入本地文件：

```tsx
await invoke("save_config", { config });
await invoke("save_session", { session: { ... } });
```

---

## 何时使用全局状态

本项目的全局状态是 `useAppContainer` 中的状态源 + Context 分发层。

适合放入应用级状态的场景：

1. 多个区域需要读写同一份数据。
2. 存在跨领域联动，例如切换 WSL 项目时清理本地激活态。
3. 状态需要持久化到后端。

适合放入组件本地状态的场景：

1. 仅当前组件使用。
2. 状态只影响局部交互，不参与跨领域协调。

---

## 服务端状态

没有 HTTP API，所有后端状态通过 Tauri IPC 获取。

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

### 保存模式

```tsx
const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const debouncedSave = useCallback(() => {
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(async () => {
    await invoke("save_session", { session: buildSessionData() });
  }, 500);
}, []);
```

---

## 架构图

```
┌────────────────────────────────────────────────┐
│ App.tsx 壳层                                    │
│  TitleBar + AppProviders + AppLayout + AppModals│
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│ useAppContainer 状态协调器                      │
│  useLocalProjects / useWslProjects / ...       │
│  useWorktreeState / useFileView / useAppConfig │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│ Providers                                       │
│  App + Sidebar + ProjectState + ProjectActions │
│  Wsl + Remote + Editor + Skill                 │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│ Consumer Components                             │
│  AppLayout / ProjectsPanel / MainContent        │
│  ActivityBar / FilesPanel / SkillsPanel         │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│ Tauri IPC (invoke / listen)                     │
└────────────────────────────────────────────────┘
```

---

## 常见错误

### 1. 继续把跨域数据通过多层 Props 透传

当前架构已经提供领域 Context。新增跨域字段优先评估是否应加入对应 Context。

### 2. 把无关字段塞进同一个 Context

Context 粒度过大将放大重渲染影响。新增字段时优先放入最贴近业务边界的 Context。

### 3. 在 `App.tsx` 重新堆积业务逻辑

根组件仅承担壳层编排。领域协调逻辑统一收敛到 `useAppContainer` 或领域 Hook。

### 4. 忘记持久化状态变更

需要跨重启保留的数据必须经过对应 `save_*` 调用。

### 5. 模块级缓存泄漏

终端缓存销毁时必须同步清理关联状态，避免 stale session。
