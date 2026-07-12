# 技术设计

## 组件树（修改后）

```
PRDetailView
├── Header (PR title + state badge + metadata — 全宽)
├── FileStatsBar — 紧凑文件统计 (仅 Conversation Tab 顶部)
├── Tabs (shadcn/ui)
│   ├── TabsList: [Conversation] [Commits] [Files Changed]
│   ├── TabsContent value="conversation"
│   │   ├── PRDescription
│   │   ├── PRCommitList
│   │   ├── PRTimeline
│   │   ├── PRCommentList
│   │   └── PRCommentInput
│   ├── TabsContent value="commits"
│   │   └── PRCommitList (复用)
│   └── TabsContent value="files-changed"
│       └── SplitPane (可拖拽)
│           ├── Left: PRFileTree
│           └── Right: InlineDiffPreview
│               ├── Diff toolbar (unified/split toggle)
│               └── DiffTable / SplitDiffTable
```

## 组件变更清单

### 新增组件

| 组件 | 文件 | 职责 |
|---|---|---|
| `InlineDiffPreview` | `src/features/git/components/pr-detail/InlineDiffPreview.tsx` | 接收 filePath + projectId，调用 `getFileDiff` 加载 diff，渲染简洁 diff 视图（DiffTable / SplitDiffTable） |
| `FileStatsBar` | `src/features/git/components/pr-detail/FileStatsBar.tsx` | 显示 `N files changed · +A -D` 的紧凑统计条 |
| `SplitPane` | `src/shared/components/SplitPane.tsx` | 通用可拖拽分割面板（横向），支持 min/max 约束 |

### 修改组件

| 组件 | 修改内容 |
|---|---|
| `PRDetailView` | 移除两栏 div 结构，改为 Tabs + TabsContent 结构 |
| `PRFileTree` | 新增 `selectedPath` prop 用于高亮选中文件 |

### 提取（可选重构）

| 现有代码 | 提取目标 |
|---|---|
| `DiffView.tsx` 中的 diff 渲染体 | 可考虑提取 `DiffRenderer` 纯展示组件供 DiffView 和 InlineDiffPreview 共用，但不是 MVP 必须 |

## 状态管理

### PRDetailView 内部状态

```typescript
// Tab 切换
const [activeTab, setActiveTab] = useState<string>("conversation");

// Files Changed Tab 内选中文件
const [selectedFile, setSelectedFile] = useState<string | null>(null);

// Files Changed Tab 内 diff view mode
const [diffViewMode, setDiffViewMode] = useState<ViewMode>("unified");
```

`selectedFile` 在 Tab 切离 Files Changed 时保留，切回时恢复选中状态。

### 数据流

```
用户单击文件树文件
  → setSelectedFile(filePath)
  → InlineDiffPreview 收到 filePath 变化
  → useDiffData (复用现有 hook) 触发 getFileDiff 请求
  → diffResult 更新
  → DiffTable / SplitDiffTable 重新渲染
```

## SplitPane 实现

不引入外部库，自实现轻量 SplitPane：

```typescript
interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLeftWidth?: number; // px
  minLeftWidth?: number;
  minRightWidth?: number;
}
```

实现方式：基于 mousedown/mousemove/mouseup 事件调整左侧宽度（px），拖拽时添加 `user-select: none` 防止选中。

## InlineDiffPreview 实现

基于现有 `useDiffData` hook + `DiffTable` / `SplitDiffTable`：

```typescript
interface InlineDiffPreviewProps {
  projectId: string;
  filePath: string | null;
}
```

- `filePath === null` 时显示占位文案 "Select a file to preview"
- 复用 `useDiffData` hook（传 projectId + filePath，不传 diffSource）
- 简化工具栏：只保留 unified/split 切换
- 去掉 AI review、block 导航、line selection 等复杂交互

## 样式注意事项

- Tab 内容切换时使用 shadcn Tabs 的 `TabsContent` 自带的显示/隐藏，无需额外动画
- Files Changed 中的 SplitPane 占满 Tab 内容区
- 紧凑文件统计条与 GitHub 对齐：`<number> files changed  <green>+N</green>  <red>-M</red>`

## 测试策略

- 前端组件测试：验证 Tab 切换、文件选中、SplitPane 拖拽行为
- 集成测试：验证 `PRDetailView` 正确渲染三个 Tab 内容区域
- 回归测试：验证独立 DiffView tab 不受影响
