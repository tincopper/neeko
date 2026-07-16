# 执行计划

## 实现顺序

### Step 1: 创建 SplitPane 组件 (src/shared/components/SplitPane.tsx)

- 通用横向可拖拽分割面板
- 支持 `defaultLeftWidth`、`minLeftWidth`、`minRightWidth`
- 基于 mousedown/mousemove/mouseup 实现
- 拖拽时临时禁止文本选中

### Step 2: 创建 FileStatsBar 组件 (src/features/git/components/pr-detail/FileStatsBar.tsx)

- 接收 `files: PRFileChange[]` prop
- 计算总文件数、总增删行数
- 渲染紧凑文案：`42 files changed  +1,024  -387`
- 使用绿/红文字色区分增删

### Step 3: 创建 InlineDiffPreview 组件 (src/features/git/components/pr-detail/InlineDiffPreview.tsx)

- 接收 `projectId: string`, `filePath: string | null`
- 使用 `useDiffData` hook 加载 diff
- filePath 为 null 时显示占位文本
- 简洁工具栏：unified/split 切换按钮
- 不包含 AI review、block 导航、line selection
- 利用现有 DiffTable / SplitDiffTable 渲染

### Step 4: 重构 PRFileTree 添加选中高亮

- 新增 `selectedPath?: string` prop
- 选中文件行添加 `bg-accent-blue/10` 或 `bg-bg-active` 背景色

### Step 5: 重构 PRDetailView

- 移除当前两栏 `flex` + `w-[35%]` div 结构
- 添加 `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/ui/tabs`
- 三个 Tab：
  - **Conversation**: 顶部 FileStatsBar + 现有右侧内容（description, commits, timeline, comments）
  - **Commits**: PRCommitList 全宽
  - **Files Changed**: SplitPane (PRFileTree 左 | InlineDiffPreview 右)
- 管理 `selectedFile` 状态并在 Tab 切换时保留
- 导入需要的新组件

### Step 6: 验证

```bash
pnpm lint
pnpm type-check
pnpm test:run
```

## 回滚点

- 每次 Step 完成后 `git add` + 阶段性 commit（不 push）
- 如某步失败，`git checkout -- .` 回退到上一个 commit

## Review Gates

- Step 5 完成后需 `cargo check`（后端不受影响但也执行确认）
- 验收标准对照 prd.md 的 Acceptance Criteria 逐条验证
