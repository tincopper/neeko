# Git Commit View — IDEA 风格双面板提交界面

## 概述

新增一个 JetBrains IDEA 风格的 Git Commit 视图，采用**双面板布局**（左：变更列表+提交表单 / 右：Diff 查看器）。该视图作为 Git 工具窗口的 **Commit Tab**，与 Log Tab（即 GitBranchPanel 三栏视图）共享顶部 Tab 切换。

## 界面定位

IDEA 的 Git 工具窗口有两个核心 Tab：
- **Commit Tab** = 本功能（变更列表 + Diff 查看器）
- **Log Tab** = 已实现的 GitBranchPanel（分支列表 + 提交日志 + 提交详情）

用户通过顶部 Tab 切换两个视图，共享同一个 Git 工具窗口容器。

## 界面布局

```
┌─ Git ─────────────────────────────────────────────────────┐
│ [Commit] [Log]                                            │
├───────────────────────────────────────────────────────────┤
│ 🔍 Filter files...                                        │
├────────────────────────┬──────────────────────────────────┤
│                        │                                  │
│ feature/git-commit...  │  src/types.ts                    │
│ [Commit] [Push] [Pull] │  [Unified] [Side-by-side]       │
│ [Branch] [Refresh]     │  [ ] Do not ignore               │
│                        │  [✓] Highlight split changes     │
│ Changes (8)       [All]│                                  │
│ [All][M][A][D][R][U]   │  @@ -14,6 +14,24 @@             │
│                        │    deletions: number;            │
│ ☑ GitCommitPanel.tsx A │    }                             │
│ ☑ BranchInfo.tsx     A │  + export interface CommitInfo { │
│ ☑ ChangesList.tsx    A │  +   hash: string;               │
│ ☑ CommitForm.tsx     A │  +   short_hash: string;         │
│ ☑ CommitHistory.tsx  A │  +   message: string;            │
│ ☑ types.ts           M │  +   author: string;             │
│ ☑ local.rs           M │  +   email: string;              │
│ ☑ git.rs             M │  +   timestamp: number;          │
│                        │  +   date: string;               │
│ Unversioned Files (2)  │  + }                             │
│   test.tsx          U  │                                  │
│   design.md         U  │                                  │
│                        │                                  │
│ ┌─ Commit Message ───┐ │                                  │
│ │ Amend: [ ]          │ │                                  │
│ │                     │ │                                  │
│ │ Commit message...   │ │                                  │
│ │                     │ │                                  │
│ │ [Commit] [Commit &  │ │                                  │
│ │  Push...]           │ │                                  │
│ └─────────────────────┘ │                                  │
│                        │                                  │
├────────────────────────┴──────────────────────────────────┤
│ Recent Commits ▼                                           │
│ e4420d6  chore(task): create git commit panel  2h ago      │
│ e7893c8  feat(codemirror): extend language...  5h ago      │
└───────────────────────────────────────────────────────────┘
```

## 功能需求

### 左面板：变更列表 + 提交

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 分支信息栏 | 当前分支名 + Commit/Push/Pull/Branch/Refresh 按钮 | P0 |
| Changes 列表 | 已跟踪的变更文件（M/A/D/R）+ 文件选择框 | P0 |
| 全选/取消全选 | 顶部 All checkbox，支持半选状态 | P0 |
| 文件状态过滤 | All / Modified / Added / Deleted / Renamed / Untracked | P0 |
| 目录折叠 | 按目录分组，可折叠展开 | P1 |
| Unversioned Files | 未跟踪文件区域，可折叠 | P1 |
| 文件搜索 | 顶部搜索框按文件路径过滤 | P0 |
| Amend 选项 | checkbox 控制是否 amend 上一次提交 | P1 |
| Commit 消息输入 | 多行 textarea | P0 |
| Commit 按钮 | 提交选中的文件 | P0 |
| Commit & Push 按钮 | 提交并推送到远程 | P0 |
| 右键菜单 | Show History / Compare with / Add to .gitignore / Delete | P2 |

### 右面板：Diff 查看器

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 文件名标题栏 | 显示当前选中文件路径 | P0 |
| Unified/Split 切换 | 统一视图 / 并排视图 | P0 |
| Diff 渲染 | 行级高亮：新增绿色、删除红色 | P0 |
| 行号显示 | 左右行号 | P0 |
| Do not ignore 选项 | checkbox | P2 |
| Highlight split changes | checkbox | P2 |
| 空状态 | 未选文件时显示提示 | P0 |

### 底部：Recent Commits（可折叠）

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 最近提交列表 | 短哈希 + 消息 + 作者 + 时间 | P0 |
| 折叠/展开 | 点击标题栏切换 | P0 |

## Tab 切换架构

Git 工具窗口使用 Tab 切换 Commit / Log 视图：

```
┌─────────────────────────────────┐
│ GitWindow (Tab 容器)            │
│ ┌─────────────────────────────┐ │
│ │ [Commit] [Log]              │ │ ← Tab 切换栏
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ GitCommitView (Commit Tab)  │ │ ← 本功能
│ │ 或                          │ │
│ │ GitBranchPanel (Log Tab)    │ │ ← 已实现
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

## 技术方案

### 组件设计

```
src/components/git/
├── GitWindow.tsx            # NEW: Tab 容器（Commit / Log 切换）
├── GitCommitView.tsx        # NEW: Commit 视图主组件（双面板编排）
├── ChangesPanel.tsx         # NEW: 左面板（分支信息 + 文件列表 + 提交表单）
├── CommitDiffPanel.tsx      # NEW: 右面板（Diff 查看器）
├── GitBranchPanel.tsx       # EXISTING: Log 视图
├── BranchList.tsx           # EXISTING
├── CommitLog.tsx            # EXISTING
├── CommitDetail.tsx         # EXISTING
├── CommitDiffView.tsx       # EXISTING
├── CommitGraph.tsx          # EXISTING
└── index.ts                 # UPDATE: 新增导出
```

### 组件 Props 设计

```typescript
// GitWindow.tsx
interface GitWindowProps {
  gitSource: GitSource;
  currentBranch: string;
  diffMode: DiffMode;
}

// GitCommitView.tsx
interface GitCommitViewProps {
  gitSource: GitSource;
  currentBranch: string;
}

// ChangesPanel.tsx
interface ChangesPanelProps {
  files: FileChange[];
  unversionedFiles: FileChange[];
  selectedFiles: Set<string>;
  selectedFilePath: string | null;
  currentBranch: string;
  onToggleFile: (path: string) => void;
  onToggleAll: () => void;
  onSelectFile: (path: string) => void;
  onCommit: (message: string, amend: boolean) => void;
  onCommitPush: (message: string, amend: boolean) => void;
  onRefresh: () => void;
}

// CommitDiffPanel.tsx
interface CommitDiffPanelProps {
  filePath: string | null;
  diffSource: DiffSource;
  diffMode: DiffMode;
  onToggleDiffMode: () => void;
}
```

### 后端需求

无需新增后端命令。复用现有：
- `get_file_diff_command` — 工作区文件 diff
- `get_commit_log` — Recent Commits 列表
- `get_git_info` — 变更文件列表（changed_files）
- `git commit` — 需新增 `create_commit` Tauri 命令
- `git push` — 需新增 `push_remote` Tauri 命令

**需要新增的后端命令：**

| 命令 | 说明 | 优先级 |
|------|------|--------|
| `create_commit` | git commit -m / git commit --amend -m | P0 |
| `push_remote` | git push | P0 |
| `get_unversioned_files` | git ls-files --others --exclude-standard | P1 |

### 集成方式

`GitWindow` 替换 MainContent 中当前 `GitBranchPanel` 的位置：
- `gitViewActive` 时渲染 `GitWindow`（包含 Commit/Log Tab 切换）
- 不再直接渲染 `GitBranchPanel`，而是由 `GitWindow` 内部管理

## 验收标准

- [ ] Tab 切换 Commit / Log 正常
- [ ] Changes 列表显示所有变更文件
- [ ] 文件状态徽章正确（M/A/D/R/U）
- [ ] 文件选择/取消选择正常
- [ ] 全选/取消全选正常（含半选状态）
- [ ] 文件状态过滤正常
- [ ] 搜索框过滤文件路径正常
- [ ] 点击文件在右面板显示 Diff
- [ ] Unified / Split 切换正常
- [ ] Commit 消息输入框正常
- [ ] Commit 按钮提交选中文件
- [ ] Commit & Push 正常
- [ ] Amend 选项正常
- [ ] Unversioned Files 区域正常
- [ ] Recent Commits 折叠展开正常
- [ ] 目录折叠展开正常
- [ ] 所有组件使用 React.memo
- [ ] TypeScript 类型检查通过
- [ ] Rust 编译通过
