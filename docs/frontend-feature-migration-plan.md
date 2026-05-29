# 前端 Feature-Based 架构迁移方案

> 生成日期：2026-05-29
> 分支：`refactor/architecture-optimization`
> 前置：Rust 后端域模块重构已完成（commit `496b000`）

---

## 一、背景与动机

当前前端代码组织为扁平结构：

- `src/hooks/` — 34 个 hooks 平铺
- `src/store/` — 11 个全局 Zustand store
- `src/types/` — 16 个类型文件
- `src/contexts/` — 8 个 Context Provider
- `src/components/` — 16 个子目录 + 5 个散落文件

核心痛点：

1. **`useAppContainer.ts`** 515 行，协调 24 个 hooks，是全局耦合枢纽
2. 文件归属不清 — 找一个功能需要同时翻 hooks/、store/、types/、contexts/、components/ 五个目录
3. Feature 间隐式依赖 — `taskStore` 直接 import `projectStore` + `editorStore`
4. 新功能开发缺乏领域边界指引

---

## 二、设计原则

| 编号 | 原则 | 说明 |
|------|------|------|
| P1 | **Feature 严格隔离** | `features/A/` 不得直接 import `features/B/` 的内部模块 |
| P2 | **跨 feature 通过 shared/** | 跨域数据共享仅通过 `shared/` 层的 store、types 或 `app/` 层注入 |
| P3 | **目录即边界** | 每个 feature 的 `index.ts` 是对外唯一公共 API |
| P4 | **仅迁移不重构** | 第一阶段只做目录迁移 + import 更新，不改变运行时逻辑 |
| P5 | **渐进兼容** | 旧位置保留 barrel re-export，迁移全部完成后统一删除 |
| P6 | **每批必须通过验证** | `pnpm type-check` + `pnpm lint` 必须零错误 |

---

## 三、目标结构

```
src/
├── app/                          # 应用壳层（启动、路由、顶层组合）
│   ├── App.tsx
│   ├── AppModals.tsx
│   ├── AppProviders.tsx
│   ├── main.tsx
│   ├── hooks/
│   │   └── useAppShell.ts        # useAppContainer 的精简替代
│   └── vite-env.d.ts
│
├── features/                     # 业务域（严格隔离）
│   ├── project/                  # 项目管理
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── store.ts              # projectStore + worktreeStore
│   │   ├── types.ts
│   │   ├── context.tsx           # project-actions-context
│   │   └── index.ts
│   │
│   ├── connection/               # WSL + SSH Remote 连接
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── store.ts              # connectionStore
│   │   ├── types.ts
│   │   ├── contexts/             # wsl-context + remote-context
│   │   └── index.ts
│   │
│   ├── git/                      # Git 操作 + Diff + Log
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── store.ts              # gitStore
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── terminal/                 # 终端会话
│   │   ├── components/
│   │   ├── strategies/
│   │   ├── hooks/
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── editor/                   # 文件编辑 + Tab 管理
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── store.ts              # editorStore
│   │   ├── types.ts
│   │   ├── context.tsx           # editor-context + file-actions-context
│   │   └── index.ts
│   │
│   ├── file/                     # 文件树 + 文件浏览
│   │   ├── components/
│   │   ├── store.ts              # fileStore
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── agent/                    # AI Agent 配置 + 操作
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── skill/                    # Skill 管理 + Marketplace
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── store.ts              # skillStore
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── task/                     # Task Runner
│   │   ├── components/
│   │   ├── store.ts              # taskStore
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── browser/                  # 内嵌浏览器
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── store.ts              # browserStore
│   │   └── index.ts
│   │
│   ├── settings/                 # 设置面板
│   │   ├── components/
│   │   ├── hooks/
│   │   └── index.ts
│   │
│   └── session/                  # 会话引导 + 持久化
│       ├── hooks/
│       ├── types.ts
│       └── index.ts
│
├── layout/                       # 布局骨架（无业务逻辑）
│   ├── TitleBar.tsx
│   ├── TitleBarBranchSwitcher.tsx
│   ├── AppLayout.tsx
│   ├── PanelArea.tsx
│   ├── RightPanel.tsx
│   ├── ActivityBar.tsx
│   ├── OpenIdeButton.tsx
│   ├── WindowControls.tsx
│   ├── DockLayout/               # Dock 系统
│   │   ├── DockBar.tsx
│   │   ├── DockBarButton.tsx
│   │   ├── DockLayout.tsx
│   │   ├── DockPanelWrappers.tsx
│   │   ├── DockZone.tsx
│   │   ├── DockZoneTabs.tsx
│   │   ├── useDragToReDock.ts
│   │   └── index.ts
│   ├── dockPanels.ts             # 面板注册表（从 registries/ 移入）
│   └── index.ts
│
├── shared/                       # 跨 feature 共享层
│   ├── store/
│   │   ├── appViewStore.ts       # 顶层视图状态（normal/skills/settings）
│   │   └── dockStore.ts          # Dock 面板布局状态
│   ├── hooks/
│   │   ├── useKeyboardShortcuts.ts
│   │   └── useToast.ts
│   ├── types/
│   │   ├── app.ts
│   │   ├── adapter.ts
│   │   └── index.ts
│   ├── contexts/
│   │   ├── app-context.tsx
│   │   └── sidebar-context.tsx
│   ├── components/
│   │   ├── icons/
│   │   │   └── index.tsx
│   │   └── BranchDropdownContent.tsx
│   └── utils/                    # 纯工具函数（从 src/utils/ 移入）
│
├── ui/                           # shadcn/基础 UI 组件
│   ├── badge.tsx
│   ├── button.tsx
│   ├── card.tsx
│   ├── checkbox.tsx
│   ├── context-menu.tsx
│   ├── dialog.tsx
│   ├── dropdown-menu.tsx
│   ├── input.tsx
│   ├── MarkdownPreview.tsx
│   ├── resizable-panel.tsx
│   ├── resizable.tsx
│   ├── scroll-area.tsx
│   ├── select.tsx
│   ├── separator.tsx
│   ├── sidebar.tsx
│   ├── switch.tsx
│   ├── tabs.tsx
│   ├── toggle-group.tsx
│   ├── tooltip.tsx
│   └── index.ts
│
├── lib/                          # 第三方库封装（保持原位）
├── styles/                       # 全局样式（保持原位）
├── assets/                       # 静态资源（保持原位）
└── testing/                      # 测试基础设施（保持原位）
```

---

## 四、文件映射表

### 4.1 Features 分配

#### project

| 来源 | 目标 |
|------|------|
| `components/project/*` | `features/project/components/` |
| `components/panels/ProjectsPanel.tsx` | `features/project/components/` |
| `hooks/useLocalProjects.ts` | `features/project/hooks/` |
| `hooks/useUnifiedProjectList.ts` | `features/project/hooks/` |
| `hooks/useProjectSelection.ts` | `features/project/hooks/` |
| `hooks/useCrossTypeSelection.ts` | `features/project/hooks/` |
| `hooks/useWorktreeActions.ts` | `features/project/hooks/` |
| `hooks/useWorktreeState.ts` | `features/project/hooks/` |
| `store/projectStore.ts` | `features/project/store.ts`（合并导出） |
| `store/worktreeStore.ts` | `features/project/worktreeStore.ts` |
| `types/project.ts` | `features/project/types.ts` |
| `types/activeProject.ts` | `features/project/types.ts`（合并） |
| `contexts/project-actions-context.tsx` | `features/project/context.tsx` |

#### connection

| 来源 | 目标 |
|------|------|
| `components/connections/*` | `features/connection/components/` |
| `hooks/useWslProjects.ts` | `features/connection/hooks/` |
| `hooks/useWslActions.ts` | `features/connection/hooks/` |
| `hooks/useRemoteProjects.ts` | `features/connection/hooks/` |
| `hooks/useRemoteActions.ts` | `features/connection/hooks/` |
| `hooks/useRemoteAuthActions.ts` | `features/connection/hooks/` |
| `store/connectionStore.ts` | `features/connection/store.ts` |
| `types/connection.ts` | `features/connection/types.ts` |
| `contexts/wsl-context.tsx` | `features/connection/contexts/` |
| `contexts/remote-context.tsx` | `features/connection/contexts/` |

#### git

| 来源 | 目标 |
|------|------|
| `components/diff/*` | `features/git/components/diff/` |
| `components/gitlog/*` | `features/git/components/gitlog/` |
| `components/project/GitCommitPanel.tsx` | `features/git/components/` |
| `components/project/BranchInfo.tsx` | `features/git/components/` |
| `components/project/ChangesList.tsx` | `features/git/components/` |
| `components/project/CommitForm.tsx` | `features/git/components/` |
| `components/project/CommitDialog.tsx` | `features/git/components/` |
| `components/project/GitDialog.tsx` | `features/git/components/` |
| `components/project/PullRequestsPanel.tsx` | `features/git/components/` |
| `hooks/useAheadBehindSync.ts` | `features/git/hooks/` |
| `hooks/useFileChangedEvent.ts` | `features/git/hooks/` |
| `store/gitStore.ts` | `features/git/store.ts` |
| `types/git.ts` | `features/git/types.ts` |

#### terminal

| 来源 | 目标 |
|------|------|
| `components/terminal/*`（含 strategies/） | `features/terminal/` |
| `hooks/useTerminalTabs.ts` | `features/terminal/hooks/` |
| `types/terminal.ts` | `features/terminal/types.ts` |

#### editor

| 来源 | 目标 |
|------|------|
| `components/files/FileViewer.tsx` | `features/editor/components/` |
| `components/files/HtmlPreview.tsx` | `features/editor/components/` |
| `components/files/InlineHtmlPreview.tsx` | `features/editor/components/` |
| `components/layout/EditorGroupLayout.tsx` | `features/editor/components/` |
| `components/layout/EditorGroupPane.tsx` | `features/editor/components/` |
| `components/layout/UnifiedTabBar.tsx` | `features/editor/components/` |
| `components/layout/UnifiedTabItem.tsx` | `features/editor/components/` |
| `hooks/useFileView.ts` | `features/editor/hooks/` |
| `hooks/useFileTabRefresh.ts` | `features/editor/hooks/` |
| `hooks/useTabManagement.ts` | `features/editor/hooks/` |
| `hooks/useEditorGroupLayout.ts` | `features/editor/hooks/` |
| `hooks/useSplitLayout.ts` | `features/editor/hooks/` |
| `store/editorStore.ts` | `features/editor/store.ts` |
| `types/tab.ts` | `features/editor/types.ts`（合并） |
| `types/editorGroup.ts` | `features/editor/types.ts`（合并） |
| `types/split.ts` | `features/editor/types.ts`（合并） |
| `contexts/editor-context.tsx` | `features/editor/context.tsx` |
| `contexts/file-actions-context.tsx` | `features/editor/context.tsx`（合并） |

#### file

| 来源 | 目标 |
|------|------|
| `components/files/FileTree.tsx` | `features/file/components/` |
| `components/files/index.ts` | `features/file/index.ts`（重写） |
| `components/panels/FilesPanel.tsx` | `features/file/components/` |
| `store/fileStore.ts` | `features/file/store.ts` |
| `types/file.ts` | `features/file/types.ts` |

#### agent

| 来源 | 目标 |
|------|------|
| `components/layout/AgentBar.tsx` | `features/agent/components/` |
| `components/layout/AgentIcon.tsx` | `features/agent/components/` |
| `components/layout/AgentSelector.tsx` | `features/agent/components/` |
| `hooks/useAgentActions.ts` | `features/agent/hooks/` |
| `hooks/useAgentClickHandler.ts` | `features/agent/hooks/` |
| `types/agent.ts` | `features/agent/types.ts` |

#### skill

| 来源 | 目标 |
|------|------|
| `components/skills/*` | `features/skill/components/` |
| `hooks/useMarketplace.ts` | `features/skill/hooks/` |
| `store/skillStore.ts` | `features/skill/store.ts` |
| `types/skill.ts` | `features/skill/types.ts` |

#### task

| 来源 | 目标 |
|------|------|
| `components/layout/TaskDialog.tsx` | `features/task/components/` |
| `components/layout/TaskRunButton.tsx` | `features/task/components/` |
| `store/taskStore.ts` | `features/task/store.ts` |
| `types/task.ts` | `features/task/types.ts` |

#### browser

| 来源 | 目标 |
|------|------|
| `components/browser/*` | `features/browser/components/` |
| `hooks/useBrowserPanel.ts` | `features/browser/hooks/` |
| `hooks/useBrowserPicker.ts` | `features/browser/hooks/` |
| `hooks/useBrowserConstants.ts` | `features/browser/hooks/` |
| `store/browserStore.ts` | `features/browser/store.ts` |

#### settings

| 来源 | 目标 |
|------|------|
| `components/settings/*` | `features/settings/components/` |
| `hooks/useAppConfig.ts` | `features/settings/hooks/` |
| `components/SettingsPanel.tsx` | 删除（已在 settings/ 内） |

#### session

| 来源 | 目标 |
|------|------|
| `hooks/useSessionBootstrap.ts` | `features/session/hooks/` |
| `hooks/useSessionPersistence.ts` | `features/session/hooks/` |
| `types/session.ts` | `features/session/types.ts` |

### 4.2 Shared 层

| 来源 | 目标 |
|------|------|
| `store/appViewStore.ts` | `shared/store/appViewStore.ts` |
| `store/dockStore.ts` | `shared/store/dockStore.ts` |
| `hooks/useKeyboardShortcuts.ts` | `shared/hooks/useKeyboardShortcuts.ts` |
| `hooks/useToast.ts` | `shared/hooks/useToast.ts` |
| `types/app.ts` | `shared/types/app.ts` |
| `types/adapter.ts` | `shared/types/adapter.ts` |
| `contexts/app-context.tsx` | `shared/contexts/app-context.tsx` |
| `contexts/sidebar-context.tsx` | `shared/contexts/sidebar-context.tsx` |
| `components/shared/BranchDropdownContent.tsx` | `shared/components/BranchDropdownContent.tsx` |
| `components/icons/` | `shared/components/icons/` |
| `utils/*` | `shared/utils/` |

### 4.3 Layout 层

| 来源 | 目标 |
|------|------|
| `components/layout/TitleBar.tsx` | `layout/TitleBar.tsx` |
| `components/layout/TitleBarBranchSwitcher.tsx` | `layout/TitleBarBranchSwitcher.tsx` |
| `components/layout/AppLayout.tsx` | `layout/AppLayout.tsx` |
| `components/layout/PanelArea.tsx` | `layout/PanelArea.tsx` |
| `components/layout/RightPanel.tsx` | `layout/RightPanel.tsx` |
| `components/layout/ActivityBar.tsx` | `layout/ActivityBar.tsx` |
| `components/layout/OpenIdeButton.tsx` | `layout/OpenIdeButton.tsx` |
| `components/layout/WindowControls.tsx` | `layout/WindowControls.tsx` |
| `components/dock/*` | `layout/DockLayout/` |
| `registries/dockPanels.ts` | `layout/dockPanels.ts` |
| `hooks/useTitleBarProps.ts` | `layout/hooks/useTitleBarProps.ts` |
| `hooks/useAppLayoutProps.ts` | `layout/hooks/useAppLayoutProps.ts` |

### 4.4 UI 层

| 来源 | 目标 |
|------|------|
| `components/ui/*` | `ui/` |

### 4.5 App 层

| 来源 | 目标 |
|------|------|
| `App.tsx` | `app/App.tsx` |
| `AppModals.tsx` | `app/AppModals.tsx` |
| `AppProviders.tsx` | `app/AppProviders.tsx` |
| `main.tsx` | `app/main.tsx` |
| `vite-env.d.ts` | `app/vite-env.d.ts` |
| `hooks/useAppContainer.ts`（拆散） | `app/hooks/useAppShell.ts` |

### 4.6 散落文件处理

| 文件 | 去向 |
|------|------|
| `components/AppToast.tsx` | `shared/components/AppToast.tsx` |
| `components/DiffView.tsx` | `features/git/components/`（或删除若已被 diff/ 替代） |
| `components/MainContent.tsx` | `layout/MainContent.tsx` |
| `components/SettingsPanel.tsx` | 删除（重复） |
| `components/SplashScreen.tsx` | `app/components/SplashScreen.tsx` |

---

## 五、useAppContainer 拆散方案

### 5.1 当前结构（515 行）

```
useAppContainer
├── 核心状态 hooks (useAppConfig, useToast, useLocalProjects, useSessionPersistence, useWslProjects, useRemoteProjects)
├── Worktree 状态 + 清理 effect
├── Action hooks (useRemoteActions, useWslActions, useAgentActions, useWorktreeActions, useRemoteAuthActions)
├── 活动上下文 + 选择 (useActiveProject, useFileView, useProjectSelection, useCrossTypeSelection)
├── Tab 管理 + 文件处理
├── Session bootstrap + file refresh
├── Store 同步 effects
├── 键盘快捷键
├── Agent 点击 + 隐藏切换
├── Context value 组装 (projectActions, fileActions, wsl, remote, editor)
├── Props 组装 (titleBar, appProviders, appLayout, appModals)
└── Return
```

### 5.2 拆散后结构

| 新 Hook | 归属 | 职责 | 预计行数 |
|---------|------|------|---------|
| `useProjectOrchestrator` | `features/project/hooks/` | 项目列表加载、选择、拖拽、worktree 状态、store 同步 | ~80 |
| `useConnectionOrchestrator` | `features/connection/hooks/` | WSL/Remote 加载、连接、git 刷新、auth 流程 | ~100 |
| `useSessionOrchestrator` | `features/session/hooks/` | bootstrap + persistence + initializing 状态 | ~40 |
| `useEditorOrchestrator` | `features/editor/hooks/` | tab 管理、文件选择/刷新、split layout | ~60 |
| `useAgentOrchestrator` | `features/agent/hooks/` | agent 延迟加载、配置变更重载、点击路由、隐藏切换 | ~50 |
| **`useAppShell`** | `app/hooks/` | 薄壳组合层 | ~80 |

### 5.3 useAppShell 职责

```typescript
export function useAppShell(): UseAppShellResult {
  // 1. 调用各 feature orchestrator
  const project = useProjectOrchestrator();
  const connection = useConnectionOrchestrator();
  const session = useSessionOrchestrator();
  const editor = useEditorOrchestrator();
  const agent = useAgentOrchestrator();

  // 2. 注册全局键盘快捷键
  useKeyboardShortcuts({ ... });

  // 3. 组装顶层组件 props
  const titleBarProps = useTitleBarProps({ ... });
  const appLayoutProps = useAppLayoutProps({ ... });

  // 4. 组装 context provider values + modal props
  const appProvidersProps = { ... };
  const appModalsProps = { ... };

  return { initializing: session.initializing, titleBarProps, appLayoutProps, appProvidersProps, appModalsProps };
}
```

---

## 六、迁移批次

### 批次总览

| 批次 | 内容 | 风险 | 验证命令 |
|------|------|------|---------|
| **B0** | 创建目录骨架 + `ui/` 迁移 | 极低 | `pnpm type-check` |
| **B1** | `shared/` 基础（utils, types/app, types/adapter, icons, BranchDropdownContent） | 低 | `pnpm type-check` |
| **B2** | `shared/store/` — appViewStore + dockStore | 低 | `pnpm type-check` |
| **B3** | `shared/hooks/` — useKeyboardShortcuts + useToast | 低 | `pnpm type-check` |
| **B4** | `shared/contexts/` — app-context + sidebar-context | 低 | `pnpm type-check` |
| **B5** | `layout/` — TitleBar, AppLayout, Dock 系统, dockPanels 注册表 | 中 | `pnpm type-check` + dev |
| **B6** | `features/browser/` | 低 | `pnpm type-check` |
| **B7** | `features/skill/` | 低 | `pnpm type-check` + test |
| **B8** | `features/task/` | 低 | `pnpm type-check` |
| **B9** | `features/file/` | 低 | `pnpm type-check` |
| **B10** | `features/terminal/` | 中 | `pnpm type-check` + dev |
| **B11** | `features/git/` | 中 | `pnpm type-check` + test |
| **B12** | `features/settings/` | 中 | `pnpm type-check` |
| **B13** | `features/editor/` | 中 | `pnpm type-check` + dev |
| **B14** | `features/agent/` | 中 | `pnpm type-check` |
| **B15** | `features/connection/` | 高 | `pnpm type-check` + dev |
| **B16** | `features/project/` | 高 | `pnpm type-check` + dev |
| **B17** | `features/session/` | 中 | `pnpm type-check` |
| **B18** | `app/` 层 + useAppContainer → useAppShell 拆散 | 高 | 全量回归 |
| **B19** | 清理 — 删除兼容 barrel、旧空目录 | 低 | 全量回归 |

### 兼容层策略

迁移期间，旧位置保留 barrel re-export：

```typescript
// 示例：src/store/projectStore.ts（迁移期间）
export { useProjectStore } from '../features/project/store';
```

B19 批次统一删除所有兼容层文件。

### 批次执行规则

1. 每批开始前检查 `git status` 确认干净
2. 每批完成后运行验证命令
3. 验证通过后立即 commit（commit message: `refactor(frontend): B{N} - {内容简述}`）
4. 验证失败则回退该批所有变更

---

## 七、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| `taskStore` 直接 import `projectStore` + `editorStore` | B8 迁移时跨 feature 依赖 | 改为通过 `shared/store/` 暴露接口，或传入回调 |
| `dockPanelRegistry` lazy import 路径变化 | B5 迁移时面板加载失败 | 同步更新 registry 中所有 lazy import 路径 |
| `AppProviders` 嵌套 7 层 context | B18 拆散时大量修改 | 逐步替换，每层由对应 feature 的 context.tsx 提供 |
| `useAppContainer` 拆散引入回归 | B18 最终整合 | 保留旧 hook 不删，新 `useAppShell` 并行验证后切换 |
| 测试 import 路径失效 | 各批次 | 测试文件随组件一起迁移，保持相对路径 |
| Vite alias / tsconfig paths 需更新 | 全局 | B0 阶段预先配置 `@/` alias 指向 `src/` |

---

## 八、验证清单

### 每批次验证

```bash
pnpm type-check          # TypeScript 零错误
pnpm lint                # ESLint 零错误
pnpm test:run            # 单元测试全过
```

### 最终验证（B19 后）

```bash
pnpm type-check
pnpm lint
pnpm test:run
pnpm tauri dev           # 应用正常启动
# 手动验证：
# - 项目列表加载
# - 终端创建与输入
# - 文件树展开与编辑
# - Git commit 流程
# - WSL/Remote 连接
# - Settings 打开与保存
# - Skill 浏览与安装
# - 键盘快捷键响应
```

---

## 九、预计工作量

| 阶段 | 批次 | 预计时间 |
|------|------|---------|
| 基础层 | B0–B4 | ~30 分钟 |
| Layout 层 | B5 | ~45 分钟 |
| 独立 Features | B6–B12 | 每批 ~20-30 分钟 |
| 核心 Features | B13–B17 | 每批 ~30-45 分钟 |
| App 层 + 拆散 | B18 | ~60 分钟 |
| 清理 | B19 | ~15 分钟 |
| **总计** | | **6–8 小时** |

---

## 十、后续优化（不在本次范围）

完成目录迁移后可按需推进：

1. **Store 局部化** — 将只被单一 feature 使用的 store 替换为 feature-local `useReducer`
2. **Context 精简** — 合并冗余 context，减少 Provider 嵌套层数
3. **懒加载优化** — 基于 feature 目录做 code splitting
4. **Feature Flag** — 基于 feature 目录实现功能开关
5. **自动化检查** — ESLint rule 禁止跨 feature 直接 import
