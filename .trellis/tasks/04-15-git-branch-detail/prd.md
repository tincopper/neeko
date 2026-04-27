# Git Branch Detail Panel — IDEA 风格三栏 Git 工具窗口

## 概述

新增一个 JetBrains IDEA 风格的 Git 分支详情界面，采用三栏布局（左：分支列表 / 中：提交日志 / 右：提交详情+文件 Diff）。该功能作为**独立全屏视图**，替换 MainContent 的终端区域。与 [git-commit-panel](../04-15-git-commit-panel/) 共享 Git 基础设施（DiffView、FileTree、类型定义），但在 UI 层面是独立入口。

## 界面定位

**独立全屏视图** — 替换 MainContent 区域，类似 IDEA 的 Git 工具窗口（View → Tool Windows → Git）。用户通过 **ActivityBar 图标**进入该视图（新增 Git 分支图标），再次点击或切换到其他 Activity 时返回终端视图。

## 设计参考

对标 IntelliJ IDEA 的 Git 工具窗口（View → Tool Windows → Git）：
- 左栏 = Branches 面板
- 中栏 = Log 面板（含可视化图）
- 右栏 = Commit Details + File Diff

## 界面布局

### 左侧面板：Branches（约 200px，可折叠目录）

```
┌─ Branches ──────────────────────┐
│ [New Branch] [Refresh]          │
├─────────────────────────────────┤
│ ▼ Local (4)                     │
│   ★ main                       │
│     feature/git-commit-panel    │
│     feature/git-branch-detail   │
│     enhance/project_sidebar     │
│ ▶ Remote (3)                    │
│ ▶ Tags (2)                      │
└─────────────────────────────────┘
```

- 分三组：Local / Remote / Tags，每组可折叠
- 当前分支用 ★ 标识 + 高亮
- 点击分支 → 中栏加载该分支的提交历史
- 右键菜单：Checkout / New Branch From / Delete / Merge / Rename
- 顶部操作按钮：New Branch / Refresh

### 中间面板：Commits Log（自适应宽度）

```
┌─ Commits ───────────────────────────────────────┐
│ 🔍 Text or hash ── [Branch ▼] [User ▼] [Date ▼]│
├─────────────────────────────────────────────────┤
│ ○ e4420d6  hehaishui  2h ago  chore(task): ... │
│ ○ e7893c8  hehaishui  5h ago  feat(codemirror)..│
│ ○ 7327433  hehaishui  1d ago  Merge pull req... │
│ ○ fb32fbe  hehaishui  1d ago  chore: record...  │
│ ○ 223f0fd  hehaishui  1d ago  chore(task): ...  │
│ ...                                             │
└─────────────────────────────────────────────────┘
```

- 提交列表：短哈希 + 作者 + 时间 + 提交消息
- 顶部搜索框：支持文本搜索和哈希搜索
- 筛选栏：Branch / User / Date 三个下拉筛选器
- 提交可视化图：左侧用彩色圆点+连线展示分支合并拓扑（P1，完整 IDEA 风格拓扑图）
- 选中提交高亮，点击 → 右栏加载该提交详情
- 分页加载：每次 50 条，底部 Load More 按钮加载更多

### 右侧面板：Commit Details + Diff（约 350px，可调宽度）

```
┌─ Commit Details ────────────────────────────────┐
│ e4420d6                                         │
│ chore(task): create git commit panel feature    │
│ hehaishui <hehaishui@xxx.com> · 2 hours ago     │
├─────────────────────────────────────────────────┤
│ Changed Files (5)                          [All]│
│ ┌─────────────────────────────────────────────┐ │
│ │ M src/types.ts              +18  -2         │ │
│ │ A src/components/.../BranchInfo.tsx  +68     │ │
│ │ A src/components/.../ChangesList.tsx +185    │ │
│ │ A src/components/.../CommitForm.tsx  +72     │ │
│ │ A src/components/.../CommitHistory.tsx +93   │ │
│ └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│ ┌─ Diff View (selected file) ────────────────┐  │
│ │ @@ -1,5 +1,23 @@                           │  │
│ │ + export interface CommitInfo { ... }       │  │
│ │ ...                                         │  │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

- 提交详情：完整哈希 + 消息 + 作者 + 时间
- 修改文件列表：状态徽章(M/A/D/R) + 文件名 + 增删统计
- 点击文件 → 下方展开 Diff 视图（复用现有 DiffView 组件）
- 支持 Unified / Split 切换

## 功能需求

### 分支管理

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 分支列表 | 显示 Local / Remote / Tags 三组 | P0 |
| 当前分支标识 | ★ + 高亮 | P0 |
| 分支折叠 | 每组可折叠展开 | P0 |
| Checkout | 右键切换分支 | P0 |
| New Branch | 基于当前/选中分支创建 | P0 |
| Delete Branch | 删除前确认提示 | P1 |
| Rename Branch | 右键重命名 | P2 |
| Merge Branch | 右键合并到当前分支 | P2 |
| New Branch From | 基于任意提交创建分支 | P2 |

### 提交管理

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 提交列表 | 按时间倒序显示 | P0 |
| 提交详情 | 哈希 + 消息 + 作者 + 时间 | P0 |
| 搜索 | 文本搜索 + 哈希搜索 | P0 |
| 分支筛选 | 下拉选择分支 | P1 |
| 用户筛选 | 下拉选择作者 | P1 |
| 日期筛选 | 下拉选择时间范围 | P2 |
| 可视化图 | 分支合并拓扑线 | P1 |
| Checkout Commit | 检出到历史提交 (detached HEAD) | P2 |

### 文件 Diff

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 文件列表 | 提交修改的文件列表 | P0 |
| 状态徽章 | M/A/D/R | P0 |
| Diff 视图 | 复用现有 DiffView 组件 | P0 |
| Unified/Split | 视图切换 | P0 |

## 技术要求

### 前端

- React 18 + TypeScript
- 所有组件使用 `React.memo` 包裹
- Props 接口定义在组件同一文件中（interface，不用 type）
- 回调 Props 用 `onXxx` 命名，用 `useCallback` 包裹
- 样式用 Tailwind CSS v4 + CSS 变量（`--font-size`、`--terminal-font-size`）
- 字体大小用 `text-[var(--font-size)]`，不硬编码 `text-xs`/`text-sm`
- 领域类型从 `types.ts` 导入，不本地重复声明
- 新组件子目录有 barrel export `index.ts`

### 后端

- 新增 Rust 类型：`CommitInfo`（state.rs）
- 新增 Tauri 命令：`get_commit_log`、`get_commit_detail`、`get_branch_list`
- 使用 git2-rs 实现
- 返回类型 `Result<T, String>`
- 命令注册到 `lib.rs` 的 `generate_handler!`
- 新字段加 `#[serde(default)]` 保证向后兼容

### 集成

- 复用现有 `DiffView` 组件显示文件 Diff
- 复用现有 `FileTree` 组件（如适用）
- 作为独立全屏视图替换 MainContent，通过 ActivityBar 图标进入
- 支持 local / WSL / remote 三种项目类型（P0，第一版全量支持）

## 开发阶段（后端先行）

### Phase 1: 后端 Rust — 数据层闭环

**目标**：所有 Tauri 命令可用，前端能拿到数据。

| 步骤 | 产出 | 验证 |
|------|------|------|
| 1.1 新增 `CommitInfo` 类型（state.rs + types.ts） | 类型定义 | `cargo check` + `tsc --noEmit` |
| 1.2 实现 `get_commit_log`（local） | 50 条提交日志 | 手动调用验证 |
| 1.3 实现 `get_commit_detail`（local） | 单个提交详情+文件列表 | 手动调用验证 |
| 1.4 实现 `get_all_branches`（local） | 分支列表（Local/Remote/Tags） | 手动调用验证 |
| 1.5 实现 WSL 版本命令 | WSL 三命令 | Windows 验证 |
| 1.6 实现 Remote 版本命令 | Remote 三命令 | SSH 验证 |
| 1.7 注册所有命令到 `lib.rs` | generate_handler! 更新 | 编译通过 |

### Phase 2: 前端组件 — UI 层

**目标**：三栏组件可渲染，用真实数据。

| 步骤 | 产出 | 验证 |
|------|------|------|
| 2.1 ActivityBar Git 图标 + 入口切换 | 视图切换可用 | 点击进入/退出 |
| 2.2 BranchList 组件 | 左栏分支列表 | 渲染正确 |
| 2.3 CommitLog 组件 | 中栏提交列表 | 渲染+点击选中 |
| 2.4 CommitDetail + CommitFileList 组件 | 右栏详情 | 渲染+文件点击 |
| 2.5 GitToolbar 组件（搜索+筛选） | 顶部工具栏 | 搜索过滤正常 |
| 2.6 集成 DiffView 到右栏 | 文件 Diff | 复用现有 DiffView |
| 2.7 GitBranchPanel 主面板编排 | 三栏联动 | 端到端流程 |

### Phase 3: 集成+打磨

| 步骤 | 产出 | 验证 |
|------|------|------|
| 3.1 New Branch / Delete Branch 对话框 | 分支操作 | 操作后刷新 |
| 3.2 右键菜单 | Checkout / Merge / Rename | 操作正常 |
| 3.3 WSL/Remote 源适配 | DiffSource 统一 | 三种类型通测 |
| 3.4 TypeScript + Rust 类型检查 | 零错误 | `tsc --noEmit` + `cargo check` |
| 3.5 提交可视化图（P1） | 拓扑连线 | 视觉验证 |

## 组件设计

```
src/components/git/
├── index.ts                    # barrel export
├── GitBranchPanel.tsx          # 主面板（三栏编排）
├── BranchList.tsx              # 左栏：分支列表
├── BranchGroup.tsx             # 分组（Local/Remote/Tags）
├── CommitLog.tsx               # 中栏：提交日志
├── CommitGraph.tsx             # 提交可视化图（可选 P1）
├── CommitDetail.tsx            # 右栏：提交详情
├── CommitFileList.tsx          # 修改文件列表
└── GitToolbar.tsx              # 顶部搜索+筛选工具栏
```

## 新增文件清单

### 后端 (Rust)

| 文件 | 变更 | 说明 |
|------|------|------|
| `src-tauri/src/state.rs` | 修改 | 新增 `CommitInfo` 类型 |
| `src-tauri/src/git/local.rs` | 修改 | 新增 `get_commit_log`、`get_commit_detail`、`get_all_branches` 函数 |
| `src-tauri/src/lib.rs` | 修改 | 注册新 Tauri 命令 |

### 前端 (React)

| 文件 | 变更 | 说明 |
|------|------|------|
| `src/types.ts` | 修改 | 新增 `CommitInfo` 类型 |
| `src/components/git/*.tsx` | 新增 | 8 个组件文件 |
| `src/components/git/index.ts` | 新增 | barrel export |
| `src/components/layout/AppLayout.tsx` | 修改 | 集成 GitBranchPanel 到 MainContent |
| `src/components/layout/ActivityBar.tsx` | 修改 | 新增 Git 图标入口 |

## 验收标准

- [ ] 分支列表正确显示 Local / Remote / Tags
- [ ] 当前分支用 ★ 标识
- [ ] 分组折叠展开正常
- [ ] 点击分支加载对应提交历史
- [ ] 提交列表显示哈希 + 作者 + 时间 + 消息
- [ ] 搜索框支持文本和哈希搜索
- [ ] 分支 / 用户 / 日期筛选正常
- [ ] 点击提交加载详情和修改文件列表
- [ ] 点击文件显示 Diff（复用 DiffView）
- [ ] Unified / Split 切换正常
- [ ] New Branch 对话框正常
- [ ] Delete Branch 有确认提示
- [ ] Checkout 分支后界面刷新
- [ ] 所有组件使用 `React.memo`
- [ ] TypeScript 类型检查通过 (`pnpm tsc --noEmit`)
- [ ] Rust 编译通过 (`cargo check`)

## 与 git-commit-panel 的关系

Git Branch Detail 是独立全屏视图，Git Commit Panel 是 RightPanel Tab。两者共享基础设施但入口独立：

```
ActivityBar [Git 图标] → MainContent → GitBranchPanel（全屏三栏）
RightPanel [Commit Tab] → GitCommitPanel（右侧面板）
```

共享基础设施：
- DiffView 组件（两侧都用）
- FileTree 组件（两侧都用）
- Git 操作 hooks（分支创建、切换等）
- 类型定义（FileChange、GitInfo、CommitInfo）
- Tauri 命令（get_commit_log、get_commit_detail、get_all_branches）

## 技术笔记

### git2-rs 提交日志

```rust
// 获取提交日志
let repo = Repository::open(path)?;
let mut revwalk = repo.revwalk()?;
revwalk.set_sorting(git2::Sort::TIME)?;
revwalk.push_head()?;
for oid in revwalk.take(50) {
    let commit = repo.find_commit(oid?)?;
    // 提取 hash, author, time, message
}
```

### 按分支筛选

```rust
// 获取特定分支的提交
let branch = repo.find_branch(&name, BranchType::Local)?;
let target = branch.get().target().unwrap();
revwalk.push(target)?;
```

### 搜索实现

搜索在前端过滤（先加载 100 条，前端搜索+筛选）。如果需要按哈希精确查找，走后端 `get_commit_by_hash` 命令。
