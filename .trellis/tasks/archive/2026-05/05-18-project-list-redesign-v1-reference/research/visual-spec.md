# Visual Spec — V1 Reference Faithful (rev 2.1)

> 单页可执行规格，sub-agent 直接消费。原型可运行预览：`prototype-projects.html?v=1`（源码 `src/prototype/projects/variants/V1Reference.tsx`、`Showcase.tsx`、`mockData.ts`）。

## 1. 三端混排骨架

侧边栏顺序：**Local 项目（无 section header）→ 各 WSL distro（含 section header）→ 各 SSH server（含 section header）**。每个项目作为一个 `ProjectGroup` 卡片。

```
[Local 项目卡 1]
[Local 项目卡 2]
...
─── WSL · UBUNTU (1)        ← lightweight section header
[WSL 项目卡]
─── SSH · DEV-SERVER:22 (3)  ← lightweight section header
[SSH 项目卡 1]
...
```

## 2. 项目卡 Header

```
[Avatar]  ProjectName (N)              [hover: IDE Git⋮ Trash]  [+]  [⌄]
```

- **Avatar**：28×28 圆角方块，`color = getAvatarStyle(name)`，1.5px 描边 + 15% 透明底，居中字母 `getProjectInitials(name)`
- **ProjectName**：`text-[14px] font-semibold text-text-primary`
- **(N)**：会话数 = 1 (主 local 终端) + worktrees.length，灰
- **`+` 按钮**：`title="New Worktree"`，调起新建 worktree 对话框（等价当前 `onOpenDialog("new-worktree")`）
- **`⌄` 按钮**：折叠/展开，等价 `setProjectCollapsed`
- **Hover 槽位（仅在项目 hover 或 active 时可见）**：
  - `Open in IDE`（hover 蓝）→ 等价 `onOpenIde(project.id)`
  - `Git actions ⋮`（更多）→ 弹出现有 Commit/Push/Pull/New Branch/New Worktree 下拉
  - `Remove project`（hover 红）→ 等价 `onRemoveProject`
- **Click header body**：折叠/展开

## 3. Session 行（双行）

```
[28×28 ghost icon]  label             [chip 区]
                    branch (mono)
```

- `Session` 是前端 normalize 出来的概念，由 `Project` 派生：
  - `[{ kind: "local", label: "local", branch: git_info.current_branch, isPrimary: true }, ...worktrees.map(w => ({ kind: "worktree", label: dirname(w.path), branch: w.branch }))]`
- **Icon**：`local` → laptop；`worktree` → folder-agent (folder + plug icon)
- **Active 行**：背景 `bg-white/[0.04]`；非 active hover `bg-white/[0.025]`
- **行尾 chip 区，从左到右、可叠加**：

| chip | 渲染条件 | 颜色 |
|------|---------|------|
| `↑N` | **active 行** && `aheadBehind?.ahead > 0` | 绿 `#3fb950` mono |
| `+A` | `changes.add > 0` | 绿 `#3fb950` mono |
| `-D` | `changes.del > 0` | 红 `#f85149` mono |
| `⌘N` | active 行（N = `useKeyboardShortcuts` 已分配序号 1~9） | text-text-muted mono |

## 4. WSL/SSH Section Header

```
[icon] WSL · ubuntu (3)              [hover: + Trash]
```

- 高度 = 行高 ≈ 22~24px，padding `px-3 pt-3 pb-1`
- Label 样式：`text-[10.5px] font-bold tracking-[0.16em] uppercase text-text-muted`
- distro/server 名：`text-[11px] text-text-secondary`
- **Hover 槽位**：
  - `Add WSL/Remote project` → 等价 `onAddProject`
  - `Remove distro/server` (hover 红) → 等价 `onRemoveEntry`
- **图标**：WSL → 自定义 PenguinIcon 或现有 distro logo (`getDistroIcon`)；SSH → 现有 `server.svg` 或 ServerIcon

## 5. 行高/间距统一表

| 元素 | 高度/间距 |
|------|----------|
| 项目卡 header padding | `px-3 py-2.5` |
| Session 行 | `pl-4 pr-3 py-2 mx-1.5 rounded-md` |
| Session 头像槽 | `w-7 h-7` |
| 项目分组之间 | `border-b border-white/[0.04]`（最后一组无） |
| Section header | `px-3 pt-3 pb-1` |

## 6. 数据需求 vs 现有类型

| chip / 字段 | 数据来源 | 三端是否齐备 |
|------------|---------|-------------|
| Avatar 字母 / 颜色 | `getProjectInitials` / `getAvatarStyle` | ✅ 三端共用 utils |
| `(N)` 会话数 | `1 + git_info.worktrees.length` | ✅ Local/WSL/SSH 的 `git_info.worktrees` 同 schema |
| `+A -D` | `changed_files.reduce((s, f) => s.add + f.additions, ...)` | ✅ 三端 `git_info.changed_files` 同 schema |
| `↑N` | invoke 三个对应命令：`get_ahead_behind_command` / `wsl_get_ahead_behind` / `remote_get_ahead_behind` | ✅ 命令齐备，仅 active 切换时调一次 |
| Worktree session.branch | `git_info.worktrees[i].branch` | ✅ 三端同 |
| Worktree session.label | `path.split(/[\\/]/).pop()` | ✅ 三端同（与 `WorktreeList` 现有派生一致） |

## 7. 必须保留的现有交互

- `useProjectItemDrag` 拖拽排序（`DraggableProjectItem` 包装层不动）
- 右键菜单（`ContextMenu` + `useProjectItemMenu`）
- IDE 启动（`onOpenIde`，沿用 `getIdeIconByCommand`）
- Git 下拉：Commit / Push / Pull / New Branch / New Worktree
- Settings 对话框（`ProjectSettingsDialog`）
- Worktree 重命名 / 删除（含 dirty 检测）
- Ctrl+1~9 / Ctrl+Q 项目切换（`useKeyboardShortcuts`）
- 折叠状态持久化（`set_project_collapsed`）

## 8. 必须移除/迁出的功能

- 侧边栏内嵌的 Worktree Changes 文件树（`WorktreeList` expand 出的 FileTree 节点）。
  - 用户查看变更走中间区 `DiffView`。
  - 但 `get_worktree_changed_files` 仍保留——只是不再渲染 FileTree，仅用于聚合 `+A -D`。

## 9. 实现切片（与 PRD Implementation Plan 对齐）

- **PR1**：`src/components/project/ProjectGroup.tsx` + `SessionRow.tsx` + `SessionChips.tsx`，纯展示组件 + 单测（mock props）
- **PR2**：Local 接入 `ProjectGroup`，下线 `WorktreeList` 的 FileTree 节点；新增 `aheadBehind` store 切片 + active 切换 invoke
- **PR3**：WSL/SSH `ConnectionProjectCard` 改用 `ProjectGroup`；`WSLItem`/`RemoteItem` 改写为 lightweight section header
- **PR4**：测试更新、CHANGELOG、删除 `src/prototype/projects/`、`prototype-projects.html`
