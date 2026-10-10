# 状态管理

> 本项目中的状态管理方式。

---

## 概述

本项目使用 **React 内置状态** 与 **Context API**。跨领域共享状态放在 **Zustand 域 store**（`src/shared/store/` + feature `store.ts`），覆盖项目列表、激活项目/单元、编辑器 tab、文件视图、worktree、WSL/Remote 条目与认证状态。

状态协调已从 `App.tsx` 下沉到 `src/app/hooks/`：`useAppShell`（= `useAppGlobalEffects` + `useAppShellData` + `buildAppShellValues`）负责组装 Action Context 与连接领域 Hook，`useAppStoreSync` 只回写视图状态与动作引用。`App.tsx` 仅做装配。

---

## 状态分类

### 1. 应用级编排入口 `useAppShell`

跨领域状态由 `useAppShell`（`src/app/hooks/useAppShell.ts`）分层编排，**没有任何单一 app store**：

```tsx
// src/app/hooks/useAppShell.ts
export function useAppShell() {
  useAppGlobalEffects();                     // 应用级副作用（paste 监听 / quick-open 跟踪 / 滚动条自动隐藏）
  const data = useAppShellData();            // 领域 Hook 编排（useLocalProjects / useWorkspaceState / useFileView / useKeyboardShortcuts …）
  const values = buildAppShellValues(data);  // context value 装配（纯函数，可单测）
  return { initializing: data.initializing, appProvidersProps: values.appProvidersProps, ... };
}
```

- 状态按域落在 `src/shared/store/`（`projectStore` / `workspaceStore` / `editorStore` / `dockStore` /
  `appViewStore` / `gitStore` / `connectionStore` …）与 feature store（如 `@/features/file/store`）。
  消费者按域直导对应 store，禁止再造「大容器 hook」或统一聚合层。
- `App.tsx` 只做装配（`<AppProviders>` + `<AppShell/>`），零布局/面板编排；壳层骨架在
  `src/app/shell/` + `src/app/panels/`（registry 单一事实源）。
- 把「视图状态 + 动作引用」写回 `projectStore` 的那一段是 `useAppStoreSync`
  （`src/app/hooks/useAppStoreSync.ts`）：它同步 `isTerminalView` / `selectProject` / `openIde` /
  `setProjectIde`，**不再镜像 project/file 状态字段**（镜像 = 第二份表示）。

> **注意**：`useWslProjects` / `useRemoteProjects` 已废弃，统一入口请使用 `useConnectionProjects`（见 `features/project/hooks/`）。

### 2. Context 分发层

用于消除 prop drilling，按职责拆分为细粒度 Context：

| Context | 作用范围 | 典型消费者 |
|--------|---------|-----------|
| `AppContext` | 全局配置、agents、toast | `ProjectsPanel`、`ProjectView` |
| `ProjectActionsContext` | 项目与 worktree 副作用动作（含 local/WSL/Remote） | `ProjectsPanel`、`ProjectView` |
| `FileActionsContext` | 文件树加载、文件保存与 Tab 操作动作（`@/features/editor/FileActionsContext`） | `FilesPanel`、`FileViewer` |
| `WslContext` (legacy) | WSL 项目状态 + 操作（deprecated，使用 ProjectActionsContext） | `ProjectsPanel`、`ProjectView` |
| `RemoteContext` (legacy) | SSH 项目状态 + 操作（deprecated，使用 ProjectActionsContext） | `ProjectsPanel`、`ProjectView` |
| `EditorContext` | 终端 tabs 与 agent bar | `ProjectView` |

> Context 只放**动作**与稳定基础数据（`shared/contexts/` 为横切，feature 自带 `contexts/` 或
> `<X>Context.tsx`）。领域**状态**一律进 store —— 曾经的 `SkillContext` 已迁到 feature store
> （`@/features/skill/store` 的 `useSkillStore`），`ProjectStateContext` 已删除。

### 3. 组件本地状态

仅与当前组件 UI 行为相关的状态保留在组件内部：

```tsx
const [showAddMenu, setShowAddMenu] = useState(false);
const [dialog, setDialog] = useState<DialogState | null>(null);
```

### 4. Zustand 域 store

用于跨域状态读写和全局事件回调读取最新状态。**没有单一 app store** —— 按域直导对应 store：

```tsx
// 命令式读取（事件回调 / 命令式分支）：按需取那一个域，不是一个"全量快照"
useProjectStore.getState().selectProject(projectId);
// 渲染路径：用 selector 订阅
const appView = useAppViewStore((s) => s.appView);
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

通过 Tauri IPC（经 API wrapper）写入本地文件：

```tsx
import { saveConfig } from "@/features/settings/api/settingsApi";
import { saveSession } from "@/features/session/api/sessionApi";

await saveConfig(config);
await saveSession(session);
```

### 8. 中心视图路由（单一数据源 `appViewStore`）

中心区域（`app/components/AppCenter.tsx`）只读 `useAppViewStore.appView` 决定渲染：

- `settings`：条件渲染（切走即卸载）
- `library`：首次进入后常驻（hidden 切换，见 `AppCenter`）；再次激活后台刷新
- `normal`：`ProjectView`（常驻）

**写入方（禁止绕过）**：

- `settings`：`useToolbarFooterProps`（工具栏） / `SettingsView`（关闭）
- `library`：`openLibraryAt`（`src/features/library/store/libraryNavigation.ts`，唯一入口；先置选择态再开 tab，免 deferred 定时器）
- `normal`：上述视图退出后的兜底

注意：`dockStore` 持久化、`appViewStore` 不持久化。tab-mode 面板与左栏互斥：打开 Library
即收起左栏（含 Projects）、关闭即恢复原展开态（`openTabView` / `restoreLeftZone`，transient
不持久化）。禁止在 App.tsx / 业务组件里直接用 `dockStore.zones.*.activePanelId` 判断中心视图。

### 9. Dock 面板 toggle/activate 框架契约（`dockStore.togglePanel`）

所有面板切换（dock 栏按钮、快捷键）统一走此契约，禁止各面板自研开关语义：

- **toggle-off 仅当面板当前可见**：同 zone 内已激活且已展开 → 收起；其余一律按**激活**处理
> （切到该面板并展开）。
- **从 tab 视图退出时的本次点击强制激活**：tab 覆盖期间 zone 可见态是过期/被收起的，
> 此时若走 toggle 会反直觉地关掉用户刚点的面板（如 Library 中点 Projects 反而收起列表）。
- 快捷键（`toggleDockProjects` 等）复用同一入口，自动获得该语义，无需分支处理。

---

## 何时使用全局状态

本项目的全局状态是**按域拆分的 Zustand store**（`src/shared/store/` + feature store）
**加** Context 分发层（只放动作与稳定基础数据）。没有单一 app store：

| 归属 | store | 典型字段 |
| --- | --- | --- |
| 项目 | `projectStore` | `projects` / `activeProjectId` / `activeProject` / `statuses` / `git_info` 投影 |
| Workspace激活态 | `workspaceStore` | `byProject[projectId].activePath / activeBranch / opened` |
| 编辑器 tab | `editorStore` | `tabs[tabKey]` / `activeTabId` / `editorLayout` / `navigateGoal` |
| 文件视图 | `@/features/file/store` | `dirs` / `loadStates` / `activeFilePath` |
| 视图路由 | `appViewStore` | `appView` |

> 术语：`workspaceStore` 存的是**当前 `Workspace` 的激活态**（`Workspace` = Project 下的能力容器，
> 承载 IDE/Agent/editor/debug/LSP/terminal）。领域分层定义见
> [`docs/domain-model.md`](../../../docs/domain-model.md)（唯一定义处，本文不复述）。
| Dock | `dockStore` | 面板开合 / 宽度 |
| Git 元数据 | `gitStore` | `aheadBehind`（键 = `WorkspaceKey`） |

适合放入应用级状态的场景：

1. 多个区域需要读写同一份数据。
2. 存在跨领域联动，例如切换 WSL 项目时清理本地激活态。
3. 状态需要持久化到后端。

适合放入组件本地状态的场景：

1. 仅当前组件使用。
2. 状态只影响局部交互，不参与跨领域协调。

---

## 服务端状态

没有 HTTP API，所有后端状态通过 Tauri IPC（经 API wrapper）获取。

### 加载模式

```tsx
import { loadSession } from "@/features/session/api/sessionApi";

useEffect(() => {
  (async () => {
    try {
      const saved = await loadSession();
      // 校验并设置状态
    } catch (e) {
      console.error("[App] Failed to load session:", e);
    }
  })();
}, []);
```

### 保存模式

```tsx
import { saveSession } from "@/features/session/api/sessionApi";

const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const debouncedSave = useCallback(() => {
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(async () => {
    await saveSession(buildSessionData());
  }, 500);
}, []);
```

---

## 架构图

```
┌────────────────────────────────────────────────┐
│ App.tsx 装配层                                  │
│  AppProviders + AppShell + AppModals           │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│ useAppShell 编排入口                            │
│  useAppGlobalEffects + useAppShellData         │
│  （useLocalProjects / useProjectActions /      │
│    useWorkspaceState / useFileView / ...）       │
│  buildAppShellValues（纯函数装配 context value）│
│  useAppStoreSync（仅视图状态+动作引用回写）     │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│ Zustand 域 store 层（无单一 app store）         │
│  shared/store/*：project / worktree / editor / │
│  dock / appView / git / connection …           │
│  feature store：@/features/file/store …        │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│ Providers                                       │
│  shared/contexts/*: App + Editor + TerminalInsert│
│    + Wsl/Remote/ConnectionProject (legacy)      │
│  features/*: ProjectActions + FileActions       │
│  layout: DockRegistry                           │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│ Consumer Components / Hooks / Stores           │
│  DockLayout / ProjectsPanel / useActiveProject  │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│ Feature API Wrapper Layer                      │
│  features/*/api/*Api.ts                        │
│  (集中封装 invoke 调用)                        │
└────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────┐
│ Tauri IPC (invoke / listen)                     │
└────────────────────────────────────────────────┘
```

---

## 场景：Project/File 状态单源化迁移 2026-04-21

> **结论仍是硬约束，符号已随目录迁移**：本场景要根治的是「hook 内 `useState` 持状态 + 回写 store」
> 造成的双数据源（组件同时消费 Context 与 Store，两边各自演化）。这条禁令今天依然成立；下列名称
> 已改名/搬家（**不要按旧路径导入**）：
>
> | 旧 | 现 |
> | --- | --- |
> | `src/store/appStore.ts` | 2026-05-26 拆为 `src/shared/store/<domain>Store.ts`（project / worktree / editor / dock / appView / git / connection）+ feature store（`@/features/file/store`） |
> | `useAppContainer` | `useAppShell`（`src/app/hooks/useAppShell.ts` = `useAppGlobalEffects` + `useAppShellData` + `buildAppShellValues`） |
> | `useSyncToStore` | `useAppStoreSync`（`src/app/hooks/useAppStoreSync.ts`，只回写视图状态 + 动作引用） |
> | `src/hooks/` | `src/shared/hooks/`（共享）或 `src/features/<domain>/hooks/`（域内） |
> | `src/contexts/file-actions-context.tsx` | `src/features/editor/FileActionsContext.tsx` |
> | `src/AppProviders.tsx` | `src/app/AppProviders.tsx` |
> | `ProjectStateContext` | 已删除（项目状态进 `projectStore`；副作用动作在 `ProjectActionsContext`） |

### 1. Scope / Trigger

- Trigger：`ProjectStateContext` 与「hook 内 `useState` + 回写 store」造成双数据源，组件同时消费 Context 与 Store。
- Scope：`src/shared/store/`、`src/features/file/store.ts`、`src/app/hooks/`、`src/features/editor/hooks/useFileView.ts`、
  `src/features/editor/FileActionsContext.tsx`、`src/app/AppProviders.tsx`、`src/shared/contexts/`、消费端组件。

### 2. Signatures

```ts
// 状态按域分槽，不是一个 AppStoreState 大对象
// src/shared/store/projectStore.ts
projects: Project[];
activeProjectId: string | null;
activeProject: Project | null;
// src/shared/store/workspaceStore.ts
byProject: Record<projectId, { activePath: string | null; activeBranch: string; opened: CheckoutEntry[] }>;
// src/shared/store/editorStore.ts —— tabs 按 **checkout 身份 WorkspaceKey** 分槽（project + worktree 各有独立 tab 空间；
// 旧 `:wt:` 编码的 `resolveTabKey` 已退役）
tabs: Record<WorkspaceKey, ProjectTabs>;
activeTabId: string | null;   // 全局：当前视图的激活 tab（cacheKey 等消费）
// src/features/file/store.ts —— 文件树按目录分槽 + 归属校验
owner: FileTreeOwner | null;               // `${projectId}:${rootPath}`，切换即作废旧缓存与在途响应
dirs: Record<DirPath, FileNode[]>;         // 目录 → 该目录一级条目
loadStates: Record<DirPath, DirLoadState>;
activeFilePath: string | null;

// src/features/editor/FileActionsContext.tsx —— Context 只放动作
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
`projects` / `activeProject*` 在 `projectStore`；`activeWorktree*` 在 `workspaceStore`；tabs 在
`editorStore`；文件树与 `activeFilePath` 在 `@/features/file/store`。组件按域经 selector 读取，
**不存在「一个 store 装全部」的聚合层**。

2. Context 职责契约
`ProjectActionsContext` 只承载项目与 worktree 的副作用动作。
`FileActionsContext` 只承载文件读取、保存、标签页操作动作。
`ProjectStateContext` 不再作为共享状态入口（已删除）。

3. 同步层契约
`useAppStoreSync` 只同步视图状态与动作引用（`isTerminalView` / `selectProject` / `openIde` /
`setProjectIde`），**不接受 `projects` / `activeProjectId` / `activeProject` 参数**（镜像写回 = 第二份表示）。

### 4. Validation & Error Matrix

| 场景 | 输入 | 预期 | 错误处理 |
|------|------|------|---------|
| 目录加载成功 | `loadDir(owner, dirPath)` | `dirs[dirPath]` 更新、`loadStates` = loaded | 无 |
| 目录加载失败 | IPC 抛错 | **保留旧内容**并标 error（不置空） | UI 可重试 |
| 归属已切换 | 在途响应回来时 `owner` 变了 | 丢弃响应 | 静默 |
| 请求乱序 | `requests[dirPath]` 序号不匹配 | 丢弃迟到响应 | 静默 |
| `openFile` 命中已打开 tab | 同一 tab 身份 | 仅切换激活（`editorStore.activeTabId`） | 无 |
| `saveFile` 失败 | `write_file_content` 抛错 | 返回 `false`，`isDirty` 保留 | 编辑器保持编辑态 |

### 5. Good/Base/Bad Cases

- Good：打开未打开文件 → 新增 tab 并激活，`activeFilePath` 与激活 tab 对齐。
- Base：关闭当前 tab → 激活相邻 tab；关闭最后一个 tab 后 `activeTabId` 为 `null`。
- Bad：无激活 tab 时执行保存 → 返回 `false`，store 不写入脏数据。

### 6. Tests Required

- `useFileView` 单测断言
`openFile` 命中已存在 tab 时不追加 file tab 数量。
`closeTab` 关闭当前 tab 时 `editorStore.activeTabId` 回退正确。
`saveFile` 成功后 `isDirty=false`，失败后保持 `isDirty=true`。
- 组件集成断言
`FilesPanel`（原 `FileViewer` / `AppLayout` 时代）读 `@/features/file/store` 的 `dirs` / `activeFilePath` 渲染。
文件动作经 `FileActionsContext` 下发，组件不直接 invoke。
- 回归断言
`pnpm type-check` 必须通过。
`pnpm test:fe` 必须通过。

### 7. Wrong vs Correct

#### Wrong

```tsx
// 状态在 hook 内 useState 持有，再镜像回 store（双数据源）
const [dirs, setDirs] = useState<Record<string, FileNode[]>>({});
useAppStoreSync({ projects, activeProject, dirs, ... });
```

#### Correct

```tsx
// 状态直接进所属域 store，hook 只负责动作与错误处理
const dirs = useFileStore((s) => s.dirs);          // @/features/file/store
await useFileStore.getState().loadDir(owner, dirPath, loader);
const projectTabs = useEditorStore.getState().tabs[tabKey]; // tab 按复合 tabKey 分槽
```

---

## 场景：异步全量刷新防陈旧覆盖 (git status 竞态) 2026-08-07

> **机制已被下文「Workspace分槽 + 激活态单源」(2026-09-26) 取代**：本场景要解决的问题（乱序
> 响应回退 store）依然存在，但解法从「前端自造 per-project generation Map」换成了「后端为每
> 个Workspace盖权威 version + 前端 per-key 闸门」。换的原因不是风格，而是 generation Map 与
> `worktreePath` 全局镜像同构 —— 都是前端自己维护的第二份身份/顺序表示，恰恰是 worktree 串
> 数据的来源。以下代码只作历史保留，**不要照抄**。

### 1. Scope / Trigger

- Trigger：高频事件（如 `git-changed` 在 `pnpm tauri build` 期间每秒数十次触发）回调里以 fire-and-forget 调用全量刷新函数（`refreshGitFileStates`），后端响应不保证按入队顺序到达，晚到的陈旧响应覆盖新响应写入的 store 状态，文件列表的 git status 标记出现"已变更但仍显示旧状态"。
- Scope：`src/features/git/utils/gitStatus.ts` 的 `refreshGitFileStates` 及其所有 fire-and-forget 调用方（`useSessionBootstrap` 的 `git-changed` 监听、`refreshGitInfo` 的 `changed_files` patch 路径）。

### 2. Signatures

```ts
// src/features/git/utils/gitStatus.ts
// 模块级 generation 计数器，跨调用方共享
const refreshGenerations = new Map<string, number>();

export async function refreshGitFileStates(
  projectId: string,
  worktreePath?: string,
): Promise<void> {
  const myGen = (refreshGenerations.get(projectId) ?? 0) + 1;
  refreshGenerations.set(projectId, myGen);
  const [changedFiles, ignoredFiles] = await Promise.all([
    getWorktreeChangedFiles(projectId, worktreePath).catch(() => []),
    getIgnoredFiles(projectId, worktreePath).catch(() => []),
  ]);
  // 写入前再读：陈旧响应直接 return
  if (refreshGenerations.get(projectId) !== myGen) return;
  useProjectStore.setState({ projects: nextProjects });
}
```

### 3. Contracts

1. **Generation 单调递增契约**：每次进入函数 `myGen = (prev ?? 0) + 1` 并写回 `refreshGenerations`；新调用必须使旧调用的 `myGen` 失效。
2. **写入前再读契约**：拿到 `setState` 调用权时（无论在 `await` 前还是 `await` 后），必须 `refreshGenerations.get(projectId) === myGen`，否则放弃本次写入。
3. **模块级共享契约**：counter 必须是模块级 `Map`（不是 hook 内 `useRef`），保证 `git-changed` 监听与显式调用走同一个 generation 域。
4. **静默丢弃契约**：陈旧响应不抛错、不向 UI 报"陈旧"错误。

### 4. Validation & Error Matrix

| 场景 | 输入 | 预期 | 错误处理 |
|------|------|------|---------|
| 单次刷新 | 一次 `refreshGitFileStates` | generation 自增 1，正常写入 | 无 |
| 并发 A→B，B 先 resolve | A 入队后 B 入队；B 先返回 | A 写入前发现 generation 改变，return | 无 |
| 并发 A→B，A 先 resolve | A 写入后 B 再 resolve | B 写入前发现 generation 改变，return | 无 |
| API reject | `getWorktreeChangedFiles` reject | 已提前 return，不进入守卫分支 | 静默忽略（保持原契约） |

### 5. Good/Base/Bad Cases

- Good：build 中 50 次 `git-changed` 事件只产生 1 次最终有效写入（最后一次），UI 不抖动。
- Base：单次刷新，generation 1→2，写入正常。
- Bad：不带 generation 守卫的 fire-and-forget，后端响应乱序到达导致 store 回退到旧 snapshot。

### 6. Tests Required

- `src/features/git/utils/__tests__/gitStatus.test.ts` 必须包含「并发刷新时仅最新一代的全量快照生效,陈旧请求的结果被丢弃」（或同义命名）。
- **测试必须确定性暴露 bug**：不能用「`A` 的 `setState` 排在 `B` 之后」这种依赖 Node 微任务 FIFO 顺序的断言（`.catch()` 会为每个 promise 引入额外微任务跳，使未修复代码也碰巧通过——假 GREEN）。正确做法：让**先 `setState` 的回调主动 `resolve` 后入队的 promise**，把后者的 `setState` 强制排进下一轮微任务，确定性暴露顺序差异。
- **回归验证**：提交前临时删除 `refreshGenerations` 守卫，测试必须 RED（最后写入非最新代）；恢复守卫后 GREEN。

### 7. Wrong vs Correct

#### Wrong

```ts
// 每次调用独立 setState，后到达的响应覆盖先到达的
export async function refreshGitFileStates(projectId: string) {
  const [changed, ignored] = await Promise.all([
    getWorktreeChangedFiles(projectId).catch(() => []),
    getIgnoredFiles(projectId).catch(() => []),
  ]);
  useProjectStore.setState({ projects: nextProjects });
}
```

#### Correct

```ts
const refreshGenerations = new Map<string, number>();

export async function refreshGitFileStates(projectId: string) {
  const myGen = (refreshGenerations.get(projectId) ?? 0) + 1;
  refreshGenerations.set(projectId, myGen);
  const [changed, ignored] = await Promise.all([
    getWorktreeChangedFiles(projectId).catch(() => []),
    getIgnoredFiles(projectId).catch(() => []),
  ]);
  if (refreshGenerations.get(projectId) !== myGen) return;  // 陈旧响应丢弃
  useProjectStore.setState({ projects: nextProjects });
}
```

---

## 场景：跨域共用切片 + 复合 key 2026-05-18

> **「复合 key」部分已被下文「Workspace分槽 + 激活态单源」(2026-09-26) 取代**：本条要解决的
> 问题（三端共用一张 `Record<key, T>` 表、key 不许各处手拼）依然成立，但**key 的形态**换了 ——
> `aheadBehindKey(kind, entryId, projectId)` 工具已删除（护栏 `RETIRED_FRONTEND` 按符号钉），
> 定址只允许Workspace身份 `WorkspaceKey` 本身。换的原因不是风格：`{source}:{connectionId}` 前缀在
> 三个写入点各有一种 `connectionId` 约定（`distro` / `${host}:${port}` / `host`），读侧永远
> 拼不出写侧的键，于是徽标时有时无。下面第 3 节的「单一切片 / 幂等写入 / 清理」三条契约仍然
> 有效；第 2、4、7 节已按现行形态改写（历史形态只在对应位置留下一行注记，不要照抄）。

### 1. Scope / Trigger

- Trigger：同一后端结果需要跨多个目标缓存（本场景的实例是 ahead/behind），不许每个消费点各自持
  一份状态。**当年的前提已被证伪**：`projectId` 在 wsl/remote 之间并非不唯一 —— `project.id` 是
  `ProjectManager` 生成的 UUID，全局唯一。于是当时的「复合 key」方案
  （`{source}:{connectionId}:{projectId}`）不但冗余，还因为三个写入点各用一种 `connectionId`
  约定（`distro` / `${host}:${port}` / `host`）而让读侧永远拼不出写侧的键 —— 键最终收敛为Workspace
  身份 `WorkspaceKey`（见 2026-09-26 场景第 7 条）。
- Scope：`shared/store/gitStore.ts`（`aheadBehind` 切片）、`shared/hooks/useAheadBehindSync.ts` 与读取
  `aheadBehind` 切片的所有展示组件（`shared/utils/aheadBehindKey.ts` 已删除，见下）。

### 2. Signatures

```ts
// 历史形态（已删除）：key = `${kind}:${entryId}:${projectId}`，且三端各用一种 entryId 约定
// export function aheadBehindKey(kind: AheadBehindKind, entryId: string, projectId: string): string;

// 现行形态：键的语义类型是Workspace身份 `WorkspaceKey`（`shared/utils/workspaceRef.ts` 的 `WorkspaceSession#key`）；
// 结构类型仍是 `string`，因此「传了非 WorkspaceKey 的字符串」不会编译报错 —— 靠本契约与护栏守。
interface GitStoreState {
  aheadBehind: Record<string, AheadBehind>; // 键 = WorkspaceKey
}

interface GitStoreActions {
  setAheadBehind(workspaceKey: string, info: AheadBehind | null): void;
}
```

### 3. Contracts

1. Key 派生契约（**已改**）：所有写入/读取路径必须经过唯一产出点 `WorkspaceSession.of(projectId, worktreePath ?? null).key`
   —— 就是「场景：Workspace分槽 + 激活态单源」第 7 条。不允许任何前缀拼接（`source` / `connectionId`
   维度已判为冗余：`project.id` 是 UUID，`WorkspaceKey` 已全局唯一）。
2. 单一切片契约：跨三域的同语义状态共用一张表（`Record<key, T>`），不为每域单建独立切片。
3. 写入幂等契约：`setAheadBehind` 必须做同值短路（防止无意义 re-render）。
4. 清理契约：传 `null` 时从表中删除该 key，避免命令失败后陈旧数据残留。

### 4. Validation & Error Matrix

| 场景 | 输入 | 预期 |
|------|------|------|
| local 写入 | `setAheadBehind(WorkspaceSession.of(pid, null).key, ab)` | 只在主仓单元读到 |
| worktree 写入 | `setAheadBehind(WorkspaceSession.of(pid, wt).key, ab)` | 只在该单元读到，主仓单元不受影响 |
| 命令失败 | invoke reject | `setAheadBehind(workspaceKey, null)` 删除 key |
| 重复同值写入 | 现值 deepEqual 新值 | 不触发 setState |

### 5. Good/Base/Bad Cases

- Good：active 单元切换时单次 invoke 写一个 key，其余 key 不动。
- Base：active 离开后旧 key 仍在表里——展示侧由「是否当前单元」守卫，不渲染陈旧 chip。
- Bad：重新引入任何 `{source}:{connectionId}` 前缀或直接 `aheadBehind[projectId]` 读
  —— 键空间里不存在这种键，徽标恒空（`BranchStatusBarWidget` 曾经的既存 bug）。

### 6. Tests Required

- `WorkspaceSession#key` golden 形态与后端 `WorkspaceRef::key()` 逐字一致（`shared/utils/__tests__/workspaceSession.test.ts`）。
- `gitStore` 单测：`setAheadBehind(workspaceKey, null)` 后该 key 不存在；同值写入不触发订阅。
- 集成断言：主仓单元与 worktree 单元的 key 互不读到对方数据
  （`useRefreshGitInfo.test.ts` / `BranchStatusBarWidget.test.tsx` / `ConnectionProjectCard.test.tsx`）。

### 7. Wrong vs Correct

#### Wrong

```ts
// 重新引入前缀拼接：读侧拼不出写侧的键
const k = `${distro}:${projectId}`;
useGitStore.getState().setAheadBehind(k, info);
```

#### Correct

```ts
import { WorkspaceSession } from '../utils/workspaceRef';

// 单元身份本身即键；unitPath 取自 store selector，不各自猜
const k = activeWorkspaceSession(projectId).key;
useGitStore.getState().setAheadBehind(k, info);
```

---

## 场景：资源库双视图 + 分类持久化 2026-07-29

### 1. Scope / Trigger
- Trigger：Resource Library 面板需要记住用户上次查看的 kind（Skills/Prompts/Actions）和视图模式（grid/list）
- Scope：`src/features/library/store/libraryStore.ts`

### 2. Signatures

```ts
// src/features/library/store/libraryStore.ts
interface LibraryState {
  activeKind: ResourceKind;        // 'skill' | 'prompt' | 'action'
  viewMode: ViewMode;              // 'grid' | 'list'
  searchQuery: string;
  tagFilter: string[];
  scopeFilter: 'all' | 'global' | 'project';
  selectedId: string | null;
}

interface LibraryActions {
  setActiveKind(kind: ResourceKind): void;
  setViewMode(mode: ViewMode): void;
  toggleViewMode(): void;
  setSearchQuery(q: string): void;
  // ...
}
```

### 3. Contracts
- 持久化契约：`activeKind` 和 `viewMode` 通过 zustand `persist` 中间件持久化到 `~/.neeko/config.json` 的 `library` 域
- `partialize` 仅持久化 `{ activeKind, viewMode }`，不持久化搜索/过滤等临时状态
- 默认值：`activeKind='skill'`、`viewMode='grid'`

### 4. Validation & Error Matrix
| 场景 | 输入 | 预期 |
|------|------|------|
| 首次打开 | 无持久化数据 | 使用默认值 skill + grid |
| 切换 kind | 点击 Prompts tab | `activeKind='prompt'`，持久化 |
| 切换视图 | 点击列表图标 | `viewMode='list'`，持久化 |
| 关闭再打开 | 读取持久化 | 恢复上次的 kind + viewMode |

### 5. Good/Base/Bad Cases
- Good：用户切换到 Prompts + list 视图，关闭面板，下次打开保持该状态
- Base：用户在 Skills tab 刷新页面，保持 Skills
- Bad：搜索关键词被持久化 — 不应持久化临时状态

### 6. Tests Required
- Store 单测：`setActiveKind` 更新状态并触发 persist
- Store 单测：`toggleViewMode` 在 grid/list 间切换
- 集成：关闭/打开面板后状态恢复

### 7. Wrong vs Correct
#### Wrong
```ts
// 持久化整个 state（含临时搜索状态）
persist((set) => ({ ... }), { name: 'library' })
```
#### Correct
```ts
// 仅持久化用户偏好
persist((set) => ({ ... }), {
  name: 'library',
  partialize: (s) => ({ activeKind: s.activeKind, viewMode: s.viewMode }),
})
```

---

## 场景：浏览器按项目隔离 2026-08-06

### 1. Scope / Trigger

- Trigger：浏览器原本所有项目共用一个 webview（全局单 store），需要按项目隔离——每个项目独立 webview、切换项目时 show/hide、URL 保持。
- Scope：`src-tauri/src/browser/commands.rs`、`src/shared/store/browserStore.ts`、`src/features/browser/`（api/hooks/utils）。

### 2. Signatures

```ts
// src/features/browser/hooks/useBrowserConstants.ts
export const getProjectBrowserLabel = (projectId: string): string =>
  `neeko-browser-${projectId}`;

// src/shared/store/browserStore.ts
interface BrowserPanelState {
  label: string;
  url: string;
  isCreated: boolean;
  isLoading: boolean;
}

interface ProjectBrowserStore {
  states: Record<string, BrowserPanelState>;              // 按 projectId 索引
  getPanelState: (projectId: string) => BrowserPanelState; // 幂等创建默认态
  setPanelState: (projectId: string, patch: Partial<BrowserPanelState>) => void;
  removeState: (projectId: string) => void;
  navigateTo: { (url: string): void; (projectId: string, url: string): void }; // 单参重载取 activeProjectId
  reset: () => void;
}
```

Rust 端事件 payload（`browser://url-changed` / `browser://page-loaded` / `browser://open-url` / `browser://loading`）：

```rust
serde_json::json!({ "label": &label, "url": &url_str })
```

**元素选择器协议**（`browser://prompt-submitted` / `browser://picker-cancelled` / `browser://element-picked`）：注入脚本经 `neeko://` 自定义协议 POST 回传，Rust `uri_scheme.rs` 解析后转事件。`prompt-submitted` 载荷为**元素数组**（单选长度 1，多选长度 N）：

```ts
// 前端 PromptSubmittedPayload（src/features/browser/hooks/useBrowserPanel.ts）
{
  prompt: string;
  elements: Array<{ html: string; selector: string }>; // selector 为注入脚本简写（tag+#id+前两个 class）
}
```

前端校验 `Array.isArray(data.elements) && length > 0` 后才组装 `formatPickerMessage`；未选中 Agent CLI tab 时 toast + 重新注入。

### 3. Contracts

1. **Label 契约**：dock 面板 webview label 恒为 `neeko-browser-{projectId}`；编辑器 Browser tab webview label 恒为 `neeko-browser-tab-{tabId}`。前端一律经 `getProjectBrowserLabel()` / `getBrowserTabLabel()` 派生，禁止手写拼接。
2. **事件隔离契约**：Rust 事件 payload 必须携带 `label` 字段；前端监听后按 `eventLabel !== getProjectBrowserLabel(activeProjectId)`（面板）或 `data.label !== label`（tab）过滤，忽略其他 webview 的事件。
3. **Store 隔离契约**：`states` 按 `projectId`（面板）或 `tabId`（tab）索引，`setPanelState` / `setTabState` 只 patch 目标，互不影响。
   - **禁止部分写入残缺状态**：`set{Panel,Tab}State(id, patch)` 在 `states[id]` 不存在时必须先用 `default{Panel,Tab}State(label)` 完整初始化再合并 patch。若直接 `{ ...states[id], ...patch }`（对 undefined 展开），会生成缺 `history`/`label`/`url` 的残缺状态，渲染时 `canGoBack(browserState.history)` → `undefined is not an object (stack.index)` 整个应用崩溃（2025 实测）。
   - 调用方若在无状态时写 store（如 panel 的 `navigate` 直接 `setPanelState`），也必须依赖此完整初始化语义，不得假设状态已由 `getPanelState` 创建。
4. **项目切换契约**：切换项目时隐藏旧项目 webview；新项目浏览器已开启（`isCreated`）则恢复其 webview 可见并激活 dock 浏览器面板（保持布局），未开启则把右侧 dock 从浏览器面板切到默认面板或收起——不展示空浏览器面板。决策逻辑收敛在 `decideProjectSwitchDock` 纯函数（`src/features/browser/utils/projectSwitchDock.ts`）。
5. **URL 持久化**：仅内存（当前会话），不落盘。
6. **浮层 z-order 契约**（`overlayStore`）：DOM 浮层（action 菜单 / quick-open / 右键菜单 / 确认对话框）打开时 `setOverlayOpen(id, true)`，关闭时 `setOverlayOpen(id, false)`，`useBrowserTab` 据此在浮层期间隐藏悬浮 webview。**浮层所属组件必须在 unmount 时兜底清除自身 overlay id**（`useEffect(() => () => setOverlayOpen(id, false), [])`）：否则 pane 在浮层打开状态下被卸载（切项目/关 pane）会让 `count` 永久 >0，Browser webview 一直隐藏直到其他浮层开关。

### 4. Validation & Error Matrix

| 场景 | 输入 | 预期 |
|------|------|------|
| 首次 getPanelState | 新 projectId | 创建默认态（label 派生、url=''、isCreated=false） |
| 切换项目（目标已开浏览器） | isCreated=true | dock 激活 browser 面板 + webview 可见 + bounds 恢复 |
| 切换项目（目标未开浏览器） | isCreated=false | 右侧 dock 切到 zone 内第一个非 browser 面板；只剩 browser 则收起 |
| 右侧 dock 收起 | expanded=false | 不打扰布局（decision 返回 none） |
| 浏览器面板不在右侧 | panels 不含 browser | add-and-activate（togglePanel 重新加入） |

### 5. Good/Base/Bad Cases

- Good：项目 A 开浏览器访问 URL_X，切到项目 B（未开浏览器）右侧显示默认面板，切回 A 恢复浏览器面板 + URL_X + 布局。
- Base：项目 B 浏览器已开启，切走再切回，webview 保持 URL_Y 与滚动位置。
- Bad：事件 payload 不带 label——项目 A 的导航事件被项目 B 误收，地址栏串台。

### 6. Tests Required

- `useProjectBrowserStore`：getPanelState 幂等、项目隔离、navigateTo 单参重载、reset/removeState。
- `decideProjectSwitchDock`：8 个决策分支（已开/未开 × 面板状态）。
- `getProjectBrowserLabel`：label 派生格式。

### 7. Wrong vs Correct

#### Wrong

```ts
// selector 中调用带 set 副作用的 action（渲染期触发 setState）
const browserState = useProjectBrowserStore((s) => s.getState(activeProjectId));
```

#### Correct

```ts
// selector 无副作用读取；写操作统一走 action
const browserState = useProjectBrowserStore((s) =>
  activeProjectId ? (s.states[activeProjectId] ?? null) : null,
);
```

---
## 场景：Tab 关闭入口统一走未保存确认编排 2026-09-04

### 1. Scope / Trigger

新增或修改任何「关闭 editor tab」的入口（TabBar X 按钮、菜单 `CLOSE_TAB_EVENT`、键盘快捷键、保存后自动关等）时，必须经 `closeTabWithConfirmation` 统一编排，禁止直调 `closeEditorTab`。直调会绕过未保存确认，导致用户输入内容静默丢失（历史事故见常见错误 10）。

### 2. Signatures

```ts
// src/features/editor/store/closeConfirmStore.ts（zustand store + 共享编排同文件）
useCloseConfirmStore.request(fileName: string): Promise<'save' | 'discard' | 'cancel'>;
useCloseConfirmStore.resolve(action: 'save' | 'discard' | 'cancel'): void;
closeTabWithConfirmation(tabKey: string, tabId: string, saveTab?: (tabId: string) => Promise<boolean>): Promise<boolean>;
```

### 3. Contracts

- dirty 文件 tab（`isDirtyFileTab`）→ 经 store 弹三选确认框（全局唯一实例，渲染于 `AppModals`）。
- `'cancel'` → 不关；`'discard'` → 直接关；`'save'` → `saveTab` 成功才关（失败含 Save As 取消 → 不关）。
- 非 file tab / 非 dirty → 直关，不弹框。
- 关闭一律经 `@/features/terminal` 门面 `closeEditorTab`（PTY 回收等清理不绕过）。
- 保存动作显式注入（如 `useAppShellData` 把 `fileView.saveTabById` 传给 `closeActiveTabCommand` / `useTabManagement`），不设模块级注册器。

### 4. Validation & Error Matrix

- `saveTab` 缺省或返回 `false` → 视同保存失败，tab 不关闭。
- 并发 `request()` → 旧 Promise resolve `'cancel'`（旧 tab 保持打开，无悬挂泄漏）。
- `resolve()` 幂等（resolver 已空时 no-op）；overlay 'close-confirm' 计数幂等。

### 5. Good/Base/Bad Cases

- Good：`useTabManagement.handleCloseTab` → `closeTabWithConfirmation(tabKey, tabId, saveTabById)`。
- Base：非 dirty 文件 tab 关闭 → 直关，无弹框。
- Bad：任何路径直接 `closeEditorTab(tabKey, tabId)` 关闭可能 dirty 的文件 tab。

### 6. Tests Required

- 每条关闭入口 4 分支：cancel 不关 / discard 关（不调 saveTab）/ save 成功关（调 saveTab）/ save 失败不关；外加非 file 与非 dirty 直关分支。断言点：`closeEditorTab` 门面调用参数 + `saveTab` 是否被调。
- `closeConfirmStore.test.ts`：三选回传、并发排队（旧 Promise resolve 'cancel'）、overlay 计数幂等。

### 7. Wrong vs Correct

#### Wrong

```ts
// 新增关闭入口直调门面，绕过确认
listen(SOME_CLOSE_EVENT, () => closeEditorTab(resolveTabKey(), activeTabId));
```

#### Correct

```ts
listen(SOME_CLOSE_EVENT, () => {
  void closeTabWithConfirmation(tabKey, activeTabId, saveTabById);
});
```

## 场景：停点跟随（异步链代际守卫 + 跟随改为派生状态） 2026-09-16

### 1. Scope / Trigger

- Trigger：issue #13 —— 调试停点 / 单步时编辑器**有时**不跳到当前断点位置，重新点一下栈帧中的函数才能定位。两个成因叠加：
  1. 停点的异步链（取栈 / 取变量 / 取源码内容）**只校验 `sessionId`**：旧停点迟到完成的链会把 `frames` / 位置写回 store，覆盖新停点（「黄线在新停点、编辑器停在旧停点」）；
  2. 「编辑器跟随停点」被实现成**一次性事件**（全局单槽 `editorStore.pendingNavigateTarget` + 命中即清槽 + rAF 兑现）：槽清掉后若兑现落空（视图被重建 / 尚未测量），跳转**静默丢失且无从补偿**。
- Scope：`src/features/runner/store/debug/**`（栈切片 + 代际）、`src/features/runner/stopLocation.ts`（位置单一归属：类型 / 构造 / 状态对，切片 3 / R5）、`src/features/runner/navigate.ts`（tab 生命周期）、`src/features/runner/hooks/useStopLocation.ts`（编辑器侧唯一输入面，切片 3 / R6）、`src/features/editor/hooks/useDebugStopReveal.ts`、`src/features/editor/stopMatch.ts`。
- 与「异步全量刷新防陈旧覆盖 (git status 竞态)」**同类**（异步乱序落地），但本例多一条更强的结论：**能从状态推导的「期望视图」不该做成事件**。

### 2. Signatures

```ts
// ① 代际（runner/store/debug/stopGeneration.ts，纯函数）
export type StopGeneration = { sessionId: string; seq: number };
export function nextGeneration(sessionId: string): StopGeneration;
export function isSameGeneration(a: StopGeneration | null, b: StopGeneration | null): boolean;

// ② 位置 = 唯一真相 + 严格单调的事件键（**单一归属**：runner/stopLocation.ts）
//    —— 类型 / 构造 / 状态对 / 变更函数同住一个叶子模块（切片 3 / R5）。位置**不**放
//    `store/debug/`：那会让域层（stackFrames.ts）反向依赖 store 内部件。
export interface StopLocation { identity: string; line: number; column: number } // 规范源身份
export interface StopLocationState {
  location: StopLocation | null;
  locationSeq: number;                    // 停点/切帧/清空都 +1
}
export function buildStopLocation(frame: StackFrameDto, projectRoot: string): StopLocation | null;
export function withStopLocation(cur: StopLocationState, next: StopLocation | null): StopLocationState;
// 一次停点 = 一次原子 set（帧 + 选中帧 + 位置 + 序号），不允许分次写
// 依赖方向：store/debug/* → stopLocation.ts → stackFrames.ts → fileRef.ts（单向，无环）

// ③ 跨 feature 的异步落地许可（runner/navigate.ts）
export async function ensureStopSourceTab(
  req: { projectId; projectPath; frame; sessionId?; isCurrent: () => boolean },
  onError?: (m: string) => void,
): Promise<string | null>;   // await 之后、addTab/activateTab 之前必须 isCurrent()

// ④ 编辑器侧：**唯一**只读派生输入面 + 幂等兑现
export function useStopLocation(): { identity; line; column; seq; status } | null; // 含 activeProject 门控
export function useDebugStopReveal(p: {
  absFilePath; tabFilePath; editorViewRef; viewEpoch;
}): void;   // effect 依赖 [stop, targetLine, viewEpoch]，按 seq 判「新事件」并重放
```

### 3. Contracts

1. **代际单调**：每次停点刷新入口取新代际并使在途旧链失效；所有 `await` 之后落地前必须 `isSameGeneration(get().generation, gen)`，否则**整条链放弃**（不写帧 / 位置 / 变量，也不建 tab、不抢激活）。
2. **原子写**：一次停点的 `frames` / `selectedFrameId` / `location` / `locationSeq` 必须在**同一次 `set`** 内落地 —— 分次写会产生「新位置 + 旧帧」的可观测中间态。
3. **位置单写者 + 规范身份**：位置只能由唯一构造点产出（`stopLocation.buildStopLocation`）；同一停点的多个写入口径（裸 `Source.path` vs 规范身份）会让黄线与跳转判定分叉。位置的**类型 / 构造 / 状态对 / 变更函数**必须同住 `runner/stopLocation.ts` —— 概念被拆到多处时，任一处单独演化都会让「位置」出现第二种口径。
4. **事件键必须严格单调**：`locationSeq` 不是可派生冗余 ——「位置值相同」≠「事件相同」（循环里连续命中同一行），编辑器必须能区分「又停了一次」才能重新接管光标。
5. **事件型 vs 派生型判据**：能用 store 状态推导的「期望视图」（编辑器展示当前停点）必须**派生 + 幂等重放**；只有真正的**用户意图**（定义跳转 / quick-open / 链接 / 点断点）才用一次性槽消费。
6. **异步链的落地许可用注入式谓词**：跨 feature 的异步落地把「还算不算数」作为 `isCurrent: () => boolean` 注入，调用方各自给出正确判据（自动停点 = 代际；点栈帧 = `selectedFrameId` 仍是该帧 **且** 停点上下文未变），navigate 不认识代际类型。
7. **「代际相等」与「停点上下文未变」是两个谓词，不可互换**：`isSameGeneration(null, null) === false` 是该模块的**有意约定**（链条由 `beginStop` 起；store 代际变 null = 已结束 ⇒ 丢弃在途链）。但**切帧不 `beginStop`**，它的复查是「捕获一次、await 后比对」，此时「捕获时无代际、复查时仍无代际」= **什么都没发生** ⇒ 必须用 `stopContextUnchanged(current, captured)`（双方皆无 = 未变；仅一侧无 = 已变；都有 = 比代际）。用错会让未过 `beginStop` 的停止态（attach 到已暂停进程、测试直接 seed frames+session）**静默不写变量、不打开源码 tab**。
8. **视图局部接管**：光标离开「我方放置的位置」即视为用户接管，本次事件键内不再夺回；新事件键恢复跟随。释放光标只在「光标仍停在我们放置的行」时执行。
9. **停点输入面只有一处 store 读取（单视图订阅槽 = 2）**：编辑器侧的两个消费者（`useDebugStopReveal` 光标 / `useCurrentLineHighlight` 黄线）都必须只消费 `useStopLocation`，不得自行读 debug / project store 或再调 `useVisibleDebugSession()`。理由：两者都需要「位置 + 会话状态」，各自订阅会把单视图展开成 6 个槽，且「会话属于当前项目」门控在多处各判一遍 —— 漏一处就是 #14（别项目停点画到本项目编辑器）。`useStopLocation` 用**一次** `useShallow` 选择器取齐（位置 + 序号 + 会话身份 + 状态）+ 一次 `activeProjectId`，把门控与状态一并交出。结构不变量由 `runner/__tests__/architecture.test.ts` **护栏 12** 钉住（源码扫描；不用行为断言是因为 React `useSyncExternalStore` 会按 `subscribe` 去重，多个 selector 运行时只产生一条订阅，行为上测不出差别）。
10. **匹配判定只需一个参数（规范源身份）**：`resolveDebugHighlightLine(absFilePath, location, status)`。
    `absFilePath` 必须由 `sourceIdentityOf` 算出 —— 它对 fs / jdt / 虚拟源码（`dap-source:`）三种身份都成立
    （身份构造点**幂等**：`id(id(x)) === id(x)`，由 `fileRef` 的「值域 = 真实身份种类集合」保证）。
    曾有的第二个参数（tab 原始路径）是为绕过「虚拟身份被拼根」而设的权宜，身份文法闭合后已删除；
    若再出现「同一文件要传两种表示才能判定」，说明身份构造点又有洞，应当去修构造点而不是加参数。
11. **#14 门控只有一处实现**（`isSessionVisibleFor(session, projectId)`）：会话可见性判定曾被写在三处
    （`useVisibleDebugSession` / `useStopLocation` / `useEditorViewSnapshot`）—— 漏一处就是
    「切项目后旧项目的停点画到本项目编辑器上」。判定散落即回到「同一规则多处解释」，新增消费方一律调用它。
12. **selector 返回对象必须套 `useShallow`**：`useStopLocation` 的合并选择器若不套，每次 `getSnapshot` 都是新引用 → React 判定 tearing 并持续重渲。
13. **路径形态归一只能住在身份所有者里，且出现点必须登记**：任何消费方都不得自造 `\`→`/`、去尾斜杠这类字符串重写来做同文件判定 —— 那是同一份文件的第二种表示。确属展示/URL/树结构/命令入参派生的归一可以保留，但必须在 `tools/guards/ledger/path_identity_scope.json` 登记分类（`owner` / `legit` / `debt`）与计数。该护栏已接入 `pnpm lint` 与 CI：**未登记命中 / 登记失效 / 计数漂移 / 扫描集为空** 四种情况都会判失败。改动前请先跑它（`pnpm guards list check_path_identity_scope` 看全量台账）。

### 4. Validation & Error Matrix

| 场景 | 输入 | 预期 | 错误处理 |
|------|------|------|---------|
| 单次停点 | 一次 `refreshStackAndVars` | 一次原子写，位置/序号同步 +1 | 无 |
| 旧链迟到（栈结果后到） | 两个 deferred `dapStackTrace`，旧的后 resolve | 旧代际整链丢弃，状态属新代际 | 静默丢弃（不弹错） |
| 旧链迟到（源码内容后到） | 旧停点的 `readFileContent` 晚于新停点完成 | 不建 tab、不激活、不写跳转目标 | 静默丢弃 |
| 切帧 | `selectFrame(otherId)` | 代际不变、`locationSeq+1`、位置为规范身份 | 帧不存在 / 会话非 live → 直接返回 |
| 停点结束 / 继续 / 终止 / 复位 | `continued` / `terminated` / `resetSession` | `location=null`、`locationSeq+1`、代际作废 | 无 |
| 用户挪走光标后再重放 | 同 `seq`、`viewEpoch` 变化 | 不夺回光标；黄线照常标记 | 无 |
| 视图重建 | `viewEpoch` 变化 | 重放（幂等）→ 自愈回到停止行 | 越界（doc 未就绪）时不放置也不记账，等下次触发 |

### 5. Good/Base/Bad Cases

- Good：停点1（源码内容慢）→ 停点2（快）→ 停点1 的内容最后到达：编辑器始终停在停点2，活动 tab 属于停点2，旧文件既不建 tab 也不抢激活。
- Base：同一文件连续单步（位置值可能相同）：每次都重新跟随（新事件键），用户接管后下一次停点仍恢复跟随。
- Bad：跳转目标进全局单槽、由异步链写入、命中即清槽 —— 迟到者覆盖 + 清槽后丢失，两者都表现为「有时不跳」。

### 6. Tests Required

- `runner/store/debug/__tests__/stopGeneration.test.ts`：代际单调 / 相等判定（`null` 永不相等）/ 用例独立重置。
- `runner/__tests__/debugStore.test.ts`：**反转 resolve 顺序**（新链先完成、旧链后完成）后状态仍属新代际；订阅快照中不存在「新位置 + 旧帧」；切帧保持代际且序号 +1；四条清空路径清位置且序号 +1。
- `runner/__tests__/navigate.test.ts`：`ensureStopSourceTab` 不写跳转目标；许可在 `await` 后变 false 时不建 tab / 不激活。
- `runner/__tests__/stopReveal.integration.test.ts`：**不 mock `navigate`** 的端到端交错（症状级回归）。
- `editor/hooks/__tests__/useDebugStopReveal.test.ts`：命中 / 幂等重放（不重复记录原光标位置）/ 用户接管 / 释放两分支 / 不误伤 / 越界不伪造位置。
- `runner/__tests__/debugStore.test.ts`：切帧的**双向**用例 —— 无代际时变量仍写入（`[T14]`）、切帧期间出现新停点则迟到变量被丢弃（`[T15]`）；两者都要能用「撤掉守卫 / 换成错误谓词」跑出真红。
- **必须真红**：提交前临时移除代际守卫（或让 `isCurrent` 恒真），上述交错用例必须 RED；恢复后 GREEN。

### 7. Wrong vs Correct

#### Wrong

```ts
// 跟随 = 一次性事件 + 全局单槽；异步链直接写槽
async function applyFrames(frames) {           // 只校验 sessionId
  set({ frames });                              // 与位置分两次 set
  set({ stoppedAt: { filePath, line } });       // 裸路径，且与上面不同步
  if (!existing) await load();                  // ← 迟到者在这里之后写槽
  store.setPendingNavigateTarget({ ..., debug: true });
}
// 消费侧：命中即清槽，真正的动作塞进 rAF（丢失后无从补偿）
```

#### Correct

```ts
// ① 停点 = 带代际的原子写（位置为规范身份）
const gen = get().beginStop(sid);
const frames = await dapStackTrace(sid);
if (!isCurrent(gen)) return;                    // 旧代际整链放弃
set({ frames, selectedFrameId: nav.id, ...withStopLocation(get(), buildStopLocation(nav, root)) });

// ② 只确保源码可见，并把「落地许可」注入给 tab 生命周期
ensureStopSourceTab({ ..., isCurrent: () => isCurrent(gen) });

// ③ 编辑器侧从 location 派生（幂等重放；用户接管后不夺回）
const stop = useStopLocation();
const targetLine = resolveDebugHighlightLine(absFilePath, stop, stop?.status ?? null);
useEffect(() => { /* 判新事件 / 用户接管 → applyNavigateCaret / releaseDebugCaret */ },
  [stop, targetLine, viewEpoch]);
```

---

## 场景：调试断点禁用/静音/重跑 2026-09-16

### 1. Scope / Trigger

- Trigger：补齐 IDE 标配的①单个断点可禁用/启用（保留在列表与 gutter 置灰）②Rerun（运行中亦可，语义 = 停旧起新）③全局静音（mute，恢复时仅恢复此前开启的断点）。
- Scope：`src-tauri/src/dap/{types,config,manager,session,commands}.rs`、`src/features/runner/store/debug/{breakpointSlice,sessionSlice,eventsSlice}.ts`、`DebugToolbar/DebugBreakpointsPane/breakpointContribution`、`javaDebugStore`。
- 第一性原理：DAP `setBreakpoints` 按文件全量替换、**无 enabled 位**（`session.rs:558`）——「禁用」只能是客户端过滤；「重跑」本质是记住 launch 意图并重放，后端已保证单项目单会话（`launch_session` 内 `stop_project_sessions` 停旧）。

### 2. Signatures

```rust
// dap/types.rs — BreakpointSpec +=
pub struct BreakpointSpec {
    pub file_path: String,
    pub line: u32,
    pub verified: bool,
    #[serde(default = "bp_enabled_default")]  // 老文件缺字段 → true
    pub enabled: bool,
}
// dap/manager.rs — dap_set_breakpoints 请求载荷（同命令名变参，无需注册变更）
pub struct BreakpointLine { pub line: u32, pub enabled: bool }
// 命令：dap_set_breakpoints(project_id, file_path, breakpoints: Vec<BreakpointLine>, session_id)
//       dap_set_breakpoints_muted(project_id, muted: bool) -> ()   // 落盘 + 即时下发 effective 全集
//       dap_get_breakpoints_muted(project_id) -> bool
// BreakpointsFile version 0.1.0 → 0.2.0（loader 双版本容忍；enabled/muted 缺字段即 true/false）
```

```ts
// runner/types.ts — store 内态（verified 是下发回填，不存）
export interface BreakpointEntry { line: number; enabled: boolean }
// runner/store/debug/types.ts — DebugSessionSlice +=
export interface DebugLaunchIntent {
  projectId: string;
  label: string;                 // toolbar title `Rerun <label>`
  replay: () => Promise<void>;   // 不透明重放（自带 reset + 回显；语言侧登记，通用层零语言字面量）
}
lastLaunch: DebugLaunchIntent | null;
isLaunching: boolean;            // start / startWithConfig / rerun 共用互斥位
setLastLaunch: (intent: DebugLaunchIntent | null) => void;
rerun: (projectId: string) => Promise<void>;
```

### 3. Contracts

1. **DAP 无 enabled 位 ⇒ 过滤点必须在后端 manager**：前端过滤会被 `set_breakpoints` 当删除持久化（`manager.rs` 先全量替换内存再落盘）。`verified`（适配器只读）与 `enabled`（用户可写）正交。
2. **effective 过滤单点、双路径（本任务真 bug，勿再犯）**：`effective = enabled && !muted` 抽成后端纯函数，**实时（`set_breakpoints`）与启动/重跑（`adapter_breakpoints` → `launch_session`）两条下发路径都必须走它**。只堵实时路径 ⇒ **mute 后 Rerun 经启动路径把全部断点重新下发命中**。
3. **mute 是叠加态，不是批量改写**：mute=true 时适配器载荷为空（全部扣留，单个 enabled 位原样保留）；unmute 只恢复此前 enabled 的行。mute 按 projectId 存、持久化进 `breakpoints.json`（`breakpoints.json` 本身是 per-project 文件，文件内 `muted` 是单 bool）。
4. **断点身份 = `(file, line)`，enabled 是属性位**：拒绝 `lines[] + disabledSet` 双 map（双真相漂移）。持久化全量、下发只取 effective。
5. **rerun = launch 意图重放，不是协议 restart**：`ControlAction` 无 restart；后端恒停旧起新，前端只记意图。**意图只增不丢**：仅成功启动后记录（快照 config，避免引用漂移），失败 / `reset` / `stop` / `terminated` 不清除（终止后重跑是主场景）；跨项目门控（`projectId !== active` 禁用）。
6. **`isLaunching` 覆盖全部启动入口**（start / startWithConfig / rerun 共用同一互斥位）：start / startWithConfig 在入口 check+set+finally 复位；rerun **只 check**、位由重放的链（startWithConfig / Java 链）自行管理（避免重入被自己的互斥位挡掉）；独立链（JDTLS `startJavaDebug`）经薄 setter `setLaunching` 自行包位。否则 config 区与 toolbar 两个按钮并发启动，各自 `resetSession` + 各自 `set({session})`，前端状态竞争（后端单会话只兜后端）。
7. **事件堵口**：状态流 `!cur + terminated/ended → 忽略`（死亡通知不许创建会话）。`!cur` 时若照常 `endedSessionPatch(info)` 会用 `info` **凭空创建**一个 terminated 会话对象。**补充（架构审查）：`cur.sessionId !== info.sessionId` 的死亡通知同样忽略**——rerun 停旧起新时旧会话 terminated 晚到会覆盖新会话；镜像 DAP_EVENT 的 identity filter。非死亡状态流（`!cur + starting`）仍照常建会话。
8. **merge 同行一个 entry、enabled 优先**：adapter remap 把 enabled 行移到相邻行（42→43），若 43 恰有另一条 disabled entry → 按行合并为一个 entry、enabled 优先；disabled 行永不进实时载荷因此不会被 remap 掉。

### 4. Validation & Error Matrix

| 场景 | 输入 | 预期 |
|------|------|------|
| 单点禁用 | `setBreakpointEnabled(line, false)` | 内存/磁盘保留该行，实时载荷不含它 |
| mute=true | `setBreakpointsMuted(pid, true)` | 载荷空（实时与启动/重跑两条路径都空） |
| mute=true + Rerun | 停住 → Rerun | 新会话启动载荷为空，不断（P1 关键用例） |
| unmute | `setBreakpointsMuted(pid, false)` | 恢复此前 enabled 子集；单点禁用的保持禁用 |
| 老文件（0.1.0） | 读 `breakpoints.json` | 缺 enabled → true、缺 muted → false |
| 启动失败 / reset / stop / terminated | — | `lastLaunch` 不清除（D6） |
| 跨项目 rerun | `rerun(otherProjectId)` | 拒绝（projectId 门控） |
| attach 会话点 Rerun | attach 后点 Rerun | 停 attach、重放上次 launch 意图 |

### 5. Good/Base/Bad Cases

- Good：mute 中 rerun → 新会话一个断点都不下；unmute 后只恢复此前开启的行。
- Base：单点禁用 → 重启 app 仍在（0.2.0 roundtrip）；工具栏 mute 在零断点时 disabled 但仍显示 active 态（muted 残留可见）。
- Bad：只堵实时路径不堵启动路径 → mute 后 Rerun 断点复活命中（本任务 P1 的真实风险）。

### 6. Tests Required

- Rust（manager/config）：`effective_breakpoints` 纯函数；`adapter_breakpoints_skips_disabled_and_muted_without_notes`（**变异验证：删过滤行 ⇒ 红**）；`effective_lines_for_file`；`set_breakpoints_persists_disabled_and_muted` roundtrip；0.1.0/0.2.0 双版本 loader。
- TS（slice）：`setBreakpointEnabled` 缺行 no-op / 乐观 + 失败回滚 + notify；merge 冲突（42→43 remap 撞 disabled）；mute 置空/恢复/while-muted 改单 bit 保留；`lastLaunch` 只增不丢；`isLaunching` 互斥（rerun 期间 no-op + startWithConfig 期间置位）；跨项目拒绝；attach 重放 launch。
- TS（eventsSlice）：`!cur + terminated/ended → 忽略`；正常 terminated 清理不受影响。
- 组件：pane Eye/EyeOff 开关 `aria-pressed` + 点击调 `setBreakpointEnabled`；toolbar rerun disabled/title 含 label；mute 零断点 disabled 但 active 态可见。

### 7. Wrong vs Correct

#### Wrong

```ts
// 前端下发时过滤 enabled —— 后端 set_breakpoints 按文件全量替换，disabled 被当删除持久化
await dapSetBreakpoints(pid, file, entries.filter((e) => e.enabled).map((e) => e.line), live);
```

```rust
// 只堵实时路径 —— mute 后 Rerun 经 adapter_breakpoints 启动路径把全部断点重新下发
// set_breakpoints: 按 effective 过滤 ✓
// adapter_breakpoints: 不滤 → mute 态启动载荷全量 → 命中 ✗
```

#### Correct

```rust
// effective 单一纯函数，实时 + 启动两条路径都走它（评审 P1）
fn effective_breakpoints(bps: &[BreakpointSpec], muted: bool) -> Vec<BreakpointSpec> {
    bps.iter().filter(|b| b.enabled && !muted).cloned().collect()
}
// set_breakpoints（实时）→ effective_lines_for_file；launch_session（启动）→ adapter_breakpoints(…, muted)
```

```ts
// rerun = 重放意图（thunk 自带 reset + 回显）；isLaunching 全入口互斥
rerun: async (projectId) => {
  const { lastLaunch, isLaunching } = get();
  if (!lastLaunch || lastLaunch.projectId !== projectId || isLaunching) return;
  set({ isLaunching: true });
  try { await lastLaunch.replay(); } finally { set({ isLaunching: false }); }
},
```

---

## 场景：Workspace分槽 + 激活态单源（git status 身份补全）2026-09-26

### 1. Scope / Trigger

- Trigger（issue #2）：worktree 场景下 changes 列表「总是不可见，还可能出现 main 中的内容，
  要手动刷新才恢复」。第一性原理：`git status = f(HEAD, index, workdir)`，linked worktree 的
  这三者全都独立（只共享 object DB）⇒ 一个 project 在 git 语义下是 **1 + N 个Workspace**。前端
  当时只有 per-project 一个 `changed_files` 槽 + 一个 per-project version 计数，两个单元共槽
  必然互相覆盖；worktree 又没有权威生产者，于是「不刷新就不动」。
- Scope：`shared/utils/workspaceRef.ts`（身份）、`shared/store/projectStore.ts`（`statuses` 分槽 +
  唯一写入口）、`shared/store/workspaceStore.ts`（激活态单源）、`features/git/hooks/useRepoUnit.ts`
  + `app/hooks/useActiveWorkspaceSync.ts`（挂载唯一入口）、`features/git/utils/gitStatus.ts`。

### 2. Signatures

```ts
// shared/utils/workspaceRef.ts —— key 的唯一产出/反解处（与 Rust WorkspaceRef::key() 双端 golden 对齐）
export const WORKSPACE_KEY_SEP = '\u0000';
export type WorkspaceKey = string & { readonly __workspaceKey: unique symbol };
class WorkspaceSession { get key(): WorkspaceKey; static of(projectId: string, worktreePath: string | null): WorkspaceSession }
export function parseWorkspaceKey(key: string): { projectId: string; worktreePath: string | null };
// 单元工作树根（= Rust WorkspaceRef::work_dir()）：事件相对路径的归一基准，主仓回落项目登记路径
export function workspaceRootOf(workspaceKey: string, projectRoot: string): string;

// shared/store/projectStore.ts
statuses: Record<string, WorkspaceStatus>;                    // 缺失 = 未知，不是「无变更」
applyStatus: (snapshot: WorkspaceStatus) => void;             // 唯一写入口，内含 per-key version gate
invalidateStatus: (workspaceKey: WorkspaceKey | string) => void;   // 切走 / unwatch 时作废
export function selectEntries(state, workspaceKey): FileChange[] | undefined;  // undefined = 未知

// shared/store/gitStore.ts —— 键 = WorkspaceKey（单元身份），无 source/connection 前缀
aheadBehind: Record<string, AheadBehind>;                // 键 = WorkspaceKey（结构类型是 string）
setAheadBehind: (workspaceKey: string, info: AheadBehind | null) => void;

// shared/store/workspaceStore.ts —— 只有 byProject，没有任何全局镜像
byProject: Record<projectId, { activePath: string | null; activeBranch: string; opened: CheckoutEntry[] }>;
// 「当前视图单元」的唯二派生点（React 形态 / 命令式形态）
export function selectActiveWorkspaceKey(state, projectId: string | null | undefined): WorkspaceKey | null;
export function activeWorkspaceKeyOf(projectId?: string | null): WorkspaceKey | null;

// features/git/utils/gitStatus.ts
export async function refreshWorkspaceStatus(workspaceKey: WorkspaceKey | string): Promise<void>;
export function createDebouncedStatusRefresh(ms: number): { schedule(workspaceKey, run): void; clear(): void };
```

### 3. Contracts

1. **身份单源**：`WorkspaceKey` 只能由 `WorkspaceSession#key` 产出、只能由 `WorkspaceSession.fromKey` 反解。任何调用点手拼
   `` `${projectId}\0${wt}` `` 或自行 `split('\0')` = 同一身份的第二种表示，必然与后端漂移。
   刷新目标必须是 `WorkspaceKey` 入参，**禁止**「projectId + 现取全局镜像的 worktreePath」。
2. **一格一单元**：status 按 `workspace_key` 分槽。跨单元的数据共享只允许发生在**投影**上
   （主仓单元的 branch 投影进项目卡片 `git_info.current_branch`，写者唯一）。
3. **唯一写入口 + 单一闸门**：`applyStatus` 是 `statuses` 的唯一写者，闸门只有一条规则
   `version <= prev ⇒ 丢弃`（同一 key 内比较）。禁止 `version === 0 恒放行`、禁止
   `allowEqual` —— 后端两条生产者（push worker / pull 计算）的 `version` 由注册表统一盖章，
   恒有意义，前端不需要也不可能「遇到无语义版本就放行」。
4. **未知 ≠ 空**：槽位缺失或 `invalidateStatus` 后，消费端必须渲染加载/空态（`ChangesList` 的
   `unknown` 形态），不得沿用上一个单元的数据、也不得把空数组当「工作区干净」的断言。
5. **激活态只有一个真源**：`workspaceStore.byProject[projectId]`。全局
   `activeWorktreePath / activeWorktreeBranch / openedWorktrees` 镜像字段已删除 —— 镜像需要有人
   同步，而「谁在看」这件事一旦有两份表示，就会有两份不一致的视图。
6. **挂载唯一发起点 + 两个判据分离**：只有 `useActiveWorkspaceSync` 会请求后端挂载/取回快照；用户
   动作（点 worktree、切回主仓）只写激活态。两个发起点必然有时序差。后端因此可以维持「每项目至多
   一套挂载资源」的成本决策，而前端不需要知道它挂了谁 —— 它只按 `workspace_key` 读自己的槽。

   **「请求挂载」与「重试」是两个判据，合成就出洞**（2026-09-30 修）：
   - **请求挂载的判据是意图边沿**（意图变化 ⇒ 必须请后端接管该单元）。**禁止**用「槽位非空」
     代替 —— 槽位是**数据面**（`get_workspace_status` 的 pull 读也写它），不证明后端有 push 生产者；
     后端资源状态才是唯一权威，前端的合法替代证据只有**自己的请求历史**。
   - **重试的判据是槽位为空**（有权威数据即收敛完成）。**禁止**按请求结局
     （`mounted / stale / failed`）分支 —— 失败与「槽位被别的写者作废」之后意图可以完全没变，
     按结局分支就没有任何东西会再发起，`ChangesList` 永久停在 `unknown`（"Loading changes…"）。
   **机制、触发场景与实现取舍**见 `app/hooks/useActiveWorkspaceSync.ts` 的 docstring（本规则只留
   判据与禁令 —— 同一条理由写两遍，改一处必漏另一处）。
   **How to apply**：重试**有界**（策略在 `shared/utils/retryBudget.ts`，纯函数、按意图作用域、
   指数退避封顶），墙钟最坏约 8s（每次尝试内含后端 1.5s 有界等待）；耗尽 ⇒ 保持「未知」且**只
   上报一次**（`logFrontendError`，只落日志不弹 toast），此后靠意图变化或 push 事件恢复 —— 耗尽
   只停主动轮询，不是死局。**重试本身绝不判死** —— 「激活单元已从清单消失 ⇒ 回落主仓」的判据
   仍然只有 `useAppShellData` 那一处（两处判死互抖是 2026-09-28 的既成事故）。把 `WorkspaceKey` 写进
   日志/提示一律走 `workspaceKeyLabel` —— 键含 NUL 分隔符，直接插值会让日志文件被判成二进制
   （`file(1)` 报 `data`，检索与轮转一并失效）。
7. **ahead/behind 的键就是 `WorkspaceKey`**（无 `{source}:{connectionId}` 前缀）。复合键 helper
   `aheadBehindKey(kind, entryId, projectId)` 已退役（护栏 `RETIRED_FRONTEND` 按符号钉）。
   **Why**：同一份数字曾有四种键约定 —— 写侧 `{kind}:{distro|host}:{unit}` 与
   `{kind}:{host}:{port}:{projectId}`，读侧 `local:{projectId}` 与裸 `aheadBehind[projectId]`；
   读侧永远拼不出写侧的键 ⇒ `BranchStatusBarWidget` 的徽标恒空、主仓行显示的是**激活单元**的数字。
   而 `project.id` 已是 UUID（`ProjectManager` 生成）、`WorkspaceKey` 已全局唯一 ⇒
   `{source}:{connectionId}` 维度纯冗余，且三个调用点各用一种 connectionId 约定（`distro` /
   `${host}:${port}` / `host`），只制造漂移。**How to apply**：写侧四个触发时机
   （`useRefreshGitInfo` / `useLocalProjects` / `useGitStatusEventsSync` / `useAheadBehindSync`）
   是**同一事实的不同时刻**，键必须同形；读侧一律 `aheadBehind[WorkspaceSession.of(projectId, unitPath ?? null).key]`，
   `unitPath` 取自 store selector（`selectActiveCheckoutPath`）。
8. **激活单元 key 只有一个派生点**：`selectActiveWorkspaceKey(state, projectId)`（React 形态）/
   `activeWorkspaceKeyOf(projectId?)`（命令式形态）、`useActiveWorkspaceKey(projectId)`（渲染期形态），
   都在 `workspaceStore.ts`。任何文件直读 `.byProject[...].activePath` 即违规
   （护栏 `STORE_STATE_ACCESS_RE` 钉住）—— 判据拦的是
   **形态**而非字段名，因为「别处再手写一遍 `activeWorkspaceSession(pid).key`」
   正是下一次分叉的入口（`projectId` 为空时还会产出 `'\u0000'` 这种谁也匹配不上的键）。渲染期直读
   还会停在旧值（非响应式）。
9. **`file-changed` / `file-tree-changed` 的路径基准 = 单元工作树根**：载荷是
   `{ workspace_key, project_id, paths | dirs }`，路径**相对该单元工作树根**（后端
   `strip_prefix(repo.work_dir_pathbuf())`，失败才回退绝对路径）。消费侧的归一基准必须由
   `workspaceRootOf(workspace_key, projectRoot)` 给出 —— 主仓单元回落项目登记路径，linked worktree 用
   后端回传的 canonical 路径；**禁止用 `project.path`**：worktree 视图下工作树文件的相对路径
   拼到主仓根 ⇒ 同文件判定恒不命中 ⇒ HTML 预览 / 浏览器 auto-refresh 静默不再刷新。
   同理，**事件载荷形状本身是契约**：`git-changed` 已从裸 `project_id` 字符串改为
   `GitChangedEvent{workspace_key, project_id}`，仍按 `useTauriEvent<string>` + `payload !== projectId`
   比较的消费点会「对象 ≠ 字符串」恒早返回 ⇒ 整条通道静默死亡（不报错、不留痕）。事件名与载荷
   类型一律取自 `shared/events.ts` + `shared/types`，禁止手写 `listen<string>`。
10. **`statuses` 只能经 selectors 读（消费端不摸内部表示）**：`selectStatus` / `selectEntries` /
    `selectBranch` / `selectHasStatus`（均在 `projectStore.ts`）。生产代码里 `.statuses` 直读或
    解构 `{ statuses }` 即违规（护栏 `check_workspace_identity` 判据 7，白名单仅 `projectStore.ts`）。
    **Why**：字段是 store 的内部表示，公开它就等于让每个消费者都耦合到「容器形状 + key 拼法 +
    缺失 = 未知语义」；selector 是追加式约定（可绕过），判据才是排他式机制。**How to apply**：
    需要按**多个 key** 取值（循环里不能订阅 hook，如 worktree 侧栏为每个 worktree 取条目）用
    `useProjectStore(useShallow((s) => keys.map((k) => selectEntries(s, k))))` —— 精确到「本列表
    这些单元」，别的单元 / 项目的快照不触发重渲；存在性判断用 `selectHasStatus`（区分「未知」与
    「已知且干净」）。**远端（WSL/SSH）侧栏 worktree chip 与本地侧栏读同一张表**：两侧共用
    `shared/hooks/useWorktreeChangeStats`（按单元浅订阅 + 挂载级新鲜度守卫，拉不到 = 未知、
    不出 chip 且允许重试），不存在第二份组件本地 `useState`。

### 4. Validation & Error Matrix

| 场景 | 输入 | 预期 | 错误处理 |
|------|------|------|---------|
| 首个快照到达 | `applyStatus(v1)` 且槽位空 | 写入槽位 | — |
| 乱序/回退 | `applyStatus(v2)` 后再来 `v2` 或 `v1` | 丢弃，槽位不变 | 静默 |
| 另一单元的高版本 | A 已有 v9，收到 B 的 v1 | B 的槽写入 v1 | — |
| 切换单元 | `invalidateStatus(oldKey)` + 新单元尚未推送 | 旧槽删除、新槽 `undefined` | 渲染加载态 |
| 刷新失败 | `getWorkspaceStatus` reject | **不动槽位**（不写空列表） | `console.error`，由调用方决定是否提示 |
| 非 git 项目 | `project.git_info === null` | 不发任何 git 命令 | — |

### 5. Good/Base/Bad Cases

- Good：主仓 ↔ worktreeA ↔ worktreeB 交替，每格只显示自己单元的条目；未挂载的 B 在侧栏走
  pull 通道，仍然按 key 定址同一张表。
- Base：单主仓项目，行为与改造前一致（多了一层 `WorkspaceSession.of(projectId, null).key`）。
- Bad（都会重新引入本 issue 的症状）：把 `statuses` 又拍平回 per-project；在组件里
  `useWorkspaceStore.getState().activeWorktreePath`（或 `.byProject[pid].activePath`）取当前单元；
  给 `applyStatus` 加「`version === 0` 也放行」的兼容分支；在 `useEffect` 里再调一次
  `set_active_workspace`；给 ahead/behind 再拼一次 `{source}:{connectionId}` 前缀；事件消费点
  用 `project.path` 当相对路径基准。

### 6. Tests Required

- `shared/utils/__tests__/workspaceRef.test.ts`：golden key 形态必须与后端
  `workspace_ref.rs::golden_key_format_matches_frontend_contract` 逐字一致（`'proj-1\0'` /
  `'proj-1\0/srv/app/.worktrees/dev'`）；`workspaceRootOf` 主仓回落 / worktree 取路径。
- `shared/store/__tests__/projectStore.test.ts`：`applyStatus` 拒旧（含同版本）、跨单元互不覆盖、
  `invalidateStatus` 只作废一个。
- `shared/store/__tests__/workspaceStore.test.ts`：`selectActiveWorkspaceKey` / `activeWorkspaceKeyOf` 的
  两个形态同语义、跨项目不串用。
- `features/git/hooks/__tests__/useActivateWorkspace.test.ts`：迟到响应在当前视图已切换时必须丢弃；
  激活失败 → 该单元置为未知（不是保留旧数据）。
- ahead/behind 键契约：`useRefreshGitInfo.test.ts`（键空间里只有单元身份，旧前缀键必须为
  `undefined`；worktree 刷新不碰主仓键）、`git/components/__tests__/BranchStatusBarWidget.test.tsx`
  （**读侧此前无测试，恒空 bug 因此长期无人发现**）。
- 事件基准：`HtmlPreview.test.tsx` / `useBrowserPanelEvents.test.ts` / `useBrowserTab.test.ts`
  各自断言「单元相对路径 + 绝对回退 + 非规范等价形态（重复斜杠 / 尾斜杠）」三种输入都必须命中；
  `useUntrackedDirExpansion.test.ts` 断言**别的单元**的事件不得驱动本列表重拉。
- 护栏 `tools/guards/checks/check_workspace_identity.py`：退役符号 / 镜像属性 / 裸 `.byProject[..]`
  直读 / status 命令出口白名单 / 手拼 key 五类判据，命中即违规且**刻意不配计数台账**
  （要的是永远为零）。植入违规必须红 —— 退化方式不是「忘了」，而是「把旧通道又接回来」。

### 7. Wrong vs Correct

#### Wrong

```ts
// 身份来自全局镜像 + 兼容无语义版本：worktree 视图串主仓内容、pull 覆盖 push
const worktreePath = useWorkspaceStore.getState().activeWorktreePath;
await refreshGitFileStates(projectId, worktreePath);
if (payload.version === 0 || payload.version > prev.version) applyGitStatus(payload);
// 「没有数据」被渲染成「没有改动」
<ChangesList entries={gitInfo?.changed_files ?? []} />;

// 同一份 ahead/behind 有四种键约定 —— 读侧拼不出写侧的键 ⇒ 徽标时有时无
setAheadBehind(aheadBehindKey('wsl', `${host}:${port}`, projectId), ab); // 写
const ab = useGitStore((s) => s.aheadBehind[projectId]); // 读：键空间里没有这个键

// 事件的路径基准取主仓根（worktree 视图下恒不命中 ⇒ 预览/浏览器不再刷新）
const root = useProjectStore.getState().projects.find((p) => p.id === projectId)?.path ?? '';
if (pathsContainFile(root, event.paths, filePath)) reload();
// 载荷形状没跟：对象与字符串永不相等 ⇒ 整条通道静默死亡
useTauriEvent<string>(GIT_CHANGED_EVENT, (payload) => {
  if (payload !== projectId) return;
});
```

#### Correct

```ts
// 身份由入参给出，闸门只有一条规则，未知与空是两种界面形态
const workspaceKey = activeWorkspaceSession(projectId).key;
await refreshWorkspaceStatus(workspaceKey);
useProjectStore.getState().applyStatus(snapshot); // 内部：version <= prev ⇒ 丢弃
const status = useProjectStore((s) => selectStatus(s, workspaceKey));
<ChangesList entries={status?.entries ?? []} unknown={status === undefined} />;

// ahead/behind 的键 = 单元身份本身；写侧四个时机同形，读侧经唯一派生点取
setAheadBehind(snapshot.workspace_key, ab); // 写
const unitKey = useWorkspaceStore((s) => selectActiveWorkspaceKey(s, projectId)); // 读
const ab = useGitStore((s) => (unitKey ? s.aheadBehind[unitKey] : null));

// 事件的归一基准与产出侧同源（单元工作树根）
if (pathsContainFile(workspaceRootOf(event.workspace_key, projectPath), event.paths, filePath)) reload();
// 载荷类型跟着契约走
useTauriEvent<GitChangedEvent>(GIT_CHANGED_EVENT, (payload) => {
  if (payload.project_id !== projectId) return;
});
```

---

## 场景：Tab 身份模型（按 Workspace 值对象寻址）2026-10-10

### 1. Scope / Trigger

- Trigger：`Tab.projectId: string` + `addTab(spaceKey, tab)` 让「键」可被调用方指定、身份是
  未类型化的裸 string。事故实证：点击 agent 时 `tabKey`（复合 `WorkspaceKey = projectId\0wt`）
  被写进 `tab.projectId`，激活后 `check_agents_installed` 收到 37 字节（尾随 NUL）id → 后端
  精确匹配失败 `Project not found`。diff tab 修过一次同类回归，agent tab 原样复发 —— 点修无效。
- Scope：`shared/utils/workspaceRef.ts`（**唯一概念模块**：身份词汇 + 铸造点）、`shared/types/tab.ts`
  （`Tab.scope`）、`shared/store/editorStore.ts`（`addTab` 构造律）、`shared/types/git.ts`
  （`DiffSource`）、全部 tab 创建 / 消费点。`shared/types/workspace.ts` shim **已删除**（不再有 `types → utils` re-export 反转）。
- 第一性原理：身份只有三种形态，键是身份的**派生索引**不是身份本身；「键 A、tab 身份 B」的
  不一致必须在构造上不可能（非法状态不可表示），而不是下游检测。

### 2. Signatures

```ts
// shared/utils/workspaceRef.ts —— 身份词汇的唯一正文（含 key 材质，护栏白名单文件）
export const WORKSPACE_KEY_SEP = '\u0000';
export type WorkspaceKey = string & { readonly __workspaceKey: unique symbol };
export type ProjectId = string & { readonly __projectId: unique symbol };

export class WorkspaceSession {
  private constructor(readonly projectId: ProjectId, readonly worktreePath: string | null) {}
  static of(projectId: string, worktreePath: string | null): WorkspaceSession; // '' / 空白 → 主仓
  static fromKey(key: string): WorkspaceSession | null; // 反解：日志 / golden / wire 边界
  get key(): WorkspaceKey; // 唯一铸造点（≡ Rust WorkspaceRef::key()），惰性缓存
}

export const APP_TAB_SPACE_KEY = '__app__';
export function tabSpaceKeyOf(scope: TabScope): string; // 'workspace' → session.key；'app' → __app__
export function tabProjectId(tab: Tab): ProjectId | null; // 项目粒度投影；app 空间 → null
export function tabWorkspaceSession(tab: Tab): WorkspaceSession | null;

// shared/types/tab.ts
export type TabScope =
  | { kind: 'workspace'; session: WorkspaceSession }
  | { kind: 'app' };
export interface Tab { id: string; scope: TabScope; title: string; order: number; data: TabData }

// shared/store/editorStore.ts —— 构造律：键由 tab 自身推导，调用方无权指定
addTab: (tab: Tab, targetGroup?: EditorGroupId | 'pinned') => void; // 内部 tabSpaceKeyOf(tab.scope)
```

### 3. Contracts

1. **身份词汇封闭**：只允许 `ProjectId`（项目粒度）、`WorkspaceSession`（Workspace 地址值对象）、
   `WorkspaceKey`（只出现在 map/record 键位）。不存在第四种身份表示。
2. **Tab 携带完整领域地址**：`tab.scope` 是唯一身份字段；`TabData` 不再有 `workspace`。
   项目粒度消费读 `tabProjectId(tab)`；Workspace 粒度消费读 `tab.scope.session`。
3. **构造律（键由 tab 推导）**：`addTab` 内部取 `tabSpaceKeyOf(tab.scope)` —— 键与身份不一致
   在构造上不可能。任何「外部传键」重载都不允许存在。
4. **键是投影不是拼装**：`session.key` 是对象属性；散件函数 `WorkspaceSession#key` / 反解
   `WorkspaceSession.fromKey` 已退役（护栏 `RETIRED_FRONTEND` 按符号钉），生产代码零命中。
5. **`__app__` 是 App 节点的合法空间**（`App → Project → Workspace` 层级），用 `{ kind: 'app' }`
   联合分支吸收；字面量只允许出现在 `tabSpaceKeyOf` 实现文件。
6. **Rust 权威**：`WorkspaceRef::key()` 与 `session.key` 双端 golden 逐字一致；后端
   `project_context` 对含 NUL 的 id 返回 `InvalidInput`（不是 `NotFound`），防止身份污染
   被误诊为「项目缺失」。
7. **「投影」与「组装」的判据**：`WorkspaceSession.of(projectId, path?).key` 是**合法投影**当且仅当
   `path` 来自身份源本身（`useActiveCheckoutPath()` / `selectActiveCheckoutPath` / tab 携带的
   `scope.session`）；此时它等价于 `activeWorkspaceSession(projectId).key`（纯形式，避免第二次
   store 读取）。**禁止**的是「按裸 `projectId` 查按单元存的表」或「拿无关分量拼一个键」——
   那才是本场景要消灭的「组装」。非 tab 域（git status / 文件树 / 终端缓存）因手头只有
   `(projectId, worktreePath)`，统一经 `WorkspaceSession.of(...).key` 这一**唯一 mint** 取键。

### 4. Validation & Error Matrix

| 场景 | 输入 | 预期 |
|------|------|------|
| 主仓 tab | `scope = { workspace, session: of(pid, null) }` | store 键 = `pid\0` |
| worktree tab | `session = of(pid, '/wt')` | store 键 = `pid\0/wt`，按单元隔离 |
| App 设置 tab | `scope = { kind: 'app' }` | 键 = `__app__`，`tabProjectId` = null |
| agent 点击 | 新建 terminal tab | 身份 `session.projectId` 不含 NUL；`check_agents_installed` 收裸 id |
| 空串 worktree | `of(pid, '')` | 归一为主仓（key 与 `isMainCheckout` 同一结论） |
| wire 载荷 | 事件只带 `workspace_key` | 边界经 `WorkspaceSession.fromKey`（唯一 codec） |

### 补充契约（2026-10-10 全链路收口）

8. **`ProjectId` 品牌贯穿身份槽位与源头**：`activeProjectId` / `ProjectView.id` / `WSLProject.id` /
   `RemoteProject.id` / `ProjectListItem.id` / 各 DTO `projectId` 全为 `ProjectId`；`ProjectId → string`
   可赋、反向必须经身份边界。**有意的非身份 `projectId: string` 槽位（不得误品牌）**：
   `editorStore` 的 tab 键形参（名 `projectId` 实为 `WorkspaceKey | '__app__'`）、`useTerminalTabs`
   的键形参、`getTabId`（tab 键）、`getProjectBrowserLabel`（名 formatter）、`onboardingApi` 的
   onboarding 键形参、`WorkspaceSession.of` / `mintWorkspaceKey`（入场 mint）。**注意 `terminalCacheKey`
   相反**：它取**真实 `ProjectId`**（`activeProject.id`）构造本地终端缓存键，属身份槽位。
   裸 string 在此类槽位与身份槽位间流动即违规 —— 原事故（tab 键被当 project 身份）正是这一类。
10. **消费端读 `tabs` 必须用 tab 空间键，禁止裸 `projectId`**：`editorStore.tabs` 按 `WorkspaceKey`
    （`id\0…`）分槽。任何 `tabs[projectId]`（裸 id）恒 miss —— 典型症状：切项目后全局 `activeTabId`
    未恢复、worktree 下读到别的单元。派生点唯一：渲染期 `useActiveWorkspaceKey(projectId)`；命令式
    `activeWorkspaceSession(projectId).key`；特定单元（主仓 / 指定 worktree）用 `WorkspaceSession.of(id, wt).key`。
    （`useLocalProjects` / `useProjectSelection` / `useWorktreeActions` / `useEditorAgentActions` /
    `DebugRunButton` / `useFileDrop` / `useBrowserPanelEvents` / `useBrowserTab` / `TerminalView` 已按此收口。）
    全局 `activeTabId` 的**写侧只有一个入口** `editorStore.restoreActiveTabId(tabKey | null)`（切项目/单元时，
    WSL/Remote 亦须调用，`useCrossTypeSelection` 已收口）；**读侧** `editorStore.activeTabIdOf(tabKey)`，
    **渲染期派生** `useActiveWorkspaceKey`。调用方只派生目标单元的 `tabKey`，不得各自 `setState({ activeTabId })`。
    禁止 `'' as ProjectId` 伪身份（缺值即 `null` + guard；`GitDialog.projectId` 为必填）。

9. **`DiffSource = { workspace: WorkspaceSession; revision: DiffRevision }`**：环境（local/WSL/SSH）
   维度由 `ProjectCommands`（按Workspace构造）承载，**禁止**再进 `DiffSource`；修订维度只有
   `worktree | commit | stash` 三种。远端 worktree 因此获得 `workspace.worktreePath` 维度
   （旧 8-variant 联合缺此维度）。`buildDiffSource` 已删除，构造点用**手头已有的 session**。

### 5. Good/Base/Bad Cases

- Good：worktree 激活时新建 agent/fi/browser tab，键 = `session.key`、tab 身份 = 同一 session，
  后端按裸 `ProjectId` 找到项目。
- Base：主仓单项目，行为不变（键多一层 `\0`）。
- Bad（重新引入根因）：`addTab(spaceKey, tab)` 再出现；`tab.projectId` 槽位复活；
  `projectId: tabKey` 形态；`WorkspaceSession#key` / `WorkspaceSession.fromKey` 被接回；`'__app__'` 散落硬编码。

### 6. Tests Required

- `shared/utils/__tests__/workspaceSession.test.ts`：golden ↔ Rust `WorkspaceRef::key()`、
  `JSON.stringify` 字段白名单（getter 不入 wire）、`fromKey` 往返 / 非法返回 null、getter 缓存、
  空串归一。
- `shared/types/identity.test-d.ts`：品牌互斥负向类型测试（`tsc` 覆盖）。
- `shared/store/__tests__/tabIdentity.test.ts`：8 个 TabData kind 键-身份一致性 + worktree +
  `__app__` + 原事故路径（身份不含 NUL）。
- `tools/guards/tests/test_check_workspace_identity.py`：判据 8（复合键入身份槽位）/ 判据 9
  （`__app__` 单点）/ 退役符号正反例。
- Rust `app_state::tests::project_context_rejects_nul_in_project_id`。
- `editor/hooks/__tests__/useTabManagement.test.ts`：`handleAddTab` 以**真实 `projectId`** 调用
  `addTab`（**不得**传复合 tab 键 —— 撤掉收敛即 RED）；`handleTabAgentClick` 把 tab 键形参收敛为 `projectId`。
- `git/hooks/__tests__/useOpenDiffTab.test.ts` / `useDiffData.test.ts`：`DiffSource` 为
  `{ workspace, revision }` 两字段形态（**环境维度不在其中**）。
- `shared/types/identity.test-d.ts`：`ProjectId` ↔ `WorkspaceKey` 品牌互斥、裸 string 不可赋（`tsc` 覆盖）。

### 7. Wrong vs Correct

#### Wrong

```ts
// 键由调用方指定 + 身份是裸 string：tabKey 可被误当 projectId
useEditorStore.getState().addTab(tabKey, { id, projectId: tabKey, title, order, data });
// 散件拼键（生产）
const key = WorkspaceSession.of(projectId, worktreePath ?? null).key;
```

#### Correct

```ts
// 身份是值对象；键由 tab 自身推导（调用方无从指定）
useEditorStore.getState().addTab({
  id,
  scope: { kind: 'workspace', session: activeWorkspaceSession(projectId) },
  title,
  order,
  data,
});
// 键 = session.key（投影）；项目粒度消费 = tabProjectId(tab)
```

## 常见错误

### 1. 继续把跨域数据通过多层 Props 透传

当前架构已经提供领域 Context。新增跨域字段优先评估是否应加入对应 Context。

### 2. 把无关字段塞进同一个 Context

Context 粒度过大将放大重渲染影响。新增字段时优先放入最贴近业务边界的 Context。

### 3. 在 `App.tsx` 重新堆积业务逻辑

根组件仅做装配（`<AppProviders>` + `<AppShell/>`）。领域协调逻辑统一收敛到 `useAppShell` /
`useAppShellData`（`src/app/hooks/`）或领域 Hook，布局/面板编排在 `src/app/shell/` + `src/app/panels/`。

### 4. 忘记持久化状态变更

需要跨重启保留的数据必须经过对应 `save_*` 调用。

### 5. 模块级缓存泄漏

终端缓存销毁时必须同步清理关联状态，避免 stale session。

### 6. 切换项目时 global `activeTabId` 未同步

**问题**：tab 状态在 `editorStore` 里是两层结构 —— 全局 `activeTabId` 与按 `tabKey` 分槽的
`tabs[tabKey].activeTabId`（`tabKey = WorkspaceSession.of(projectId, worktreePath ?? null).key`，主仓单元的 key = `projectId\0`）。切换项目/单元时若只写 `projectStore.activeProjectId` 而不恢复全局 `activeTabId`，
下游会用**上一个项目**的 tab id 算 `cacheKey`（终端缓存）或做 tab 解析，导致 cache miss 与孤立
PTY 创建。

**正确模式**：任何改变「当前项目/单元」的 setState 必须**同时**恢复全局 `activeTabId`：

```tsx
// src/features/project/hooks/useProjectSelection.ts（真实实现，节选）
const editorTabs = useEditorStore.getState().tabs[projectId];
useProjectStore.setState({ activeProjectId: projectId, activeProject: targetProject });
useEditorStore.setState({ activeTabId: editorTabs?.activeTabId ?? null }); // ← 必须成对
```

```tsx
// 错误：只更新 projectStore，editorStore.activeTabId 仍是上一个项目的
useProjectStore.setState({ activeProjectId: projectId, activeProject: targetProject });
```

**涉及位置**：`useProjectSelection.ts`（`selectProject`）、`useWorktreeActions.ts`（跨项目切 worktree）、
`useWorkspaceState.ts`（切回主仓）、`useLocalProjects.ts`（handleRemoveProject / 项目恢复）。

**下游防御性 guard**：终端缓存/tab 解析一侧同样要校验 `activeTabId` 是否属于当前 `tabKey` 的
tabs，不属于则跳过（不要用别的项目的 id 建 PTY 或算 `cacheKey`）：

```tsx
const projectTabs = useEditorStore.getState().tabs[tabKey];
if (activeTabId && projectTabs && !projectTabs.tabs.some((t) => t.id === activeTabId)) {
  return; // stale activeTabId from another project
}
```

### 7. 向 `FileTabData` 新增字段后忘记同步 `mergeTabData`

**问题**：`editorStore.ts` 中的 `mergeTabData` 函数（`src/shared/store/editorStore.ts:68`）为 `'file'` case 维护了一份硬编码字段列表。新增 `FileTabData` 字段（如 `isUntitled`、`untitledName`、`initialPreviewMode`）后，如果不同步更新 `mergeTabData`，`updateTab` 调用时会剥离新字段，导致字段永久丢失。`isUntitled` 丢失后 `saveAs` 流程静默失效。

**正确模式**：同步修改 `mergeTabData` 的 `'file'` case：
1. 在 `isFilePartial` 守卫中添加 `'fieldName' in p`
2. 在返回对象中添加 `fieldName: ... in p ? ... : d.fieldName`

```ts
// isFilePartial 守卫
const isFilePartial =
  'content' in p || 'isDirty' in p || 'filePath' in p ||
  'fileName' in p || 'externallyModified' in p ||
  'isUntitled' in p || 'untitledName' in p || 'initialPreviewMode' in p;

// 返回对象
return {
  kind: 'file' as const,
  ... existing fields ...,
  isUntitled: 'isUntitled' in p ? (p.isUntitled as boolean | undefined) : d.isUntitled,
  untitledName: 'untitledName' in p ? (p.untitledName as string | undefined) : d.untitledName,
  initialPreviewMode: 'initialPreviewMode' in p
    ? (p.initialPreviewMode as 'preview' | 'source' | undefined)
    : d.initialPreviewMode,
};
```

### 8. Save As 请求使用 `tabKey` 而非 `projectId`

**问题**：Editor store 的 tabs 按 `tabKey`（= checkout 身份的 `WorkspaceKey`，主仓为 `projectId\0`）索引，而非裸 `projectId`。`SaveAsRequest` 传 `projectId` 后在 `SaveFileDialog` 中用 `store.updateTab(request.projectId, ...)` 会导致 lookup 失败。

**正确模式**：`SaveAsRequest` 包含 `tabKey` 字段：

```ts
interface SaveAsRequest {
  tabId: string;
  tabKey: string;   // 必须传 tabKey，而非 projectId
  projectId: string;
  content: string;
  defaultDirectory: string;
  defaultFilename: string;
}
```

### 9. 自定义 zustand action 与内置 `getState` / `setState` 同名

**问题**：在 store 内自定义 `getState(projectId)` / `setState(projectId, patch)` 会与 zustand 内置的 `useStore.getState()` / `useStore.setState()` 同名。调用方必须写 `useStore.getState().getState(projectId)` 这种绕口令式代码，极易混淆；且若在 selector 中调用自定义 `getState`（内部 `set()` 幂等创建默认态），会在 React 渲染期间触发 setState，违反纯函数原则。

**正确模式**：自定义 action 用语义化命名（`getPanelState` / `setPanelState`），selector 只做无副作用读取：

```ts
// 正确：命名不冲突 + selector 无副作用
const panelState = useProjectBrowserStore((s) => (id ? (s.states[id] ?? null) : null));
const setPanelState = useProjectBrowserStore((s) => s.setPanelState);
```

```ts
// 错误：与 zustand 内置 API 同名，selector 内调用带 set 副作用的 action
const state = useStore((s) => s.getState(projectId));
```

**涉及文件**：`src/shared/store/browserStore.ts`（2026-08-06 修复）。

### 10. 新增 tab 关闭入口直调 `closeEditorTab` 绕过未保存确认

**问题**：关闭 tab 的入口有多条（X 按钮、菜单 `CLOSE_TAB_EVENT`、键盘快捷键）。若新增入口直调 `closeEditorTab` 而不经确认编排，dirty 文件 tab 会被静默关闭、内容丢失。历史事故（2026-09-04，任务 `09-04-cmdw-unsaved-confirm`）：`closeActiveTabCommand`（菜单 Cmd+W）与 `useTabManagement.handleCloseTab`（Ctrl+W 默认绑定）均绕过确认——untitled 新建文件输入内容后 Cmd+W 直接丢失，无任何提示。

**正确模式**：一律经 `closeTabWithConfirmation`（`src/features/editor/store/closeConfirmStore.ts`），编排契约见「场景：Tab 关闭入口统一走未保存确认编排」。新增关闭入口时自问：这条路径 dirty 时会弹确认框吗？

**涉及文件**：`src/app/hooks/closeActiveTabCommand.ts`、`src/features/editor/hooks/useTabManagement.ts`、`src/features/editor/hooks/usePaneActions.ts`、`src/app/AppModals.tsx`。

### 11. Tauri 事件 `unlisten` 未走 `safeUnlisten` 包装

**问题**：tauri 注入脚本的监听注销读 `listeners[eventId].handlerId` 时，该条目可能尚未由 `listen_js_script` 的 eval 填充（注册竞态），或已被前一次注销删除（双重注销）——同步抛 `undefined is not an object` → unhandledrejection → 用户 toast，且 `plugin:event|unlisten` 被跳过 → Rust 侧监听泄漏。触发条件：快速连续重订阅（deps 含 `activeProjectId`/`projectId` 的 effect 在项目切换时连跑）或同一 unlisten 被两处调用（如 terminalFactory closed 事件自注销 + cache 销毁再调）。历史事故（2026-09-04）：选择项目时 toast 报错，根因 `useFileTreeSync` 项目切换重订阅 + 多处裸 `unlisten()`。

**正确模式**：所有 `listen()` 产物的注销一律经 `safeUnlisten`（`src/shared/utils/safeUnlisten.ts`，单次放行 + 竞态重试 + 重试耗尽上报）：

```ts
// 正确：effect 清理经 safeUnlisten
const unlistenPromise = listen(EVENT, handler);
return () => {
  unlistenPromise.then((unlisten) => safeUnlisten(unlisten)());
};
```

```ts
// 错误：裸调用 unlisten（注册竞态/双重注销直接抛错）
return () => {
  unlistenPromise.then((unlisten) => unlisten());
};
```

新增 `listen` 调用点时自问：这个 unlisten 会不会在注册后极短时间内被调用？会不会被多处调用？——任一成立则必须 `safeUnlisten`。

### 12. 把「可派生的期望视图」做成一次性槽

**问题**：调试停点跟随曾用全局单槽 `editorStore.pendingNavigateTarget`（一次性消费、命中即清槽）承载「编辑器应展示当前停点」。槽清掉之后动作才在 `requestAnimationFrame` 里执行，若此时视图被重建／尚未测量，跳转静默丢失且**无补偿**；同时异步链（源码内容读取）也会写这个槽，旧停点迟到即覆盖新停点。表现为「有时不跳到断点，点一下栈帧才行」（issue #13，2026-09-16）。

**判定准则**：这个状态**能不能从既有 store 状态推出来**？
- 能（如「编辑器应展示当前停点」= f(`location`, `locationSeq`)）→ 必须**派生 + 幂等重放**（`viewEpoch` 变化即重放，丢失自愈），不要槽、不要清槽时序；
- 不能（如「用户点了定义跳转」）→ 才是**用户意图**，走**目标状态模型**（`NavigateGoal` + `useNavigateGoal`：seq 取代、requestMeasure 就绪屏障、幂等兑现、随 tab 移除清理——2026-09-17 起已替代旧一次性单槽，完整契约见 [导航目标状态模型](./navigation-goal.md)）。

**交叉引用**：代际守卫的完整契约、`locationSeq` 为何不可派生、跨 feature 落地许可（`isCurrent` 注入）见「场景：停点跟随（异步链代际守卫 + 跟随改为派生状态）」；交错用例的假绿防线见 `unit-test/frontend-testing.md` §9。
