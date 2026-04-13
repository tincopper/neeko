# 解决 enhance/title_bar 合并 main 分支冲突

## 背景

`enhance/title_bar` 分支与 `main` 分支从 `cf285a8` 分叉后各自演进，产生了 15 个冲突文件。两条分支的改动方向存在架构级分歧：

- **enhance/title_bar**: 重构 TitleBar 布局，新增多 Tab 终端支持，移除 SideTerminal 副终端，内嵌 AgentSelector 多功能面板
- **main**: 引入 Context 体系 (AppProvider/SidebarProvider)，完成 Tailwind CSS 迁移，新增 SplashScreen，将 ProjectSidebar 迁移到 panels 目录，新增 shadcn DropdownMenu

### 两分支 commit 对比

**enhance/title_bar** (从 merge-base 起):
- `009cad3` enhance: agentSelector
- `8441037` feat: 重构 TitleBar 布局并添加多 Tab 终端支持
- `d547497` fix: resolve user PATH from login shell for agent detection on macOS/Linux

**main** (从 merge-base 起):
- `bad5dfc` fix: add ResizeObserver to WorktreeTerminalView
- `116655a` fix: replace HTML5 Drag API with Pointer Events for cross-platform drag sorting
- `9fdf4f2` feat: replace hand-written Add dropdown with shadcn DropdownMenu
- `ea30517` perf: optimize startup by lazy-loading git info, async agent check
- `edb0d28` fix: reduce startup white screen and fix terminal layout corruption

## 决策

经与用户确认，确定以下三个关键决策：

| 决策项 | 选择 | 说明 |
|--------|------|------|
| 终端模型 | **Tab 系统** | 保留 enhance/title_bar 的多标签页设计，删除 SideTerminal |
| 架构基底 | **main 架构** | 以 main 的 Context + Tailwind + AppLayout 为基础 |
| UI 设计 | **HEAD 版本** | TitleBar 和 AgentSelector 保留 IDE 风格设计 |

## 目标

将 15 个冲突文件全部解决，使项目能正常编译运行。最终代码需满足：
1. 以 main 的架构基底 (Context/Tailwind/AppLayout) 为骨架
2. 在此骨架上集成 HEAD 的 Tab 系统和 IDE 风格 TitleBar/AgentSelector
3. 彻底移除 SideTerminal 相关代码
4. 保留两边各自的 bug fix（agent.rs 条件编译、delayedInit 等）

## 冲突文件清单与解决策略

### 第一类：架构级冲突（需要合并两边功能）

#### 1. `src/App.tsx` (7 处冲突)

| 冲突区域 | HEAD | main | 解决策略 |
|----------|------|------|----------|
| import | `useRef`, `invoke` | 移除这两个 | 按需保留（Tab 系统需要的保留） |
| 架构 import | `useAppRefSync`, `styles.css` | `useDelayedInit`, `SplashScreen`, `AppProvider`, `SidebarProvider` | 采用 main 的 Context 体系，移除 `styles.css` 导入 |
| suppressRef + worktree 清理 | `suppressTerminalResizeRef`, `handleSelectProjectWithClear` | 注释说明 worktree 切换 | 保留 HEAD 的 worktree 清理逻辑（如 Tab 系统需要），移除 suppressRef（SideTerminal 产物） |
| ref sync + delayedInit | `worktreeDiffState` | `useDelayedInit`, `useAppRefSync` 含 SideTerminal refs | 采用 main 的 delayedInit，ref sync 中移除 SideTerminal 相关 refs，保留 HEAD 的 worktreeDiffState |
| TitleBar props | Tab 相关 props + agents + agentClick | `installedMap` | 保留 HEAD 的 TitleBar props（Tab/Agent 栏），同时传入 main 的 `installedMap` |
| 主体布局 | 扁平 `<ProjectSidebar>` + `<MainContent>` | `<AppProvider>` + `<SidebarProvider>` + `<AppLayout>` | 采用 main 的 Provider/Layout 包裹，内部传递 HEAD 的 Tab 相关 props，移除 SideTerminal props |
| 对话框区域 | WSL/Remote/Settings 带额外 agents/config props | 从 Context 获取 | 采用 main 的 Context 方式，但 SettingsPanel 保留 Agent Bar 配置 props |

#### 2. `src/components/layout/TitleBar.tsx` (4 处冲突)

**策略**: 保留 HEAD 的 IDE 风格多行标题栏设计，但样式从 CSS 类迁移到 Tailwind。

| 冲突区域 | 解决策略 |
|----------|----------|
| import | 保留 HEAD 的 import（AgentIcon, TerminalTabBar），移除 styles.css |
| TitleBarProps | 保留 HEAD 的完整 props 定义（Tab + Agent 栏 + compactMode） |
| 函数参数 | 同上 |
| JSX 渲染 | 保留 HEAD 的三区布局设计，样式迁移到 Tailwind `cn()` |

#### 3. `src/components/layout/AgentSelector.tsx` (2 处冲突)

**策略**: 保留 HEAD 的多功能面板设计，样式迁移到 Tailwind。

| 冲突区域 | 解决策略 |
|----------|----------|
| import | 保留 HEAD 的 `AppConfig`, `AgentConfig`，补充 main 的 `cn` |
| JSX 渲染 | 保留 HEAD 的三层面板（当前 Agent + AgentBar + 配置），样式迁移到 Tailwind |

#### 4. `src/components/MainContent.tsx` (5 处冲突)

**策略**: 采用 main 的 Context 获取方式，集成 HEAD 的 Tab 逻辑，移除所有 SideTerminal。

| 冲突区域 | 解决策略 |
|----------|----------|
| import + props | 采用 main 的 `useAppContext`，保留 HEAD 的 Tab 类型和 props |
| 核心逻辑 | 采用 main 的 Context 方式，保留 HEAD 的 Tab 状态解析 |
| WSL 副终端 | 删除（不要 SideTerminal） |
| 终端容器 class | 采用 main 的 Tailwind 类 |
| 本地副终端 | 删除（不要 SideTerminal） |

#### 5. `src/components/project/ProjectSidebar.tsx` (1 处大冲突)

**策略**: 采用 main 的重导出方式。确认 HEAD 的功能已在 `panels/ProjectsPanel.tsx` 中存在或需要合入。

```
// 最终代码
export { default } from "../panels/ProjectsPanel"
```

需检查 `ProjectsPanel.tsx` 是否需要补充 HEAD 的改动。

### 第二类：SideTerminal 清理（统一移除）

| 文件 | 冲突类型 | 解决策略 |
|------|----------|----------|
| `src/components/connections/RemoteItems.tsx` (12处) | HEAD 移除 `onOpenSideTerminal`，main 保留 | 采用 HEAD 的方向（移除），但样式用 main 的 Tailwind |
| `src/components/project/ProjectItem.tsx` (2处) | HEAD 无副终端按钮，main 新增 | 移除副终端按钮，样式用 main 的 Tailwind |
| `src/components/RemoteProjectView.tsx` (1处) | HEAD 无副终端，main 有 | 移除副终端渲染 |
| `src/components/terminal/SideTerminalView.tsx` (DU) | HEAD 删除，main 保留 | **删除此文件** |
| `src/hooks/useSideTerminalResize.ts` (DU) | HEAD 删除，main 保留 | **删除此文件** |

### 第三类：简单冲突（明确选择一边）

| 文件 | 解决策略 | 原因 |
|------|----------|------|
| `.gitignore` | 采用 **main** | main 需要将 `.claude/` `.agents/` 纳入版本控制（shadcn skill） |
| `src-tauri/src/agent.rs` | 采用 **HEAD** | HEAD 的 `#[cfg(target_os)]` 条件编译是正确的修复，main 的运行时判断在非 Windows 会编译失败 |
| `src/components/SettingsPanel.tsx` | 保留 HEAD 的 Agent Bar 配置项，样式迁移到 Tailwind | HEAD 新增的 showAgentBar/compactMode 开关对应 TitleBar 设计 |
| `src/hooks/useSessionBootstrap.ts` | 采用 **main** | 新增 `initializing` 状态用于 SplashScreen |
| `src/styles.css` (UD) | **删除此文件** | 接受 main 的 Tailwind 迁移 |

## 验收标准

- [ ] 所有 15 个冲突文件已解决，无残留 `<<<<<<<` / `=======` / `>>>>>>>` 标记
- [ ] `npx tsc --noEmit` 类型检查通过
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` Rust 编译通过
- [ ] `pnpm tauri dev` 能正常启动
- [ ] TitleBar 显示 IDE 风格多行布局（含 Tab 栏 + Agent 栏）
- [ ] Tab 系统功能正常（新增/关闭/切换标签页）
- [ ] AgentSelector 多功能面板正常工作
- [ ] 无任何 SideTerminal 相关代码残留
- [ ] Context 体系 (AppProvider/SidebarProvider) 正常工作
- [ ] SplashScreen 启动屏正常显示
- [ ] 设置面板中 Agent Bar 显示配置生效

## 技术风险

1. **HEAD 的 TitleBar/AgentSelector 样式迁移**: 原代码使用 CSS 类（定义在 styles.css），删除 styles.css 后需要将所有样式迁移到 Tailwind。可能遗漏某些样式定义。
2. **ProjectSidebar 重导出**: HEAD 在 ProjectSidebar.tsx 中有功能改动，但 main 已迁移到 ProjectsPanel.tsx。需要确认 HEAD 的改动是否需要在 ProjectsPanel 中重新应用。
3. **Tab 系统与 Context 体系的集成**: Tab 状态管理原在 App.tsx 层通过 props 传递，迁移到 Context 体系后需要确认状态流转是否正确。
4. **SideTerminal 清理范围**: 除了冲突文件外，可能还有其他文件引用了 SideTerminal。需要全局搜索确认清理完整。

## 执行顺序建议

1. 先解决简单冲突（.gitignore, agent.rs, useSessionBootstrap.ts）
2. 删除确定不要的文件（styles.css, SideTerminalView.tsx, useSideTerminalResize.ts）
3. 解决 SideTerminal 清理类冲突（RemoteItems, ProjectItem, RemoteProjectView）
4. 解决架构级冲突（App.tsx, MainContent.tsx, ProjectSidebar.tsx）
5. 解决 UI 设计冲突（TitleBar.tsx, AgentSelector.tsx, SettingsPanel.tsx）
6. 全局搜索清理 SideTerminal 残留引用
7. 编译检查 + 运行测试
