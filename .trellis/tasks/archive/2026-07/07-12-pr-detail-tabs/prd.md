# PR 详情页三 Tab 重构：Conversation / Commits / Files Changed

## Goal

将 PR 详情页的两栏布局（左侧文件树 + 右侧内容）改为 GitHub 风格的三 Tab 布局，让用户在 Conversation、Commits、Files Changed 之间切换，每 Tab 使用全宽展示。

## Requirements

### 1. Tab 导航

- 使用 `src/ui/tabs.tsx`（shadcn Tabs）实现三 Tab 切换
- Tab 栏位于 PR 详情页顶部，样式与 GitHub 对齐：分隔线 + active 下划线

### 2. Conversation Tab

- 全宽显示 PR 描述 + 提交列表 + 时间线 + 评论（复用现有 `PRDescription`、`PRCommitList`、`PRTimeline`、`PRCommentList`、`PRCommentInput`）
- 顶部紧凑文件统计条：仅数字 + 状态徽标（如 `42 files changed  +1,024  -387`），不可展开为树
- **保留 Commits 列表**在 Conversation 中（与当前一致）

### 3. Commits Tab

- 独立全宽提交列表
- 默认展示现有 `PRCommitList` 内容（hash、message、author、timestamp）
- 可与 Conversation 中的 commits 列表一致或更详细

### 4. Files Changed Tab

- SplitPane 布局：左侧文件树（可拖拽调节宽度）+ 右侧 Inline Diff 预览
- **文件树**：复用 `PRFileTree` / `ChangeFileTree`
- **Inline Diff 预览**：单击文件树中的文件，右侧即时渲染该文件的 diff 差异
  - 不打开独立 Diff 编辑 tab
  - 复用现有 diff 渲染管线（`DiffTable` / `SplitDiffTable`）
  - 简洁工具栏：unified/split 切换
  - 去掉 AI review、terminal、block 导航等当前 DiffView 的外围功能

### 5. 无需修改后端

不新增 Rust 命令。For diff 数据，使用现有 `getFileDiff` API + 项目 transport。

## Constraints

- Tab 切换不应丢失当前选中的文件（选中文件状态保持在 Files Changed Tab 内）
- 现有 DiffView（独立 tab）不受影响
- 现有 PRDetailView 的文件树 + 内容双栏布局被替换，无向后兼容要求

## Acceptance Criteria

- [ ] Conversation Tab 全宽展示描述、提交列表、时间线、评论，顶部显示紧凑文件统计
- [ ] Commits Tab 全宽展示提交列表
- [ ] Files Changed Tab 左侧文件树可切换选中文件，右侧即时显示 diff
- [ ] Tab 切换时不同 Tab 内容正确切换显示/隐藏
- [ ] SplitPane 可拖拽调节左右比例
- [ ] `pnpm lint`、`pnpm type-check`、`pnpm test:run` 通过
