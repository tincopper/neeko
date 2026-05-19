# Project list redesign — V1 Reference Faithful

## Goal

把已用户验收的原型 V1 Reference Faithful 折回 Neeko 生产代码，让侧边栏 ProjectsPanel 的视觉与信息密度对齐 `src/prototype/projects/variants/V1Reference.tsx`，同时让 Local / WSL / SSH 三个入口呈现统一的 V1 风格。

## What I already know

- 原型决策记录于 `src/prototype/projects/NOTES.md`（rev 2，2026-05-18 用户第二张参考图细化）。
- 受影响文件（已通读）：
  - **Local**: `src/components/project/ProjectItem.tsx` → `ProjectItemHeader.tsx` + `ProjectGitSection.tsx` + `WorktreeList.tsx`
  - **WSL/SSH**: `src/components/connections/RemoteItems.tsx` (`WSLItem`/`RemoteItem` 外层) → `ConnectionProjectCard.tsx` → `ProjectItemCard.tsx`
- 关键不对称：Local 走 `ProjectItem`，WSL/SSH 走独立的 `ProjectItemCard`。
- 数据可得性确认：
  - `+A -D` 修改统计：`Project.git_info.changed_files`（local/WSL/SSH 均有），前端聚合即可。
  - `↑N` ahead：后端命令齐备（`get_ahead_behind_command` / `wsl_get_ahead_behind` / `remote_get_ahead_behind`），但 `GitInfo` 不带 ahead/behind 字段，需主动 invoke。

## Requirements

- **视觉**：ProjectsPanel 视觉与原型 V1 rev 2 一致
  - 28x28 字母色块头像（沿用 `getAvatarStyle` 调色板 + 1.5px 描边 + 15% 透明度底）
  - 项目名 + `(N)` 会话计数（N = 1 主终端 + worktree 数）
  - 子项双行：第 1 行 label（`local` / 各 worktree 目录名），第 2 行 mono branch
  - 子项左侧 28x28 ghost 图标块（laptop / folder-agent）
  - 项目分组之间 hairline 分隔（`border-b border-white/[0.04]`）
- **行尾 chip 区**（不冲突可叠加）：
  - `↑N`（绿）：**仅 active session 行**显示；active 切换时单次 invoke `get_ahead_behind_*`
  - `+A -D`（绿/红 mono）：所有有 add+del>0 的 session 行显示，从 `changed_files` 聚合
  - `⌘N`：active 行显示 Ctrl+1~9 序号
- **三端统一**：
  - Local 与 WSL/SSH 项目卡 视觉一致（共享同一组件实现）
  - WSL/SSH 外层 distro/server 头部 = **轻量 section header**（小号 uppercase tracking-wide label + distro logo / `server.svg` + hover 显示原有 `+` Add Project / Trash Remove distro）
- **头部动作映射**：
  - `+` 按钮 = New Worktree（与原型语义一致）
  - 现有 IDE / Trash / Git 下拉（Commit/Push/Pull/New Branch/New Worktree） 全部保留在 hover 右侧插槽，行为不改
- **不破坏现有交互**：折叠/展开、右键菜单、拖拽排序、IDE 启动、设置弹窗、worktree CRUD（rename/delete/dirty 检测）
- **Worktree Changes 文件树**：从 sidebar 移除（rev 2 spec），变更明细走中间区 DiffView

## Acceptance Criteria

- [ ] Local 项目侧边栏外观匹配新参考图（人工对比）
- [ ] WSL/SSH 项目卡与 Local 项目卡视觉一致（共用组件）
- [ ] WSL/SSH 外层 distro/server 头部呈轻量 section 风格，原有 Add/Remove 入口保留在 hover
- [ ] active session 行展示 ↑N（如 ahead > 0）+ ⌘N
- [ ] 任意 session 行展示 +A -D（如 changed_files 非空）
- [ ] 折叠/展开、右键菜单、拖拽、IDE、Git 下拉、Settings、Commit/Push/Pull、worktree CRUD 全部正常
- [ ] `npx tsc --noEmit` 通过
- [ ] `pnpm test:run` 通过
- [ ] 合并后删除 `src/prototype/projects/` 与 `prototype-projects.html`

## Definition of Done

- 受影响组件单测/快照测试更新
- Lint / typecheck / vitest 通过
- 原型文件清理在最后一个 PR 同步删除
- CHANGELOG.md 记一行视觉变化
- 行为变化（移除 sidebar Changes 文件树）在 PR description 中显式说明

## Technical Approach

**抽象与复用**：
- 新增共享组件 `src/components/project/ProjectGroup.tsx`（V1 头部 + session 列表壳子）
- 新增共享组件 `src/components/project/SessionRow.tsx`（laptop/folder-agent 图标 + 双行文本 + 行尾 chip 区）
- 新增 `src/components/project/SessionChips.tsx`（`AheadChip` / `ChangesChip` / `KbdChip`）
- Local: `ProjectItem` 拆 `ProjectGroup` + sessions（sessions = `[{ kind: "local", ... }, ...worktrees]`）
- WSL/SSH: `ConnectionProjectCard` 改用同一个 `ProjectGroup`，外层 `WSLItem`/`RemoteItem` 改写为 lightweight section header

**ahead 数据流**：
- 不进 GitInfo（避免列表批量调用），仅在 active 切换时由 `useLocalProjects` / `useWslProjects` / `useRemoteProjects` 各自 invoke 对应的 `get_ahead_behind_*`，结果写到 store 的 `aheadBehind: Record<projectId, AheadBehind>`
- 切回失效时清除（避免显示陈旧数据）

**changed_files 聚合**：
- 纯前端 `useMemo` 聚合 add/del；Worktree 行的 +A -D 仍按 worktree 维度独立（需要从后端取 `get_worktree_changed_files` 缓存——已存在于 WorktreeList 当前实现）。注意：rev 2 spec 移除了 sidebar 内嵌 Changes 文件树，但 `+A -D` 聚合数据仍由该接口提供，懒加载

**头部动作**：
- 新增组件接受 `onAddWorktree`/`onIde`/`onRemove`/`onGitMenu`/`onContextMenu` props，3 端共用

## Decision (ADR-lite)

**Context**: 当前 Local 与 WSL/SSH 路径有两套独立的项目卡实现（ProjectItem vs ProjectItemCard），视觉重设计若各改各处会导致永久不对称。

**Decision**: 抽出共享 `ProjectGroup` + `SessionRow` 组件作为唯一视觉源，Local/WSL/SSH 各自的 wrapper 只负责数据 adapter（path resolution、Tauri command bind），不再各自维护视觉。WSL/SSH 外层 distro/server 头降级为 lightweight section header，避免与新统一的项目卡抢视觉中心。

**Consequences**:
- 优：未来加 chip / 改交互只在一个组件改；三端永远一致
- 缺：本次改动面更大（4 个旧文件需要拆解），WSL/SSH session 概念需要前端 normalize（local 终端 + worktrees）
- 风险：现有拖拽（`useProjectItemDrag`）耦合在两份壳里，重构时容易破；缓解措施 = 把 drag wrapper（DraggableProjectItem）继续套在外，组合而非合并

## Out of Scope

- 不改数据 hook 与 store 的领域结构（仅扩展 aheadBehind 切片）
- 不改 worktree CRUD 业务逻辑（rename/delete/dirty 检测代码不动）
- 不为 ProjectsPanel 引入新路由 / 新页面
- 不在 sidebar 内重新呈现 Changes 文件树（已迁出至 DiffView）
- 不改 ContextMenu 内容
- 不重设计 SettingsPanel / TitleBar 等周边

## Implementation Plan (small PRs)

- **PR1 — scaffolding & shared components**：
  - 新增 `ProjectGroup.tsx` / `SessionRow.tsx` / `SessionChips.tsx`
  - 写组件级单测（render with mock props，验证 chip 优先级 / hover 行为 / 头像样式）
  - 此 PR 不接入真实数据流，仅以 mock 验证视觉
- **PR2 — Local 接入**：
  - `ProjectItem` 改用 `ProjectGroup`；`ProjectGitSection` + `WorktreeList` 改造为返回 `Session[]` 的纯函数 + `SessionRow` 渲染
  - Sidebar Changes 文件树代码下线
  - 接 `aheadBehind` store 切片 + active 切换 invoke
- **PR3 — WSL/SSH 接入 + 外层 section header**：
  - `ConnectionProjectCard` 改用 `ProjectGroup`
  - `WSLItem`/`RemoteItem` 头部改写为 lightweight section header
  - 三端 ahead 数据各自 invoke
- **PR4 — 收尾**：
  - 测试更新与回归扫一遍（拖拽、Git 下拉、Settings、Commit/Push/Pull、worktree CRUD）
  - CHANGELOG.md 一行
  - 删除 `src/prototype/projects/` 与 `prototype-projects.html`

## Technical Notes

- 原型源：`src/prototype/projects/variants/V1Reference.tsx`、`Showcase.tsx`、`mockData.ts`
- 头像工具：`src/utils/projectAvatar.ts`（`getAvatarStyle` + `getProjectInitials`）
- 后端 ahead/behind 命令：`src-tauri/src/commands/git.rs:466`、`wsl_git.rs:508`、`remote_git.rs:483`
- `AheadBehind` 类型：`src/types/git.ts:62`
- 键盘快捷键：`useKeyboardShortcuts` 已实现 Ctrl+1~9，⌘N chip 仅展示
