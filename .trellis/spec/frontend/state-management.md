# 状态管理

> 本项目中的状态管理方式。

---

## 概述

本项目使用 **React 内置状态** 与 **Context API**。跨领域共享状态放在 **Zustand**，作为项目列表、激活项目、文件视图、worktree、WSL/Remote 条目、认证状态的统一状态源。

状态协调已从 `App.tsx` 主文件下沉到 `useAppContainer`。`App.tsx` 仅保留壳层编排。`useAppContainer` 负责组装 Action Context、连接领域 Hook，并通过 `useSyncToStore` 同步快捷键所需的连接快照。

---

## 状态分类

### 1. 应用级状态源 `useAppContainer`

跨领域状态由 `useAppContainer` 调用领域 Hook 编排，并统一同步到 `useAppStore`：

```tsx
export function useAppContainer() {
  const local = useLocalProjects();
  const wsl = useWslProjects(saveSession);
  const remote = useRemoteProjects(saveSession);
  const worktree = useWorktreeState(activeProjectId);
  const fileView = useFileView();
  const agentActions = useAgentActions(...);
  const worktreeActions = useWorktreeActions(...);
  const remoteAuthActions = useRemoteAuthActions(...);
  useSyncToStore(...);

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
| `ProjectActionsContext` | 本地项目与 worktree 副作用动作 | `ProjectsPanel`、`MainContent` |
| `FileActionsContext` | 文件树加载、文件保存与 Tab 操作动作 | `AppLayout`、`FileViewer` |
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

### 4. Zustand 全局状态

用于跨域状态读写和全局事件回调读取最新状态：

```tsx
const snapshot = useAppStore.getState();
snapshot.selectProject(projectId);
```

### 5. 基于 Ref 的可变状态

用于计时器、DOM 句柄等无需触发重渲染的数据：

```tsx
const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

### 6. 模块级缓存

终端实例在模块作用域缓存，跨 unmount/remount 保持会话：

```tsx
export const terminalCache = new Map<string, Terminal>();
```

### 7. 持久化状态

通过 Tauri IPC 写入本地文件：

```tsx
await invoke("save_config", { config });
await invoke("save_session", { session: { ... } });
```

---

## 何时使用全局状态

本项目的全局状态是 `useAppStore` + Context 分发层。

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
│  useAgentActions / useWorktreeActions / ...    │
│  useFileView / useSyncToStore                  │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│ Zustand 全局状态层 useAppStore                 │
│  Project/File/Worktree 状态单源 + 快照读取     │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│ Providers                                       │
│  App + Sidebar + ProjectActions + FileActions  │
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

## 场景：Project/File 状态单源化迁移 2026-04-21

### 1. Scope / Trigger

- Trigger：`ProjectStateContext` 与 `useSyncToStore` 同步 project/file 字段导致双数据源，组件同时消费 Context 和 Store。
- Scope：`src/store/appStore.ts`、`src/hooks/useFileView.ts`、`src/hooks/useAppContainer.ts`、`src/hooks/useSyncToStore.ts`、`src/AppProviders.tsx`、`src/contexts/*`、消费端组件。

### 2. Signatures

```ts
// src/store/appStore.ts
interface AppStoreState {
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  activeWorktreePath: string | null;
  activeWorktreeBranch: string;
  worktreeDiffState: { worktreePath: string; filePath: string } | null;
  fileTree: FileNode[];
  fileTabs: FileTab[];
  activeFileTabId: string | null;
  fileViewLoading: boolean;
  activeFilePath: string | null;
}

// src/contexts/file-actions-context.tsx
interface FileActionsContextValue {
  onFileSelect(filePath: string): void;
  onFileRefresh(): void;
  onFileCloseTab(tabId: string): void;
  onFileActivateTab(tabId: string): void;
  onFileSave(content: string): Promise<boolean>;
  onFileContentChange(tabId: string, content: string): void;
  onLoadFileTree(projectId: string): void;
}
```

### 3. Contracts

1. 状态归属契约  
`projects`、`activeProject*`、`activeWorktree*`、`worktreeDiffState`、`file*` 字段由 `useAppStore` 持有，组件通过 selector 读取。

2. Context 职责契约  
`ProjectActionsContext` 只承载项目与 worktree 的副作用动作。  
`FileActionsContext` 承载文件读取、保存、标签页操作动作。  
`ProjectStateContext` 不再作为共享状态入口。

3. 同步层契约  
`useSyncToStore` 不再接受 `projects`、`activeProjectId`、`activeProject` 参数，避免镜像写回。仅同步连接快照与快捷键依赖的回调引用。

### 4. Validation & Error Matrix

| 场景 | 输入 | 预期 | 错误处理 |
|------|------|------|---------|
| `loadFileTree` 成功 | `projectId` 有效 | `fileTree` 更新，`fileViewLoading=false` | 无 |
| `loadFileTree` 失败 | IPC 抛错 | `fileTree=[]`，`fileViewLoading=false`，`error` 记录 | 组件显示空树 |
| `openFile` 命中已打开 tab | 相同 `projectId+filePath` | 仅切换 `activeFileTabId` | 无 |
| `openFile` 读取失败 | `read_file_content` 抛错 | 不新增 tab，`error` 记录 | 保持原有 tab |
| `saveFile` 失败 | `write_file_content` 抛错 | 返回 `false`，`isDirty` 保留 | `FileViewer` 保持编辑状态 |

### 5. Good/Base/Bad Cases

- Good：打开未打开文件，新增 tab 并激活，`activeFilePath` 与 tab 对齐。
- Base：关闭当前 tab，激活相邻 tab；关闭最后一个 tab 后 `activeFileTabId=null`。
- Bad：无 `activeTabId` 时执行保存，函数返回 `false`，store 不写入脏数据。

### 6. Tests Required

- `useFileView` 单测断言  
`openFile` 命中已存在 tab 时不追加 `fileTabs.length`。  
`closeTab` 关闭当前 tab 时 `activeFileTabId` 回退正确。  
`saveFile` 成功后 `isDirty=false`，失败后保持 `isDirty=true`。
- 组件集成断言  
`AppLayout` 使用 `useAppStore` 的 `fileTree`、`activeFilePath` 渲染。  
`FileViewer` 通过 `FileActionsContext` 调用保存与切换动作。
- 回归断言  
`npx tsc --noEmit` 必须通过。  
`pnpm test:run` 必须通过。

### 7. Wrong vs Correct

#### Wrong

```tsx
// 状态在 hook 内 useState 持有，再镜像到 store
const [fileTree, setFileTree] = useState<FileNode[]>([]);
useSyncToStore({ projects, activeProject, fileTree, ... });
```

#### Correct

```tsx
// 状态直接进 store，hook 只负责动作和错误处理
const fileTree = useAppStore((s) => s.fileTree);
useAppStore.setState({ fileTree: tree, fileViewLoading: false });
```

---

## 场景：跨域共用切片 + 复合 key 2026-05-18

### 1. Scope / Trigger

- Trigger：local / WSL / SSH 三端按 project 维度缓存同一份后端结果（如 ahead/behind），但 `projectId` 在 wsl/remote 之间不全局唯一，直接做 `Record<projectId, T>` 会跨域 collision。
- Scope：`src/store/appStore.ts`、`src/utils/aheadBehindKey.ts`、`src/hooks/useAheadBehindSync.ts` 与读取 `aheadBehind` 切片的所有展示组件。

### 2. Signatures

```ts
// src/utils/aheadBehindKey.ts
export type AheadBehindKind = "local" | "wsl" | "remote";

export function aheadBehindKey(
  kind: AheadBehindKind,
  entryId: string,
  projectId: string,
): string;

// src/store/appStore.ts
interface AppStoreState {
  aheadBehind: Record<string, AheadBehind>;
}

interface AppStoreActions {
  setAheadBehind(key: string, info: AheadBehind | null): void;
}
```

### 3. Contracts

1. Key 派生契约：所有写入/读取路径必须经过 `aheadBehindKey()`，不允许直接拼接字符串。Local 侧退化为 `aheadBehindKey("local", projectId, projectId)`，仍走 helper。
2. 单一切片契约：跨三域的同语义状态共用一张表（`Record<key, T>`），不为每域单建独立切片。
3. 写入幂等契约：`setAheadBehind` 必须做同值短路（防止无意义 re-render）。
4. 清理契约：传 `null` 时从表中删除该 key，避免命令失败后陈旧数据残留。

### 4. Validation & Error Matrix

| 场景 | 输入 | 预期 |
|------|------|------|
| local 写入 | `aheadBehindKey("local", id, id)` | 只在 local 项目读到 |
| wsl/remote 写入 | `aheadBehindKey("wsl", distro, id)` | 仅命中 wsl 同 distro 同 id 的查询 |
| 命令失败 | invoke reject | `setAheadBehind(key, null)` 删除 key |
| 重复同值写入 | 现值 deepEqual 新值 | 不触发 setState |

### 5. Good/Base/Bad Cases

- Good：active 切换时单次 invoke 写一个 key，其余 key 不动。
- Base：active 离开后旧 key 仍在表里——展示侧由 `isActive` 守卫，不渲染陈旧 chip。
- Bad：直接 `aheadBehind[\`${distro}:${id}\`] = ...` 拼字符串——与 helper 派生的 key 互不兼容，永远 cache miss。

### 6. Tests Required

- `aheadBehindKey` 三种 kind 派生唯一字符串（无前缀冲突）。
- `appStore` 单测：`setAheadBehind(key, null)` 后 `aheadBehind[key]` 不存在；同值写入不触发订阅。
- 集成断言：local 与 wsl 同 `projectId` 互不读到对方数据。

### 7. Wrong vs Correct

#### Wrong

```ts
// 直接拼字符串，跨域未隔离
const k = `${distro}:${projectId}`;
useAppStore.getState().setAheadBehind(k, info);
```

#### Correct

```ts
import { aheadBehindKey } from "../utils/aheadBehindKey";

const k = aheadBehindKey("wsl", distro, projectId);
useAppStore.getState().setAheadBehind(k, info);
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

### 6. 切换项目时 global activeTabId 未同步

**问题**：`useAppStore` 同时持有 global `activeTabId` 和 per-project `tabs[projectId].activeTabId`。切换项目时如果只更新 `activeProjectId` 而不恢复 global `activeTabId`，TerminalView 会用旧项目的 tab ID 计算 `cacheKey`，导致 cache miss 和孤立 PTY 创建。

**正确模式**：任何修改 `activeProjectId` 的 setState 必须同步恢复 global `activeTabId`：

```tsx
// 正确：切换项目时同步 activeTabId
useAppStore.setState((state) => {
  const targetProjectTabs = projectId ? state.tabs[projectId] : null;
  return {
    activeProjectId: projectId,
    activeProject: projectId ? state.projects.find((p) => p.id === projectId) ?? null : null,
    activeTabId: targetProjectTabs?.activeTabId ?? null,
  };
});
```

```tsx
// 错误：只更新 activeProjectId，遗漏 activeTabId
useAppStore.setState((state) => ({
  activeProjectId: projectId,
  activeProject: projectId ? state.projects.find((p) => p.id === projectId) ?? null : null,
}));
```

**涉及函数**：`setActiveProjectId`、`handleRemoveProject`（useLocalProjects）、worktree 项目切换（useWorktreeActions）。

**TerminalView 防御性 guard**：TerminalView useEffect 内应校验 `activeTabId` 是否属于当前项目的 terminal tabs，若不属于则跳过 PTY 创建：

```tsx
if (activeTabId && !isWorktree && tabs.length > 0 && !tabs.some((t) => t.id === activeTabId)) {
  return; // stale activeTabId from another project
}
```
