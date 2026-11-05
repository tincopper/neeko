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

#### 组合根在 Provider **之外**：`App.tsx` 里装配的 hook 不得依赖 Context

`App.tsx` 是「先算 header、后渲染 `<AppProviders>`」的形状 —— 在函数体里调用的 hook
**运行在 Provider 树之上**，任何 `useAppContext()` / `useEditorContext()` 都会在首帧抛错
（整棵应用进 ErrorBoundary）。所以组合根只允许装配两类东西：

| 允许 | 例子 |
| --- | --- |
| 域 store（直接导入） | `useProjectStore` / `useDockStore` |
| 从 `useAppShell` 取到的**值**（含回调）当参数注入 | `useDockBarOpenTab({ agents, onAgentClick })` |

命令式提示走 store 侧 `notify()`（`shared/store/notificationStore.ts`，`showToast` 与它同一映射），
**不要**为此抓 `useAppContext`。事故形态（2026-11-03 `11-03-dock-placement` P0→P2）：
`useDockBarMove` 在组合根用 `useAppContext()` 取 `showToast`，`tsc` 与单测（包了 Provider）全绿，
真机首帧崩 —— 该类缺陷**只能靠「不包 Provider 渲染」的用例**拦住，见
`app/hooks/__tests__/useDockBarMove.test.ts` 顶部的注释与写法；新增组合根 hook 必须照抄该用例形态。

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

注意：`dockStore` 持久化、`appViewStore` 不持久化。中心视图入口与左栏互斥：打开 Library
即收起左栏（含 Projects）、关闭即恢复原展开态（`enterCenterView` / `exitCenterView`，transient
不持久化）。禁止在 App.tsx / 业务组件里直接用 `dockStore.zones.*.activeView` 判断中心视图
（Library 在 `dockStore` 里只是一个 `host:'none'` 的**图标落位**，进不进 zone 由声明表决定）。

### 9. Dock 面板 toggle/activate 框架契约（`dockStore.toggleView`）

**落位（placement）是唯一真源**：`placements[ViewKey] = { slot, order, onBar }`，工具栏与 zone
都是它的派生投影 —— `zones[].panels` 与 `barItems[]` 已删除，所以「图标在 A 侧、面板开在 B 侧」
不可表示。槽位维度（`slot`/`order`/`onBar`）只经 `moveView` / `setViewOnBar` 修改，能力校验
（`movable`）在 store 的 action 层。

所有面板切换（dock 栏按钮、快捷键）统一走此契约，禁止各面板自研开关语义：

- **toggle-off 仅当该视图当前可见**：它所在槽的前台就是它且已展开 → 收起；其余一律按**激活**处理
> （切到该视图并展开其所在槽）。
- **从 tab 视图退出时的本次点击强制激活**：tab 覆盖期间 zone 可见态是过期/被收起的，
> 此时若走 toggle 会反直觉地关掉用户刚点的面板（如 Library 中点 Projects 反而收起列表）。
- 快捷键（`toggleDockProjects` 等）复用同一入口，自动获得该语义，无需分支处理。

**三个视图族由 `activation.kind` 显式分支**（不再靠一个 `openAs` 字符串推断）：

| `activation.kind` | 族 | 点击落地 |
| --- | --- | --- |
| `toggleZone` | 单例面板 / 槽位 tab 宿主 | `dockStore.toggleView`（上一条契约） |
| `appView` | 中心全宽视图（Library） | `dockStore.toggleView` → `appViewStore`（与左栏互斥） |
| `openTab` | 种类级入口（`tabKind:agent-chat` / `tabKind:terminal`） | **app 层** `useDockBarOpenTab`（`useDockBarButtons` 注入给按钮） |

**槽位宿主不上工具栏**（D10）：`host: 'tabHost'` 的视图 `onBar` 恒为 false —— `sanitize`
强制、`setViewOnBar` 对它是 no-op。工具栏那一列只放功能入口；宿主的可达性由「新建/接回/
移动都会 `activateView`」+「内容到达即前置自动展开」（`useDockTabHostReveal`，见 Contract 9）
承担。配套限制：**只有带功能入口的种类（`canDockTabKind`）允许停靠**，否则会造出「藏进侧区、
再也点不到」的 tab。

`openTab` **刻意不进 store**：store 不持有 tab 空间，在那里做「找已有 / 新建 / 移动」会把顺序知识
散到两个模块 —— 所以 `toggleView` 对该分支直接 `return`。落地语义两条：已有该 kind 的 tab 就
**激活**（在停靠宿主里同时展开宿主），否则新建并**停靠到图标当前所在的槽**（`placements` 读，
`meta.defaultSlot` 只是兜底 —— 禁止再造一条 `kind → slot` 策略）。无项目 / 拿不到 agent 必须提示，
静默 no-op 不可接受（`DockBarButton` 只调用注入的 handler，不 import 任何 feature 域）。

**种类入口的选中态只看「本栏」**（`selectSlotFrontTabKind` / `useSlotFrontTabKind`）：
图标亮 ⟺ **图标所在槽**的 tab 宿主可见（`slotVisibleView(slot)` 是宿主）**且**它的前台 tab
（`selectDockedActiveTab`）正是该种类。中心区的前台 tab **不参与** —— 中间的 chat / terminal 不是
「这一栏被打开」，把它算进来会让图标在右栏收起时也常亮（回归 2026-11：中间开 Terminal，右栏
Terminal 图标被点亮，用户无法从图标判断右栏到底是开还是关）。

这条判据的每个事实只有一个派生点：`shared/dock/placement.slotVisibleView`（**本槽**在显示
谁）与 `shared/store/editorTabSelectors.selectDockedActiveTab`（该宿主前台是哪条 tab，含存活
口径）。`useDockBarOpenTab` 的 toggle-off 与 `DockTabHost.isActivePane` 用的是同一对函数 ——
分叉的表现是「图标亮着但点一下不收起」/「图标说隐藏、webview 说显示」。

两个口径不得混用：**槽内**问题（这一栏在显示谁）用 `slotVisibleView`，**跨槽**问题（它是否出现
在屏幕上）用 `isViewVisible`。用错不会报错，只会在「另一个槽的前台指向本槽」这类异常快照下
待机出错。

高亮与点击不是等价关系：`dockEntryScope: 'slot'`（terminal）因为 `findTabInSlot` 同样前台优先，
高亮时点一下 = 收起；`'anywhere'`（agent-chat）点击是「回到我正在用的那条」，可能落在中心区。

---

## 何时使用全局状态

本项目的全局状态是**按域拆分的 Zustand store**（`src/shared/store/` + feature store）
**加** Context 分发层（只放动作与稳定基础数据）。没有单一 app store：

| 归属 | store | 典型字段 |
| --- | --- | --- |
| 项目 | `projectStore` | `projects` / `activeProjectId` / `activeProject` / `statuses` / `git_info` 投影 |
| Workspace激活态 | `workspaceStore` | `byProject[projectId].activePath / activeBranch / opened` |
| 编辑器 tab | `editorStore` | `tabs[tabKey]`（Tab 注册表） / `editorLayout`（唯一权威：顺序 + 前台） / `navigateGoal` |
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
tabs: Record<WorkspaceKey, ProjectTabs>;   // ProjectTabs = { tabs: Tab[] }，**只**是 Tab 注册表
editorLayout: Record<WorkspaceKey, EditorSplitLayout>;  // 唯一权威：顺序（tabIds）+ 前台（activeGroupId → 组的 activeTabId）
// 无顶层 activeTabId、无 ProjectTabs.activeTabId、无 Tab.order（2026-10-15 单源化删除）；
// 前台/顺序的唯一派生点在 src/shared/store/editorTabSelectors.ts。
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
| `openFile` 命中已打开 tab | 同一 tab 身份 | 仅切换激活（布局的激活组 `activeTabId`，经 `selectActiveTabId` 派生） | 无 |
| `saveFile` 失败 | `write_file_content` 抛错 | 返回 `false`，`isDirty` 保留 | 编辑器保持编辑态 |

### 5. Good/Base/Bad Cases

- Good：打开未打开文件 → 新增 tab 并激活，`activeFilePath` 与激活 tab 对齐。
- Base：关闭当前 tab → 激活相邻 tab；关闭最后一个 tab 后前台（`activeTabIdOf`）为 `null`。
- Bad：无激活 tab 时执行保存 → 返回 `false`，store 不写入脏数据。

### 6. Tests Required

- `useFileView` 单测断言
`openFile` 命中已存在 tab 时不追加 file tab 数量。
`closeTab` 关闭当前 tab 时布局激活组回退到相邻 tab（`activeTabIdOf`）。
`saveFile` 成功后 `isDirty=false`，失败后保持 `isDirty=true`。
- 组件集成断言
`FilesPanel`（原 `FileViewer` / `AppLayout` 时代）读 `@/features/file/store` 的 `dirs` / `activeFilePath` 渲染。
文件动作经 `FileActionsContext` 下发，组件不直接 invoke。
- 回归断言
收尾跑一次 `pnpm check:quick`（已含 `pnpm type-check` 与改动文件相关的 `vitest`）；
不要再单独补跑 `pnpm type-check` / `pnpm test:fe` —— 它们不是更细的检查，只是重做同一批工作。

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
| 浏览器被用户移到别的槽 | 右槽 views 不含 browser | none（布局是用户决定，切项目不搬动它；`add-and-activate` 已随后位模型删除） |

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
// src/features/editor/store/closeConfirmStore.ts —— **只做「问」**：待确认请求 + resolver 槽位
useCloseConfirmStore.request(fileName: string): Promise<'save' | 'discard' | 'cancel'>;
useCloseConfirmStore.requestTerminalClose(title: string): Promise<'background' | 'exit' | 'cancel'>;
useCloseConfirmStore.resolve(action): void;

// src/features/editor/store/closeTab.ts —— **只做「做」**：无状态编排（三条关闭路径共用）
closeTabWithConfirmation(tabKey: string, tabId: string, saveTab?: (tabId: string) => Promise<boolean>): Promise<boolean>;
```

两个文件同目录、职责相反：state 与副作用分开，各自的测试方式与失败面才分得开
（store 测「回传 / 并发排队 / overlay 幂等」，编排测「弹不弹、选完怎么关」）。
两者都在 `store/` 下是因为 `store/` 是 editor 域对其它域唯一放行直导的非门面路径 ——
app 层（Cmd+W / `AppModals`）必须能直接用到它，塞回门面会把 CodeMirror / LSP 整张
依赖图拖进每个只想关 tab 的调用点。

### 3. Contracts

- dirty 文件 tab（`isDirtyFileTab`）→ 经 store 弹三选确认框（全局唯一实例，渲染于 `AppModals`）。
- `'cancel'` → 不关；`'discard'` → 直接关；`'save'` → `saveTab` 成功才关（失败含 Save As 取消 → 不关）。
- 非 file tab / 非 dirty → 直关，不弹框。
- **会话还在跑**（terminal tab 的 `ptySessionId` 命中注册表且 `isBusySession`：`running` /
  `awaitingApproval`）→ 弹「后台运行 / 退出进程 / 取消」。`ready`（agent 干完、进程还在）
  不问 —— 那时关 tab 就是普通的关 tab，弹「它还在跑」是在说假话。
- `'background'` → `closeEditorTab(tabKey, tabId, { keepSession: true })`：只拆界面。
  **drain 转分离态的唯一写入点在 `terminalCache.destroyCache(keepSession)`** —— 它按每个
  pane 的缓存条目切（一个 tab 可拆多 pane、各自一条 PTY），编排层只看到 `tab.data.ptySessionId`
  一个 id。不要在编排层再 detach 一次（同一事实两个 owner，且会漏掉其它 pane）。
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
- `store/__tests__/closeTab.test.ts`：运行中会话的决策矩阵（cancel 不关 / background 带
  `keepSession` / exit 普通关 / `ready`·已结束·会话缺失不问）+ tab 已消失时不挂起。
- `terminal/components/__tests__/terminalTabCleanup.test.ts`：`keepSession` ⇒ **每个 pane**
  的 session 各切一次分离态，且不调用 `closeTerminalSession`。

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
  唯一写入口）、`shared/store/workspaceStore.ts`（激活态单源）、`app/hooks/useVisibleWorkspaces.ts`
  （可见集合唯一发送端，C4）、`features/git/utils/gitStatus.ts`。

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
6. **可见集合只有一个写者，且形态是声明式 reconcile**（C4）：只有 `app/hooks/useVisibleWorkspaces.ts`
   会向后端声明「现在谁可见」——一个 effect、一次 `set_visible_workspaces(hotSet)`；用户动作
   （点 worktree、切回主仓）只写激活态。后端的语义是**收敛**：挂载集合内的单元、释放集合外已
   挂载的单元（同一次调用、同一临界区内完成，不是「挂一个踢一个」）。

   - **热集合 = 内容可见性**：当前视图单元。停靠面板都渲染当前单元，所以集合恒为 1 元素；形状
     保留集合（多面板同时展示两个不同 Workspace 才是 2，见任务 prd 的开放问题）。
   - **发送去重判据 = `WorkspaceKey` 排序后的字符串签名**。**禁止**按对象 / 数组身份去重 ——
     集合每次渲染都是新对象，那等于「永远变了」（`hook-guidelines.md` 常见错误 5）。
   - **没有重试环、没有记账**：`pending`（挂载已成立、首快照在途）⇒ 什么都不做，读路径
     （C1 起读永远给得出答案）与 `git-status-snapshot` 推送会收敛；`failed` ⇒ 一条
     `logFrontendError`（不弹用户可见错误）。**禁止**引入 `requestedIntent` / `inflightMount` /
     `retryTick` 类「我请求过谁 / 后端挂了谁」的变量 —— 那是后端资源状态的影子副本（红线 17，
     护栏 `check_frontend_resource_mirror`）。
   - **判死点**：激活单元从清单消失 ⇒ 回落主仓只由「用户动作」（`useWorktreeListActions` 的
     `clearActiveWorkspace`、切项目）与「清单读取」（`useSessionBootstrap` 恢复、
     `useRefreshGitInfo` 刷新 → `fallbackToMainIfWorkspaceGone`）触发。**禁止** render-time 逐渲染
     比较 `git_info.worktrees`（两处判死互抖是 2026-09-28 的既成事故，C4 已删掉那个 effect）。

   **机制与实现取舍**见 `app/hooks/useVisibleWorkspaces.ts` 的 docstring（本规则只留判据与禁令 ——
   同一条理由写两遍，改一处必漏另一处）。把 `WorkspaceKey` 写进日志/提示一律走
   `workspaceKeyLabel` —— 键含 NUL 分隔符，直接插值会让日志文件被判成二进制（`file(1)` 报
   `data`，检索与轮转一并失效）。
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
    「已知且干净」）。
11. **列表行数字的来源 = 同一个快照，按单元读**（`↑N` 待 push 提交数等）：行组件的 props
    由 **adapter** 提供（`ProjectGitSection` / `ConnectionProjectCard` 已接 `gitStore`），
    **展示组件不得读 store / `invoke`**（`component-guidelines.md` 的「展示组件 + 数据 adapter
    跨域复用模式」）。键 = `WorkspaceSession.of(projectId, unitPath ?? null).key`，
    `unitPath` 取自 `useActiveWorkspaceKey(projectId)`——与 local 行逐字同一条规则，
    **禁止**另造 worktree 专属通道，也禁止把 adapter 层逻辑下沉到行组件。
    **未知（store 无该键）⇒ `undefined` 不渲染**，不得折算成 `0`。
12. **快照只承载廉价且必得的派生值**：`entries` / `branch` / `ahead` / `behind` 与快照**同批同
    版本**产出（`GitStatusSnapshot`），行级 `+A/−D`（`git diff --numstat`）**不进快照**——
    它由 G4 有意移出 status 热路径，正确出口是按需的 `get_changed_files_diff_stats`
    （Git 面板内使用，不回写 store）。**禁止**在消费侧对 `entries[].additions/deletions` 求和
    当行级统计：porcelain 不产出行数（`parsers/status.rs` 恒 0），那是恒空的死码通道
    （栈侧同款契约见 `backend/git-domain.md`）。
13. **异步响应落地前必须做单射取代判定（`requestId` / 序号），且号源不得在清空时归零**：
    store 自己的 async handler（如 `searchStore.run`）在 `await` 前后可能已被更晚的请求（新查询 /
    **切单元**）取代。此时旧响应携带的是**另一个根**下的相对路径，写进去就是把别的单元的文件
    当成本单元的事实（与红线 12 同族的「基准错位」形态，只是出现在异步路径上）。
    - **判据**：`if (get().requestId !== requestId) return;` —— 成功与**失败**两条分支都要判
      （旧请求的 reject 不得把新单元的搜索报成 `error`）。
    - **号源约束**：`clear()` **不得**重置单调计数器。否则切单元后的新请求**重用旧 id**，
      两个请求不可区分，陈旧响应照样能写进去（实测：切 A→B 后 A 的迟到响应污染 store）。
    - **与 §3 契约 3（后端 version 闸门）的分工**：后端 version 管「同一 key 内新老」，
      本条的 `requestId` 管「同一发起者在飞请求的取代」—— 两者不可互代。
    - **与已退役的「2026-08-07 generation Map」的区别**：那里是前端自造 per-project 身份
      （错），这里只是**单次请求的代际**（与身份无关，不回退成第二份身份表示）。
    **回归测试**：`searchStore.test.ts` —— 发起 A → `clear()` → 发起 B → 再 resolve A，断言
    A 的路径**不得**出现在结果里（临时删掉 `requestId` 判定必须 RED）。

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
  给 `applyStatus` 加「`version === 0` 也放行」的兼容分支；再引入第二个「声明谁可见」的发起点
  （或在前端记账「后端挂了谁」）；给 ahead/behind 再拼一次 `{source}:{connectionId}` 前缀；
  事件消费点用 `project.path` 当相对路径基准。

### 6. Tests Required

- `shared/utils/__tests__/workspaceRef.test.ts`：golden key 形态必须与后端
  `workspace_ref.rs::golden_key_format_matches_frontend_contract` 逐字一致（`'proj-1\0'` /
  `'proj-1\0/srv/app/.worktrees/dev'`）；`workspaceRootOf` 主仓回落 / worktree 取路径。
- `shared/store/__tests__/projectStore.test.ts`：`applyStatus` 拒旧（含同版本）、跨单元互不覆盖、
  `invalidateStatus` 只作废一个。
- `shared/store/__tests__/workspaceStore.test.ts`：`selectActiveWorkspaceKey` / `activeWorkspaceKeyOf` 的
  两个形态同语义、跨项目不串用。
- `app/hooks/__tests__/useVisibleWorkspaces.test.ts`：集合不变不重发（含重渲染）/ 集合变化只发一次 /
  `ready` 写槽位 / `pending` 什么都不做 / `failed` 只记一条 dev 日志且不重发 / 非 git 项目声明空集合。
- `shared/store/__tests__/workspaceStore.test.ts`：`fallbackToMainIfWorkspaceGone` 三态
  （仍在清单 ⇒ 不动 / 不在 ⇒ 回落主仓并作废槽位 / 空清单也算消失）。
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
export interface Tab { id: string; scope: TabScope; title: string; data: TabData }
// 注意：无 order 字段 —— 顺序是布局（editorLayout[key].groups[*].tabIds）的职责，
// 唯一派生点 selectOrderedTabIds（editorTabSelectors.ts）。

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
11. **持有 session 本体的组件下传本体，不传 tabKey 字符串再反解**：`PaneContent` 经
   `requireTabWorkspaceSession(activeTab)`（=`tab.scope.session` 的非空收窄）拿到本体后，
   需要 session 的子组件/hook（如 `useAgentInputRegistration`）收 `session: WorkspaceSession` prop，
   **禁止**只传 `tabKey: string` 再 `WorkspaceSession.fromKeyOrId(tabKey)` 反解 —— 那是同一身份的
   第二种表示，且 `fromKeyOrId` 的宽容分支（裸 id → 主仓）会把传错的键静默归一为主仓，
   worktree 下错配而不报错（2026-10-13 实证，见本任务 `design.md` §8.1 注记 14）。
   `fromKey` / `fromKeyOrId` 只允许出现在 wire 边界（事件载荷、分量解析、日志/golden），
   手头有 `Tab` 对象时一律用 `tabWorkspaceSession(tab)` / `requireTabWorkspaceSession(tab)`。

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
    （`id\0…`）分槽。任何 `tabs[projectId]`（裸 id）恒 miss —— 典型症状：worktree 下读到别的单元。派生点唯一：渲染期 `useActiveWorkspaceKey(projectId)`；命令式
    `activeWorkspaceSession(projectId).key`；特定单元（主仓 / 指定 worktree）用 `WorkspaceSession.of(id, wt).key`。
    （`useLocalProjects` / `useProjectSelection` / `useWorktreeActions` / `useEditorAgentActions` /
    `DebugRunButton` / `useFileDrop` / `useBrowserPanelEvents` / `useBrowserTab` / `TerminalView` 已按此收口。）
    **前台 tab 的读侧只有一个派生点** `editorStore.activeTabIdOf(tabKey)`（内部即 `selectActiveTabId`，
    从 `editorLayout` 的激活组派生）；**渲染期**用 `useActiveWorkspaceKey(projectId)` 派生键后同上。
    全局 `activeTabId` 与 `restoreActiveTabId` **已删除**（2026-10-15 单源化）—— 切项目/单元不再需要「恢复」
    任何前台位；调用方也不得再 `setState({ activeTabId })`（该字段不存在，编译期即拦）。
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
// 身份是值对象；键由 tab 自身推导（调用方无从指定）；order 已删除（顺序属布局）
useEditorStore.getState().addTab({
  id,
  scope: { kind: 'workspace', session: activeWorkspaceSession(projectId) },
  title,
  data,
});
// 键 = session.key（投影）；项目粒度消费 = tabProjectId(tab)
```

#### Wrong（已持本体处逆向重建 —— 契约 11）

```ts
// PaneContent 手头已有本体，却只下传字符串，子层再反解：多一层耦合 + 宽容分支静默归一
<AgentChatTabView tabKey={tabSpaceKeyOf(activeTab.scope)} ... />
const session = WorkspaceSession.fromKeyOrId(tabKey); // worktree 下传错键 → 落主仓，不报错
```

#### Correct（本体下传）

```ts
// 本体只解析一次，下传对象；tabKey 仍按需另传（store 键位），但身份只认 session
const tabSession = requireTabWorkspaceSession(activeTab);
<AgentChatTabView session={tabSession} tabKey={tabSpaceKeyOf(activeTab.scope)} ... />
```

---

## 场景：编辑器 tab 前台/顺序单源化（删除 `activeTabId` / `order` 双表示） 2026-10-15

### 1. Scope / Trigger

- Trigger（用户实测缺陷）：**分屏后拖文件复制路径，落到上一个 pane 的输入框而非当前激活 pane**；
  同日实测 Cmd+W 关错 tab。
- 根因（第一性原理）：`editorStore` 用两个数据结构描述同一个「tab 空间」——平铺的
  `ProjectTabs { tabs, activeTabId }`（含 `Tab.order`）与分屏权威的 `editorLayout`。于是**两个事实
  各有两个表示**：「哪个 tab 在前台」与「tab 顺序」。分屏之前两者恰好重合（只有一个组），冗余无害；
  2026-05-13 引入分屏后二者分离。
- 为何必须结构性消除而非补同步：`activateTab` 同 commit 同步了两处、`setActiveGroup` 只改布局 ——
  即从出生起就是**约定**而非**构造**；此后 `splitRight` / `moveToRight` / `moveToLeft` / `unsplit` /
  `pinTab` / `unpinTab` 全部只改布局。让 15 个写 tab 状态的 store 动作各自记得刷缓存 = 概率来源，
  与具体哪个动作漏了无关（`projectActiveTab` 补丁实测仍漏 pin/unpin）。
- Scope：`shared/types/tab.ts`（`ProjectTabs` / `Tab`）、`shared/store/editorStore.ts`、
  **新增** `shared/store/editorTabSelectors.ts`、`shared/types/terminal.ts`、全部前台/顺序读点、
  护栏 `check_terminal_foreground_arbitration`（A5）。

### 2. Signatures

```ts
// shared/types/tab.ts —— 容器只是注册表；顺序/前台都不在这里
export interface Tab { id: string; scope: TabScope; title: string; data: TabData }
// 注意：无 order 字段
export interface ProjectTabs { tabs: Tab[] }
// 注意：无 activeTabId 字段

// shared/store/editorTabSelectors.ts（新增）—— 「tab 空间视图」的唯一读取面
export interface EditorTabSpaceState {
  tabs: Record<string, ProjectTabs>;
  editorLayout: Record<string, EditorSplitLayout>;
}
export function selectOrderedTabIds(state, tabKey: string): string[];   // left → right → pinned → docked.left → docked.right
export function selectOrderedTabs(state, tabKey: string): Tab[];         // 跳过已失效 id
export function selectActiveTabId(state, tabKey: string): string | null;  // 激活组的 activeTabId
export function selectActiveTab(state, tabKey: string): Tab | null;       // 前台 Tab 对象
export function hasCenterTabs(state, tabKey: string): boolean;           // 中心画面是否有可渲染 tab（不看 docked）
export function countDockedTabs(state, tabKey: string | null, slot: DockSlot): number;  // 某槽宿主里**可渲染 tab 的条数**（zone 可见性 + 揭示的唯一内容事实；tabKey=null → 0）

// shared/store/editorStore.ts —— 命令式薄封装（内部即 selectActiveTabId）
export function activeTabIdOf(tabKey: string): string | null;
// 已删除：restoreActiveTabId(tabKey) / EditorStoreState.activeTabId / ProjectTabs.activeTabId / Tab.order
```

### 3. Contracts

1. **布局是唯一真源**：顺序 = `editorLayout[tabKey].groups[*].tabIds`（左 → 右 → pinned →
   docked.left → docked.right）；前台 = `editorLayout[tabKey].groups[activeGroupId].activeTabId`。
   **不得再存第二份表示**。
2. **唯一派生点**：所有前台/顺序读取必须经 `editorTabSelectors.ts`（React 用同名 selector，
   命令式用 `activeTabIdOf`）。禁止任何消费侧自读 `tabIds` 拼顺序、或另存「当前 tab」。
3. **pinned 与「前台」正交**（有意保留）：`selectActiveTabId` **只反映编辑器组**，不含
   `pinnedActiveTabId`。`activateTab(pinnedTab)` 只置 `pinnedActiveTabId`；pinned tab 不可关、
   Cmd+W 从不命中它（与今日行为一致）。
4. **不变量 I1**：有 tab 的空间必有 layout，且 `left.tabIds ∪ right.tabIds ∪ pinnedTabIds ∪
   docked.left ∪ docked.right` 恰好枚举该空间的 tab。`addTab` 是唯一 tab 创建入口 → 由构造满足。
   `useEditorGroupLayout` 与 `editorStore` 的缺-layout 分支是纯防御（生产中不可达），缺 layout 时
   前台降级为 `null`（不抛）。
5. **顺序语义变更（有意）**：仲裁按**视觉顺序**取首个，而非创建序 —— 拖拽重排后插入落点随之改变。
6. **顺序不需要 `sort`**：顺序直接来自布局数据，消费方**不得**再写 `sort((a,b) => a.order - b.order)`
   （护栏 A1 在 terminal/browser/status-bar 域内拦）。
7. **错误不可表示才是根治**：删字段后，`existing.activeTabId = ...` 编译不过 —— 这是选择
   「删字段」而非「加同步 helper」的唯一理由。
8. **形态判据也从布局派生**：某个 surface「有没有东西可渲染」（`ProjectView` 的编辑器 / 引导页、
   `DockTabHost` 的宿主）= **该 surface 的组里还有存活 id**（布局给归属与顺序，注册表裁定存活）。
   禁止用注册表数量当判据（`tabs[tabKey].tabs.length`）：停靠后注册表非空而中心组为空，表现是
   空 panes 顶掉引导页（2026-11 P4 实测）；同理，布局残留已关闭 tab 的 id 也不算可渲染。
   判据实现：`hasCenterTabs`（中心）/ `countDockedTabs`（槽位宿主，返回**条数**）—— 两者共用
   `liveIdsOf` + `liveIdCount`（`editorTabSelectors.ts` 内的唯一实现）；宿主读取面 `useDockedPane`
   按同一口径（布局给顺序、注册表裁定存活）跳过幽灵 id。
   返回条数而不是布尔是**同一事实的更细形式**（不是第二个判据）：可见性只需 `> 0`（由
   `isZoneRenderable` 内部决定一处），揭示还需要 `1 → 2` 可观测（见第 9 条）。

9. **zone 级形态判据（P5，2026-11-03）：容器可见性从内容派生**。`zone 渲染 = 展开 ∧ 前台视图
   有内容可渲染`，唯一实现是 `shared/dock/zone.ts` 的 `isZoneRenderable`（前台是谁的唯一派生点是
   同文件的 `zoneFrontView`）：
   - 无状态面板「有内容」恒真 ⇒ 既有行为不变；槽位宿主 = `countDockedTabs(state, tabKey, slot) > 0`
     （该判断**只在 `isZoneRenderable` 内部**出现一次；内容事实由 `AppShell` 经
     `useDockTabHostContent` 注入 `tabHostTabCounts`，layout 层不 import tab 域、也不做布尔映射）；
   - **禁止把「宿主空不空」写回 store**（`setSlotExpanded(false)` 等）：持久化的 `zones.expanded`
     会比不持久化的 tab 活得更久，正是「空岛 + 解释文案」的成因（D7 已退役）；
   - `host: 'none'` 的视图（Library / 种类级入口）只有落位没有 zone 内容 ⇒ `DockZone` 的渲染列表
     与前台回落一律走 `zoneHostedViews` / `zoneFrontView`，**不得**再用「registry 里有没有 component」
     当过滤器（Library 有组件但不是 zone 面板）或自写 `views.includes(activeView) ? … : views[0]`。
   - 规格与场景：「空宿主不占位」的验收面是 `shared/dock/__tests__/zone.test.ts`（纯函数）、
     `layout/dock-layout/__tests__/DockLayout.test.tsx`（接线：zone 宽度 = 0%）与
     `DockTabHost.test.tsx`（空即渲染为空、关光不写 intent）。
   - **内容到达即前置（P6，2026-11-03）：揭示也由 app 层承担，宿主零布局写入**。「某槽宿主的
      可渲染 tab **条数增加**」时，该槽要被激活并展开 —— 否则自动停靠（Action Menu / 侧栏点会话 /
      history 恢复，只经 `addTab` 问种类策略 `docksNewTabs`）会把 tab 建在**收起的槽**里，tab 存在
      但看不见。
      - **唯一实现**：`app/hooks/useDockTabHostReveal`（`AppShell` 装配），入参就是上面那个内容事实
        `useDockTabHostContent()`；只在 **`counts[slot] > prev[slot]`**（到达 = 条数增加）上
        `activateView(tabHostView(slot))`，初值取当前值（挂载时不触发），两槽同一规则（遍历 `DOCK_SLOTS`）。
        不变 / 减少一律不动 —— 关 tab 不得把用户收起的槽重新打开。
      - **判据是条数而不是布尔**（P6-2b 转正）：布尔只有「假 → 真」一次跃迁，漏掉最常见的一击 ——
        槽已折叠且已非空（1 条）时再自动停靠一条（2 条），没有跃迁可观测，那次点击静默无反应。
        计数与可见性判据读的是**同一个事实**（`countDockedTabs`），不要同时维护布尔与计数两份。
      - 两条**已拍板**的伴随行为（有意保留，不得在本 hook 里加特判）：
        1. **切工作区构成到达**：计数按当前单元重算（键是 `useActiveWorkspaceKey`），新单元条数高于
           旧单元 ⇒ 揭示把该槽前置（该单元的内容刚刚变得可渲染）；
        2. **揭示会退出 Library**：`dockStore.activateView` 的既有语义（打开任何 dock 面板即退出全宽
           中心视图）不变。要改就改 `activateView` 的语义，不得在这条路径上加分支。
      - **为什么不在宿主组件里**：`DockTabHost` 只在「槽展开 ∧ 自己是前台」时挂载（`DockZone` 对收起的
        槽 `return null`）—— 写在宿主 effect 里的揭示在槽收起时永远不执行。宿主因此只读布局、渲染内容，
        **不写任何布局**。
      - **禁止**在 `registerTabSurfacePolicy` / `registerNewTabDockPolicy` 的 updater 内写 `dockStore`：
        那段回调跑在 `editorStore.addTab` 的 `set((state) => …)` updater 内部，在纯推导里写另一个 store
        是副作用（updater 重跑会重复触发），也是跨域耦合。
      - 验收面：`app/hooks/__tests__/useDockTabHostReveal.test.ts`（0→1 揭示 / **1→2 仍揭示** /
        2→1 与关光不动 / 挂载不揭示 / 真实缺陷路径 —— 槽收起时 `addTab` 自动停靠仍揭示 / 左槽同规则）。

### 4. Validation & Error Matrix

| 场景 | 输入 | 预期 |
|------|------|------|
| 分屏后 `moveToRight(B)` | 拖文件到输入框 | 落 **B**（当前激活 pane） |
| 分屏后 `setActiveGroup('left')` | 拖文件 | 落左 pane 的激活 tab |
| 分屏后 `pinTab` → `unpinTab` | 拖文件 | 仍落正确的编辑器组前台（补丁漏掉的路径） |
| 分屏后 Cmd+W | — | 关闭**当前激活 pane** 的 tab |
| `reorderTab` 把 C 拖到 A 前 | 仲裁「首个终端」 | 按**新视觉顺序**取首个 |
| `activateTab(pinnedTab)` | 组前台 | **不变**（pinned 激活态正交） |
| 缺 layout（防御分支） | 前台读取 | `null`（不抛、不伪造） |

### 5. Good/Base/Bad Cases

- Good：分屏 + 换 pane + pin/unpin 后，拖拽/Cmd+W/仲裁全部跟随布局。
- Base：单 pane 无分屏，行为与改造前一致（前台 = 左组激活 tab）。
- Bad：重新引入 `ProjectTabs.activeTabId` / `Tab.order` / 顶层 `activeTabId`，或用
  `projectActiveTab` 式的「逐点补同步」——下一条新增写点必再漏（护栏 A5 拦字段回潮）。

### 6. Tests Required

- `shared/store/__tests__/editorTabSelectors.test.ts`：顺序（left→right→pinned→docked、跳过失效 id）、
  前台（组内 / 换组 / 缺 layout → null）、**pinned 不影响组前台**、形态判据 `hasCenterTabs`（仅
  docked → false；中心任一组的活 id → true；布局残留已关闭 tab 的 id → false）。
- `shared/store/__tests__/editorStore.test.ts`：AC1（分屏后前台）/ AC2（pin→unpin 后前台）/ AC4
  （`reorderTab` 后 `selectOrderedTabIds` 反映新顺序）。
- `app/hooks/__tests__/closeActiveTabCommand.test.ts`：AC3（分屏后 Cmd+W 关当前 pane 的 tab）。
- `features/terminal/components/__tests__/terminalRouting.test.ts`：仲裁落到正确 pane。
- **变异验证**：把 `selectActiveTabId` 改回「忽略 activeGroupId」/ 把 `selectOrderedTabIds` 改回
  「按创建序排序」，上述用例必须 RED；恢复即 GREEN。
- 护栏 `tools/guards/tests/test_check_terminal_foreground_arbitration.py`：A5（字段回潮）正反例。

### 7. Wrong vs Correct

#### Wrong

```ts
// 第二份表示：分屏 / 拖拽重排后与布局分叉
useEditorStore.getState().addTab({ id, scope, title, order: tabs.length, data });
const active = projectTabs.tabs.find((t) => t.id === projectTabs.activeTabId);
const sorted = [...tabs].sort((a, b) => a.order - b.order);
```

#### Correct

```ts
// 布局唯一权威；派生点唯一
useEditorStore.getState().addTab({ id, scope, title, data });
const active = selectActiveTab(useEditorStore.getState(), tabKey);
const ordered = selectOrderedTabs(useEditorStore.getState(), tabKey);
```

---

## 场景：文件树展开态与目录缓存同槽（「展开即加载」不变量）2026-10-18

### 1. Scope / Trigger

- Trigger：文件树里点开一个目录，chevron 显示已展开、子项一片空白、无 spinner 也无错误红点；
  必须再点一次（先收起再展开）内容才出来。
- 第一性原理：**「目录已展开」与「目录内容已就绪」是同一事实的两个侧面**，必须共享坐标系
  `(owner, dirPath)` 与生命周期。当时展开态是面板组件 `useState<Set<dirPath>>`（只有 `dirPath`
  一个分量），目录缓存 `dirs` / `loadStates` 在 store 里按 `owner = fileTreeOwner(projectId, root)`
  分槽。切项目 / 切 worktree 时 store 惰性丢弃缓存，组件态却跨项目存活 ⇒ 新树里该路径
  「已展开但无缓存」。`store.reset()` 也救不了：唯一调用者 `clearFileView` 在生产里没有调用点。
- 第二性原理：**「确保展开」与「翻转展开」是两个意图**。`locateFile`（定位到某文件）、
  打开 tab 联动、在目录内新建，都要的是「确保展开（幂等）」；只有用户点行才是「翻转」。
  旧实现把两者混为一个 `onExpandDir`，于是重复定位会把已展开的祖先**收起**。
- Scope：`features/file/store.ts`（展开态所有者 + 两个原子动作）、
  `features/file/hooks/useDirExpansion.ts`（展开命令层 + 包链策略）、
  `features/file/hooks/useFilePanelState.ts`（`locateFile` / `startCreating` 的编排）。

### 2. Signatures

```ts
// features/file/store.ts —— 展开态与目录缓存同槽（同一个 owner，同一个 reset）
export function fileTreeOwner(projectId: string, rootPath: string): FileTreeOwner;  // owner 唯一铸造点

interface FileStoreState {
  owner: FileTreeOwner | null;
  dirs: Record<DirPath, FileNode[]>;
  loadStates: Record<DirPath, DirLoadState>;
  expandedDirs: Set<DirPath>;            // ← 与 dirs 同槽，owner 跳变时一起作废

  /** 确保展开（幂等）：已展开则只补内容就绪；不翻转 */
  expandDir(owner: FileTreeOwner, dirPath: DirPath, loader: () => Promise<DirTreeResult>): Promise<void>;
  /** 翻转展开态：仅用户点击；收起不动缓存（再展开零请求） */
  toggleDir(owner: FileTreeOwner, dirPath: DirPath, loader: () => Promise<DirTreeResult>): Promise<void>;
  collapseAll(): void;
}

// features/file/hooks/useDirExpansion.ts —— 展开命令层（含 Java 包链视图策略）
interface UseDirExpansionParams {
  owner: string | null;                                    // 无 owner = 无树，动作全部 no-op
  makeLoader: (dirPath: string) => () => Promise<DirTreeResult>;
  readDir?: (dirPath: string) => FileNode[];               // 包链判定探针
}
// 展开的 UI 层唯一入口；包链策略在此叠加，所有触发点共用
export function useDirExpansion(params: UseDirExpansionParams): {
  expandedDirs: Set<DirPath>;
  expandDir(dirPath: string): Promise<void>;
  expandPathParents(filePath: string): Promise<void>;
  handleToggleDir(path: string): Promise<void>;
  collapseAll(): void;
};
```

### 3. Contracts

1. **同槽不变量**：`expandedDirs` 与 `dirs` / `loadStates` 必须同处 `FileStoreState`、同一个 `owner`、
   同一个 `reset()`。任何「展开态放组件态 + 内容放 store」的组合都是 bug 温床 —— 两个坐标系在
   切项目 / 切 worktree 时必然不同步。`ownerSwitchPatch()` 是这条不变量的唯一落地点，
   `loadDir` 与 `expandDir` 共用它，禁止各写一份。
2. **展开即加载**：写入 `expandedDirs` 的同时必须让内容就绪（已 loaded 或在途）。因此展开态
   **只能**经 `store.expandDir` / `store.toggleDir` 写入，禁止外部 `setState` 展开集合。
   加载失败**不上抛**：store 置 `error`（行尾红点可重试），目录保持展开，由用户决定重试还是折叠。
3. **确保展开 ≠ 翻转**：`expandDir` 幂等（已展开不收起），供 `locateFile` / tab 联动 /
   `startCreating` 使用；`toggleDir` 才翻转，仅供行点击。二者不可互相替代。
4. **包链策略在 UI 层单点**：Java「单子目录链压行」是视图策略（与目录数据无关），**不得**下沉进
   通用 store；但所有祖先展开必须走同一个 `useDirExpansion.expandPathParents`，否则不同入口
   会得到不同视图（历史缺陷：定位走包链、联动不走）。
5. **祖先展开只有一个编排点**：`useDirExpansion` **不监听**激活文件。激活文件联动与定位按钮
   同属「展开到某文件」，若两者各自触发展开，同一级目录会被请求两次（见 §6 与常见错误 13）。

### 4. Validation & Error Matrix

| 情况 | 期望行为 | 判据 |
| --- | --- | --- |
| 首次展开未加载的目录 | 展开态 + 内容就绪同时成立 | `expandedDirs.has(p)` 与 `loadStates[p]` 不为 `undefined` 同帧出现 |
| 重复定位同一文件 | 祖先保持展开，不收起 | 连续两次 `locateFile` 后祖先集合不缩小 |
| 单级目录加载失败 | 目录保持展开，标 `error`，行尾红点可重试 | `loadStates[p] === 'error'` 且 `expandedDirs.has(p)` |
| 切项目 / 切 worktree | 展开态与缓存一起作废 | 新 owner 下 `expandedDirs.size === 0` 且旧 `dirs` 键不存在 |
| 收起再展开同一目录 | 零请求（命中缓存） | loader 未被调用 |
| 展开目标同时经两条链路触发 | 每级目录只请求一次 | loader 调用计数每级 = 1 |

### 5. Good/Base/Bad Cases

```ts
// Good：展开态与内容同一次调用建立（唯一入口）
await useFileStore.getState().expandDir(owner, 'src/deep', makeLoader('src/deep'));

// Good：展开到某文件——逐级「确保展开」，包链策略由 expandDir 统一叠加
for (const p of getParentPaths(filePath)) await expandDir(p);

// Bad：只改展开态、不加载（旧 activeFilePath 联动的写法）
setExpandedDirs((prev) => new Set(prev).add(path));   // ← 展开但空白

// Bad：用翻转做「确保展开」——重复定位会把已展开的祖先收起
await store.toggleDir(owner, parent, loader);

// Bad：展开态留在组件态，与按 owner 分槽的缓存各活各的
const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
```

### 6. Tests Required

- `features/file/__tests__/useFileStore.test.ts` —— store 层不变量：展开即加载、收起留缓存、
  owner 跳变丢弃展开态、`expandDir` 幂等 vs `toggleDir` 翻转、失败保留展开态。
- `features/file/hooks/__tests__/UseFilePanelState.test.tsx` —— 编排层：`startCreating` 触发加载、
  重复定位不收起祖先、包链策略在两条入口下结果一致（**目标文件必须落在包链中间**，
  否则父链恰好覆盖包链，两条路径结果相同、测不出分歧）。
- `features/file/components/__tests__/FilesPanelNoDoubleExpand.test.tsx` —— 每级目录恰好请求一次
  （`loadDir` 的幂等只挡「已 loaded」，挡不住两次并发）。
- `app/dock/wrappers/__tests__/FilesPanelWrapper.wiring.test.tsx` —— **生产接线级**：不 mock 面板，
  走真实 Wrapper + 真实 store + 真实 tab 空间，断言 `is_active` 高亮、头部路径与深层祖先加载。
  面板级测试直接注入 props 会绕过接线断链，全绿也掩盖缺陷。

### 7. Wrong vs Correct

| 症状 | 错误归因 | 正确归因 |
| --- | --- | --- |
| 「展开后空白，点两次才好」 | 当成渲染 / 虚拟滚动问题 | 展开态与缓存的坐标系不一致（本场景 §3.1） |
| 「定位后目录反而折叠了」 | 当成展开态计算错 | 用翻转语义实现了「确保展开」（§3.3） |
| 「每级目录请求两次」 | 当成 store 幂等失效 | 有两条链路各自展开同一目标（§3.5） |
| 「切项目后还残留展开」 | 当成 `reset` 没调 | 展开态不在 store 的 owner 槽里（§3.1） |

> 交叉引用：`fileTreeOwner` 作为 owner 唯一铸造点、及「三端加载/刷新同源」见
> [Hook 指南](./hook-guidelines.md) 的文件树加载章节；路径身份判定（红线 12）不在此列 ——
> `owner` 是缓存归属键，不承担「是否同一文件」的判定。

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

### 6. 切换项目/单元不需要（也不得）同步前台 tab —— 已删除的全局 `activeTabId`

**背景（2026-10-15 单源化）**：本条曾经是一道「必须成对恢复」的纪律。它已**整体退役** ——
`editorStore` 的**顶层** `activeTabId` 与按 `tabKey` 分槽的 `ProjectTabs.activeTabId` 两个字段
都已被删除。

**为什么删而不是继续同步**：它们是「哪个 tab 在前台」的**第二份表示**。真源是
`editorLayout[tabKey]`（`groups[activeGroupId].activeTabId`），分屏 / 拖拽重排后两份必然分叉
（拖文件落错 pane、Cmd+W 关错 tab）。让每个「切项目 / 切单元」的写点各自记得刷新缓存
= 约定，而不是构造；字段一删，这个缺陷在**编译期**就不再可表示。

**现在的写法**：

- 前台 = **布局派生**：`selectActiveTabId(state, tabKey)`（React）/ `activeTabIdOf(tabKey)`（命令式），
  均在 `src/shared/store/editorTabSelectors.ts` 的同一定义上。
- 切项目 / 切单元**只写** `projectStore.activeProjectId` 与 `workspaceStore` 的激活态 —— 
  **没有**「同步 editorStore.activeTabId」这一步了（该动作随字段消失而不存在）。
- 需要某项目的当前单元键时，仍走唯一派生点 `activeWorkspaceKeyOf(projectId)` /
  `useActiveWorkspaceKey(projectId)` —— 这个契约不变（切的是键派生，不是前台位）。

```tsx
// src/features/project/hooks/useProjectSelection.ts（真实实现，节选）—— 无需再碰 editorStore
useProjectStore.setState({ activeProjectId: projectId, activeProject: targetProject });
```

**禁止回潮**：`ProjectTabs.activeTabId` / `Tab.order` 不得重新出现在类型定义里（护栏
`check_terminal_foreground_arbitration` 的 A5 判据钉住）。前台/顺序只能从 `editorLayout` 派生，
唯一派生点是 `editorTabSelectors.ts`。

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

**正确模式**：一律经 `closeTabWithConfirmation`（`src/features/editor/store/closeTab.ts`），编排契约见「场景：Tab 关闭入口统一走未保存确认编排」。新增关闭入口时自问：这条路径 dirty 时会弹确认框吗？

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

### 13. 同一份数据放两个坐标系（组件态 + 按 owner 分槽的 store）

**问题**：文件树展开态曾是组件 `useState<Set<dirPath>>`，而目录缓存按 `owner`（项目 + 工作树根）
分槽。切项目 / 切 worktree 时 store 丢弃缓存、组件态跨项目存活，于是新树里出现「chevron 已展开、
子项空白、无 spinner 无红灯」，用户必须再点一次。`store.reset()` 也无法兜底 —— 唯一调用者
`clearFileView` 在生产里没有调用点（死路径）。

**判定准则**：这份状态**是否与某份已按 key 分槽的数据描述同一事实**？
- 是（展开态 ↔ 目录内容，两者的 key 都是 `(owner, dirPath)`）→ 必须放**同一个 store、同一个槽、
  同一个 `reset`**，让「生命周期不同步」在结构上不可表示；
- 否 → 才留在组件态。

**推论**：跨项目存活的组件态只能装「与数据无关的纯 UI 偏好」（如是否显示某列）；一旦它的键需要
和 store 的键对齐，就说明它本来就属于 store。完整契约见「场景：文件树展开态与目录缓存同槽」。

### 14. 一个动作名承载两种意图（确保态 vs 翻转态）

**问题**：文件树的 `onExpandDir` 同时被「用户点击行」（语义是翻转）与「定位到文件 / tab 联动 /
新建文件」（语义是**确保展开**）使用。后者重复触发时会把已展开的祖先收起 —— 表现为「点定位按钮
反而把目录折叠了」。

**判定准则**：写状态前先问「调用方要的是**确保处于某态**还是**切换到另一态**？」
- 确保（幂等，目标态 = 参数态）→ 独立命名（`expandDir` / `ensure*` / `activate`），对已是目标态
  的输入必须 no-op；
- 翻转（目标态 = 当前态取反）→ 独立命名（`toggleDir` / `toggle*`），且只允许绑定到**用户显式动作**。

**禁止**：让命令式翻转函数兼任幂等确保 —— 二者的错误行为正好互补（前者收起不该收的，
后者永不响应重复点击）。文件树侧的落地形态是 `store.expandDir`（确保）与 `store.toggleDir`
（翻转），仅后者可在行点击里调用。

---

## 场景：Agent 配置单源化 2026-10-23

> 与上面 Project/File 那次同源：**为「响应快」另存的第二份副本，最终都会与真相漂移。**

### 1. Scope / Trigger

- Trigger：给 agent 配置加字段、改「设置页 ↔ 终端」的数据流、看到 `agentOverrides` / `agentCommandOverrides`。
- Scope：`src/shared/store/agentStore.ts`、`src/features/agent/api/agentApi.ts`、
  `src/features/settings/components/`、`src/features/terminal/components/`。

### 2. 唯一的真相与唯一的缓存

```
后端 AgentManager（唯一真相：出厂定义 + ~/.neeko/config.json 的 agentOverrides 合并结果）
      ↓ list_agents
前端 agentStore（唯一缓存，只读）
      ↓
设置页 / 终端 / Skill 页 / 项目设置
```

`agentStore.agents` 是 `AgentConfig[] | null`：`null` = 未加载，`[]` = 后端确实没有。
`byId` **同步**（终端在 PTY 回调里调它，不能 await），未命中返回 `undefined` ——
调用方据此**不启动** agent，而不是猜一个命令。

### 3. 写路径只有两个出口

```ts
// src/features/agent/api/agentApi.ts
saveAgent(agent)      // invoke('add_agent') → agentStore.refresh()
resetAgent(agentId)   // invoke('remove_agent') → agentStore.refresh()
```

顺序不可交换：先刷新会读到旧值（界面短暂回退），落盘失败也刷新会掩盖失败。
刷新点放在 API 层而不是调用方 —— 调用方有 5 个，让每个都记得刷新就是重演
「同步点分散」的原始错误。

### 4. 被删除的两份副本（不得复活）

| 已删 | 曾是 | 症状 |
| --- | --- | --- |
| `config.agentCommandOverrides` | 终端读的唯一来源 | 设置页保存只更新另外两份 ⇒ 终端跑旧命令 |
| 双击命令行行内编辑 | 只写前端 config | 完全不落盘，重启即丢 |
| `getEffectiveAgentCommand` / `saveAgentOverride` / `startEditAgent` | 维护副本与后端的同步 | 副本没了，它们失去意义 |

`config.agentOverrides` **保留但降级为键集合**：后端没有「某内置 agent 是否被覆盖」
字段，Reset 按钮需要它。**不要从它的 value 里读任何配置字段。**

### 5. 三条不变量（`agentStore`）

| 不变量 | 解决的问题 |
| --- | --- |
| **幂等加载** `ensure()` | 任意消费方都可调、只请求一次 ⇒ **不需要副本** |
| **generation 守卫** | 乱序响应不覆盖新快照（同 git status 方案） |
| **失败不清空** | 瞬时 IPC 故障不丢全部 agent |

另有 `resolveAgent(id)`：缓存为空时**先等一次加载再取**。终端在 PTY 就绪回调里用它，
而不是直接查快照 —— 启动期会话恢复可能早于 preload 完成，直查会把「还没加载」
误判成「不存在」，用户得到空终端。

### 5b. `chat` 是出厂事实，`chat_enabled` 是用户偏好（2026-10-23）

| 字段 | 谁拥有 | 内置 agent 可否覆盖 | 语义 |
| --- | --- | --- | --- |
| `AgentConfig.chat` | 出厂定义（`builtin/providers.rs`） | **否** | 协议 + 参数（`ChatLaunch`） |
| `AgentConfig.chat_enabled` | 用户 | 是 | `Some(false)` = 关掉；`None` = 跟随出厂 |

**判据只有一处**：`isChatEnabled(agent)`（`shared/types/agent.ts`），镜像后端
`AgentConfig::is_chat_agent()`：

```ts
Boolean(agent.chat) && agent.chat_enabled !== false
```

禁止再写 `Boolean(agent.chat)` —— 那会把用户主动关闭的 agent 当成可用，于是列表里
那一项看起来完全正常，选中后 `adapter_for` 才报错。

消费点（全部必须走 `isChatEnabled`）：`agentCapabilities()`、`isTranslatableAgent()`、
`useChatAgents()`、`CapabilityBadges` 的 `Pick<…>` 必须包含 `chat_enabled`
（漏了读不到该字段 ⇒ 关掉的 chat 仍显示为可用）。

#### 三态禁止压成 boolean

表单态 `chatEnabled: 'default' | 'on' | 'off'`。压成 `boolean` 会让 `undefined`
（跟随默认）在第一次保存后变成 `true`，此后出厂默认的任何变化**永远追不上**
（反向的「旧快照回滚出厂升级」）。

#### `useChatAgents` 必须订阅 `agentStore`

```ts
// ✅
const all = useAgentStore((s) => s.agents);
const chatAgents = useMemo(() => (all ?? []).filter(isChatEnabled), [all]);

// ❌ 空依赖 effect + 独立 useState：保存后列表不刷新
useEffect(() => { void listChatAgents().then(setChatAgents); }, []);
```

旧写法只在挂载时拉一次快照，`saveAgent()` 的 refresh 打不到它 —— 用户关掉某 agent 的
chat 后下拉仍是旧的，选中才报错。

#### 内置 agent 的表单提交必须带回出厂 `chat`

表单态里的 argv 是**投影**（`formatChatLaunch` 会把 `command` 填进 `program`）。
用投影值提交会把 `{program: None}` 改写成 `{program: Some(command)}` ——
「沿用 command」变成「显式指定」，出厂升级不再跟随，**而界面上看不出来**。

```ts
chat: initial?.is_builtin ? (initial.chat ?? null) : builtChat,
```

护栏：`AgentForm.builtinChat.test.tsx` 的
`carries the factory chat through unchanged (program stays None)`（已做变异验证）。

### 6. 护栏（机器门禁，不靠 review）

**`check_agent_config_single_source`**（`tools/guards/checks/`，29 条护栏之一）三条判据：

| 判据 | 违规后果 |
| --- | --- |
| `src/` 无 `agentCommandOverrides` / `agentOverrides` 标识符 | 副本复活 ⇒ 多份真相 |
| 只有 `features/agent/api/agentApi.ts` 可 `invoke('add_agent'/'remove_agent')` | 绕过 `saveAgent` ⇒ 缓存不刷新、界面停留旧值 |
| 终端文件必须用 `resolveAgent`，不得 `getState().byId(...)` | 「尚未加载」被当成「不存在」⇒ 空终端 |

护栏自测 11 条（`tools/guards/tests/test_check_agent_config_single_source.py`），
三条判据**都做过真实仓库变异验证**（改回旧写法 → guard 变红）。

单元测试侧的对应覆盖：

| 测试 | 断言 |
| --- | --- |
| `shared/store/__tests__/agentStore.test.ts` | 初值 `null`（不是 `[]`）；**陈旧响应被丢弃**；`ensure` 并发只请求一次；失败保留上次快照 |
| `features/agent/api/__tests__/agentApi.save.test.ts` | 落盘**后**才刷新；失败不刷新；内置 `is_builtin` 保留 |

**为什么判据必须落在源码上**：这类漂移的运行时表现是「某个值没更新」，而各份副本
各自的单元测试永远会通过。实测两处事故（见上表）行为测试一次都没抓到。

### 6. 依赖方向（`shared/` 不得依赖 `features/`）

`agentStore` 需要 `list_agents`，而 `agentApi` 需要 `agentStore` 做写后刷新 —— 直接互相
import 会成环（`import/no-cycle`）。解法是**注入**：`agentApi` 在模块加载时调
`useAgentStore.getState().setLoader(listAgents)`，依赖方向单向（features → shared）。

`shared/` 也不能直接 `invoke`（`no-restricted-imports` 禁止绕过 API 层）。

---

## 场景：live-sessions 注册表快照 vs 视图派生 2026-10-31

会话的**状态与标题**由后端 `live_sessions::Registry` 唯一持有。前端只有一份**只读快照**，
其余全部是渲染期派生 —— 三层职责不能混：

| 层 | 位置 | 允许做什么 | 禁止 |
| --- | --- | --- | --- |
| 快照 | `shared/store/liveSessionsStore.ts` | `apply(snapshot)` / 版本与 hydrate 时刻 | 派生、排序、按单元过滤、改标题 |
| 派生 | `shared/selectors/liveSessionSelectors.ts` + `features/editor/utils/tabTitle.ts` | `sessionsByUnit` / `dominantState` / `isSameSession` / `tabSession` / `sessionTab` / `resolveTabTitle` | 写 store、发 IPC、缓存结果到模块级变量 |
| 订阅 | `shared/hooks/useSessionsByUnit.ts` / `useNowTick.ts` | 把快照折成「一次 O(n) 分组」「一个时钟」 | 按行重扫全表、每行各起一个定时器 |
| 渲染 | `SessionStatusIcon` / `SessionList` / `TabItem` | 按入参渲染 | 自己推断状态 |

**为什么快照层不做单元分组**：一次快照要同时服务三种视图（侧栏按单元、tab 标题、连接页），
各视图的分组口径不同（侧栏要「每单元全部会话」，tab 要「这条 tab 的会话」）。把分组塞进
store 会让「另一种分组」要么复制一份、要么原地改 store —— 两条路都造第二份真相。
`apply` 只做一件事：**版本更旧的回包丢弃**（乱序 / 延迟回包不得打断正在展示的新快照，
`liveSessionsStore.test.ts`）。

**为什么标题不写回 tab store**：`tab.title` 是创建期 / 用户改名的兜底值，注册表是后到且
更强的事实。写回会让「用户改名后 tab 显示旧值」「同一事实两份表示」同时回来。因此
`resolveTabTitle(tab, session)` 在**渲染期**取会话标题、兜底 `tab.title`，纯函数、不修改入参
（`tabTitle.test.ts::纯函数：同一输入两次结果相同，且不修改入参`）。

**`TerminalTabData.status` 已删除**：视图不再持有状态副本。它唯一的历史作用是「图标数据源」，
但全仓没有读者、唯一写入点在已挂载的终端组件里 —— 留着就是「看起来在同步、实际冻结」的诱饵。
图标只许读 `dominantState(byUnit.get(workspaceKey) ?? NO_SESSIONS)`（`awaitingApproval > running >
failed > ready > stopped`），**无会话返回 `null` 且不渲染状态点**（不是灰点：灰点会被读成
「已知且空闲」）。

**分组只有一个实现**：`sessionsByUnit`（纯函数，O(n) 一次分组）+ `useSessionsByUnit`（订阅 store
并 memo 住那份 Map）。侧栏每个项目行 / worktree 行 / 会话子列表都用它 —— 曾经的
`sessionsOfUnit(list, key)` 让每个项目行各扫一遍全表（N 单元 × M 会话），且与后端
`UnitScope` 形成两套「这个会话属于哪个单元」的判据（后端那套已删除，见
`agent-chat-transports.md` §0.2）。

**同一会话的判据只有 `isSameSession`**：`kind` + `sessionId` 必须同时相等。`tabSession` /
`sessionTab` / 会话行高亮全部走它；只比裸 `sessionId` 是第二套判据（chat 与 terminal 的 id
空间互不相干，串线的表现只是「点错 tab / 高亮错行」，极难定位）。

**相对时间必须有节拍**：`formatRelativeTime(iso, now)` 是 `now` 的函数，而快照不变时组件不会
重渲染 —— 没有 `useNowTick` 的话，一个空闲会话会永远停在「刚刚」。一个列表挂**一个**定时器
（10s，小于最小标签粒度），把 `now` 传给每一行。

**映射只有一张表**：`SessionStatusIcon` 的 `STATUS_VISUAL` 常量表是状态→视觉的唯一实现；
`running` 额外带呼吸动画（第二个通道），其余状态不带（`SessionStatusIcon.test.tsx` 穷举五态 +
空态）。

**标题来源（`TitleSource`）不进 UI**：它只决定「谁能覆盖谁」（后端 `title::should_upgrade`），
界面只表达结果。展示它等于把内部优先级暴露成用户概念，且会诱导前端复刻升级规则。

**选中态只出现在最具体的一层**（`row-current`，`styles/base/tailwind.css` 的 `@utility`）：
会话行用强调色 12% 淡底（单通道 —— 左侧 2px 色条已按 2026-11-02 反馈去掉：它和行内的
agent 图标挤在同一段左内边距上，读起来像错位的装饰块）；父级（单元行）在
**它里面有会话被选中时不再填充**，只保留文字语气，否则才用中性 `--bg-selected`。
判据来源是一份共享的 refs：`useActiveSessionRefs`（`shared/hooks/`）订阅 `activeProjectId`
+ `useActiveWorkspaceKey` + 稳定的 `tabs` / `editorLayout` 切片，只让 `selectActiveSessionRefs`
派生**当前单元**的中心前台与各 dock 宿主前台（`workspaceKey + kind + sessionId`）；
`useUnitsWithActiveSession`（父行）与 `UnitSessionList`（子行 `activeSession`）都消费这一份，
父行侧再经 `unitsWithListedActiveSession` 与 live 快照求交（未列出 / 未输入的会话不让父行
失去选中态）。父行只在子列表**实际展开**时让出填充，折叠时仍保留中性选中底（`SessionList` 的
`effectiveVisibleCount` 保证当前会话不会被分页藏起来）。图标方块**不再叠第二层底色** ——
同一个选中被强调两次，是「别扭」的第二个来源。

**「当前」只有一个派生点（R8，2026-11-05）**：`editorLayout[tabKey].activeTabId` 是**按单元
分槽**的局部状态（切回来要恢复上次前台 tab，是正确的恢复语义），不是全局「当前」。早期
`selectActiveSessionRefs` 遍历 `Object.keys(tabs)` 的全部单元，且 `UnitSessionList` 自己读本单元
的 `activeTabId` ⇒ 切项目 / 切 worktree 后旧单元仍亮着，多个项目各有一行 `row-current`。
修复形态：`selectActiveSessionRefs(state, workspaceKey)` 收窄为**单 tab 空间**（`null` ⇒ `[]`），
候选顺序固定为「中心前台 → `DOCK_SLOTS` 各宿主前台」；key 只由
`useActiveWorkspaceKey(activeProjectId)` 注入；两处消费共用 `useActiveSessionRefs`。
**禁止**在每个组件里各写一遍 `workspaceKey === activeKey`（第二份判据），也禁止为此新建
全局「当前会话」store（影子状态，红线 17）。停靠到 dock 宿主的会话同样进 refs，所以父子
两层同源；若中心前台与 dock 前台是两条不同会话，`UnitSessionList` 按 **refs 顺序**取第一条
（中心优先），不让后端快照顺序决定「哪一行亮」。

**侧栏只列「用户已经用过、且有名字」的会话**（`isListedSession` = `has_user_input` && `isNamedSession`）。
`has_user_input` 由后端在**用户发出第一条输入**时翻转（chat 的首次 `agent_stream`——含
`agent_chat_open` 静默会话被用起来的那一步，见 `.trellis/spec/backend/agent-chat-transports.md`
「五个写入原语」/ 终端用户提交 / CLI 的 hook 上报），**打开 tab 不翻转** —— 一创建 tab
就冒出会话正是要消灭的形态。
两个条件各挡一类假会话（2026-10-31 第三、四轮反馈）：

1. **`has_user_input`（用户输入过）** —— 打开 agent tab 就会创建 PTY / 静默会话，而且 agent CLI 常常
   一启动就自己发 OSC 标题。只看标题的话，侧栏会在用户还没敲一个字时冒出条目；Codex 那类
   桌面端也是「发出第一条消息才建会话」。首条终端输入 / 首次 `agent_stream` 才置位。
2. **`isNamedSession`（标题非占位且非空白）** —— 用户敲了东西但还没有标题时（纯 shell 不设
   OSC 标题），列出来只是一行没有文字的图标；标题一到它自己出现。

单元角标与子列表同源（`sessionsByUnit` 是唯一分组入口，过滤在那里做），不会一个有一个没有。

**tab 同样以 `has_user_input` 为门**：`resolveTabTitle(tab, session)` 只在会话已可见时才用注册表
标题 —— 否则会出现「tab 已经改名、侧栏还没这条会话」的错觉。tab 的占位标题是
**agent 名**（绑 agent 的 tab：`agent.name`）或 `Terminal N`（空白终端：
`shared/utils/terminalTabTitle.ts`，两个建 tab 入口共用）。一旦会话有真标题，tab 标题在渲染期
换成它 —— 不写回 `tab.title`，否则用户改名后 tab 会显示旧值。

会话子列表**不画左侧竖线**，层级只靠缩进（`ml-7` 让会话图标对齐单元标签）——
窄侧栏里那条线是持续噪声。

**终端标题只从用户输入上行、不回读 OSC**：`createUserInputActivityReporter` 在每次提交时
经薄命令 `set_live_session_title(source = prompt)` 上报（支持 bracketed paste，过滤协议应答 /
转义键）。首次非空行才成为标题，后续提交只清权威门；升级判定在后端，前端不预判 —— 否则
「后续输入不得覆盖用户改名」会出现两份规则。

**跨栈常量**：`SESSIONS_EVENT` 前端值必须与 `src-tauri/src/live_sessions/events.rs` 的声明
**逐字相等**（`shared/__tests__/sessionsEventConstant.test.ts` 读后端源码取声明值比较，
不是断言子串出现过），且不得与 `AGENT_CHAT_EVENT` / `TRANSLATION_EVENT` 撞名 ——
值相等挡不住「两端一起抄错」。

**hook 未生效：侧栏不再提示（2026-11-03 定案）**：会话标题的权威来源是 CLI hook 上报，
hook 未安装 / 过期 / 未受信时那一路**静默失效**。此前侧栏底部有 `CliHookHint`
（「会话标题未跟随 CLI」+ 重新安装）与它背后的 `useCliHookHealth` / `hookRowsNeedingAttention`；
用户判定那条常驻提示条本身就是噪声，已**整体删除**（组件 / hook / 判据函数 / 测试一并移除，
不留无人消费的抽象）。可见性回到**设置页**：`settings/components/CliHooksSection` 的
安装状态列 + 「重新安装」仍用 `shared/utils/agentHookSources.ts` 的同一套判据
（`installableHookRows` / `readSourceOverrides` / `isHookSourceEnabled`）。
要恢复侧栏提示时，从 git 历史取回两段：`hookRowsNeedingAttention`（三道过滤：自供源 /
本机没装该 CLI / 用户主动关掉）+ 那个 hook 里的 fail-soft 探针（探测失败降级为不提示）。
不要重写一份。

**单元会话列表的展开与分页**：新会话出现（`childCount` 增长）时该单元**自动展开** ——
基线取 0，所以面板重挂载时「本来就有会话」也算一次出现；条数不变则尊重用户的手动折叠
（否则每次快照刷新都会把它重新弹开）。分页按 **10 条一页**：`SessionList` 只渲染
`visibleCount` 条，「显示更多」每次再加一页（不是一次全放开）；条数增长时回到第一页 ——
新会话在后端已按开始时间倒序排在最前，不重置会让用户看不到刚出现的那条。

---

## 场景：tab 制造端口与 tab data 字段表 2026-11-02

### 1. Scope / Trigger

新增或修改任何「创建 editor tab」的入口（侧栏会话行、Action Menu、项目引导页、
Histor 恢复、终端 taskCommand）时触发。**禁止手造 `Tab`**：`id` 铸造、`scope` 构造、
占位标题、配额与「创建即激活」都有唯一入口。

### 2. Signatures

```ts
// 终端 tab（features/terminal/api/taskTerminal.ts）
createTerminalTabIn(workspace: WorkspaceSession, opts: TaskTerminalOptions): boolean;
createTaskTerminal(projectId: ProjectId, opts: { taskCommand: string } & TaskTerminalOptions): boolean;

// agent-chat tab（features/agent-chat/api/openChatTab.ts）
openAgentChatTab(workspace: WorkspaceSession, opts?: OpenChatTabOptions): string;

// 配额上限（唯一数字，shared 里，因为 editorStore 也要用）
// src/shared/utils/terminalTabTitle.ts
export const MAX_TERMINAL_TABS = 10;
```

### 3. Contracts

- **配额**：`editorStore.addTab` 是硬门；端口用同一个常量产出 `false` 给调用方决定是否提示。
  数字只允许出现在 `shared/utils/terminalTabTitle.ts` —— 放在 features 里 store 取不到
  （防火墙禁止 store → features），历史上的字面量副本就是这样长出来的。
- **键从 tab 自身推导**：`addTab` 用 `tabSpaceKeyOf(tab.scope)` 落键，端口用
  `workspace.key` 激活。**不要**把 `projectId` 当 tab 空间键传（活跃单元是 linked worktree 时
  会激活到另一个空间，表现是「切了 tab 但视图不动」）。
- **占位标题**：agent 名 → agentId → `Terminal N`；真标题由 `resolveTabTitle` 在渲染期覆盖，
  不写回 store。
- **端口只决定身份**：调用方传「哪个单元 / 接谁 / 跑什么」，不传 `kind`、不传 `id`。
  `openAgentChatTab` 的 `data` 补丁里 `kind` 会被端口覆盖。

### 4. tab data 合并（`editorStore.mergeTabData`）

字段表是**唯一登记点**，类型是 `Record<Exclude<keyof X, 'kind'>, MergeRule>`：
加字段不登记 = **编译错误**（此前是静默 no-op：`updateTab` 看起来成功、读回来还是旧值）。

| 规则 | 语义 | 使用者 |
| --- | --- | --- |
| `keep` | `undefined` 读作「这次不更新」 | `terminal`（挂载键 / 恢复标记） |
| `clear` | 显式 `undefined` 也是写入（清除） | `agent-chat`（切 agent 丢模型、恢复标记一次性消费） |

`file` 混用两种规则（必填字段 keep、可选字段 clear），尚未纳入字段表 —— 改它要逐字段给 rule。

### 5. Tests Required

- 端口：`agent-chat/api/__tests__/openChatTab.test.ts`（id 唯一 / scope / 标题 / data 透传 /
  `kind` 不可覆盖）；`terminal/api/__tests__/taskTerminal.test.ts`（配额）。
- 合并语义两侧都要钉住：`editorStore.test.ts` 的「agent-chat 字段落盘（clear）」与
  「terminal 字段（keep）」两组。
- 端到端：`live-sessions/components/__tests__/UnitSessionList.test.tsx`（点击会话行 ⇒
  接回 / 续写 / 重建）。
