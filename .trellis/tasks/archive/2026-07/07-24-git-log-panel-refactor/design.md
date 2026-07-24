# Git Log 面板重构优化 — 设计文档

## 架构总览

### 当前架构

```
用户点击 Git Log
  → 编辑器创建 `gitLog` 类型 Tab
  → GitLogPanel 渲染在中心编辑区
  → 点文件时创建独立 Diff Tab（每文件一个 tab）
```

### 目标架构

```
用户点击 Dock bar Git Log 按钮
  → DockStore.togglePanel('gitLog')
  → 右侧面板区域打开 GitLogPanel
  → 面板内展开 commit 详情（内联）
  → 点文件 → 复用编辑器唯一 Diff Tab
  → 组合模式 → Diff Tab 展示多文件滚动
```

## 变更清单

### 1. panelMeta.ts — 注册 gitLog 面板

```typescript
gitLog: {
  id: 'gitLog',
  defaultZone: 'right',
  defaultOrder: 6,
}
```

同时更新 `DockPanelId` 联合类型。

### 2. registry.ts — UI 绑定

```typescript
gitLog: {
  title: 'Git Log',
  icon: 'GitBranch',          // 复用 lucide-react GitBranch 图标
  component: lazy(() => import('./DockPanelWrappers').then(m => ({ default: m.GitLogPanelWrapper }))),
  minPanelSize: 280,
},
```

图标复用已有的 `GitBranch`（lucide-react），无需新增图标定义。

### 3. DockPanelWrappers.tsx — Wrapper 组件

新增 `GitLogPanelWrapper`（zero-props React.FC），职责：

```
GitLogPanelWrapper
 ├─ useActiveProject() → { project, commands, capabilities, connectionContext }
 ├─ useState: selectedHash, selectedExpanded, searchQuery, combined
 ├─ useGitLog(commands) → { commits, loading, hasMore, loadMore, refresh }
 ├─ useCommitDetail(commands, selectedHash) → { detail, files, loading }
 ├─ useSingletonDiff(project, selectedHash, files, connectionContext)
 │    提供: openFileInDiff(filePath), ensureDiffTab(), closeDiff()
 │
 ├─ handleSelectCommit(hash)
 │    ├─ same hash → toggle selectedExpanded
 │    └─ diff hash → selectedExpanded=true + setSelectedHash
 │
 ├─ handleOpenDiff(filePath)
 │    ├─ combined=true → ensureDiffTab + scrollToFile
 │    └─ combined=false → ensureDiffTab (单文件模式)
 │
 ├─ handlePinFile(filePath)
 │    └─ editorStore.addTab(uniqueKey, { kind: 'diff', id: 'diff_pinned_<path>' })
 │       — 独立 diff tab，不占用 singletion ID
 │
 └─ render <GitLogPanel> (纯展示组件, 全部 props 注入)
```

**`handlePinFile` 澄清**：钉住文件创建的是独立的 diff tab（`diff_pinned_<escaped_path>`），而非 `kind: 'file'` 的 file tab。因为 `FileTabData` 必须包含真实的 `FileContent`，而仅从 git log 中选择文件不持有文件内容。

### 4. GitLogPanel.tsx — 面板主体重构

**重构前**：自包含组件（useGitLog + useCommitDetail），左右分栏布局（CommitList + CommitDetailPanel + DividerResize），全屏渲染在编辑器 Tab 中。

**重构后**：纯展示组件（全部数据由 props 注入），纵向流式面板：

```
+---------------------------+
|  LogToolbar (搜索/刷新)    |
+---------------------------+
|  commit-scroll:           |
|   +-------+-------------+ |
|   | Graph | Commit List | |
|   | (SVG) | • l1: subject| |
|   |       | • l2: meta   | |
|   |       | • [expanded] | |
|   |       |   - detail   | |
|   |       |   - files[]  | |
|   +-------+-------------+ |
+---------------------------+
```

关键变更：
- **移除**右侧 CommitDetailPanel（详情内联到 commit 行展开区域）
- **移除**左右分栏拖拽 resize 逻辑（handleDividerMouseDown）
- **新增** `selectedExpanded` 状态控制内联展开/折叠
- **新增** `combined` 状态控制组合查看模式
- Graph + Commit 列表的横向布局保留（flex-row）
- Graph SVG 渲染逻辑复用现有 `CommitGraph` 组件

### 5. CommitList.tsx — 内联展开

- 选中 commit 时在 commit row 下方插入展开区域（`commit-expand`）
- 展开区域显示：hash、type badge、refs、subject、author、parents、changed files 列表
- 文件列表支持单击（`onOpenDiff`，复用 Diff tab）和双击（`onPinFile`，钉住 diff tab）
- 点击展开区域内部不触发折叠：`e.target.closest('.commit-expand')` 提前 return
- 展开区域视觉：左边框 (`border-left`) + 左缩进 (`padding-left`) 形成层级感

### 6. Diff Tab 单例机制 + 组合模式

#### 6.1 DiffTabData 类型扩展

扩展 `src/features/editor/types.ts` 的 `DiffTabData`：

```typescript
export interface DiffTabData {
  kind: "diff";
  filePath: string;
  fileName: string;
  diffSource: DiffSource;
  initialMode?: ViewMode;
  combined?: boolean;   // ← 新增
}
```

同时更新 `editorStore.ts` 中 `mergeTabData` 的 `case "diff"` 分支，使 `combined` 可通过 `updateTab` 更新。

#### 6.2 useSingletonDiff Hook（新增）

**文件**: `src/features/git/hooks/useSingletonDiff.ts`

```typescript
function useSingletonDiff(project, selectedHash, files, connectionContext) {
  const DIFF_TAB_ID = 'diff_singleton';

  function ensureDiffTab(filePath?: string) {
    // 查找或创建 Diff tab
    // 非组合模式: 每次更新 filePath + diffSource
    // 组合模式: 更新 combined=true，filePath 为第一文件
  }

  function openFileInDiff(filePath: string) {
    if (combined) {
      ensureDiffTab(filePath);  // → DiffView 渲染组合视图 + 滚动定位
    } else {
      ensureDiffTab(filePath);  // → DiffView 渲染单文件 diff
    }
  }

  function closeDiff() {
    editorStore.closeTab(tabKey, DIFF_TAB_ID);
  }

  return { openFileInDiff, ensureDiffTab, closeDiff };
}
```

#### 6.3 组合模式 Diff 加载

组合模式下 DiffView 需要渲染一个 commit 的**所有文件 diff**。实现方案：

**方案：DiffView 内置组合模式迭代加载**

`DiffView` 接收 `combined` prop 和 `files`（CommitFileChange[]）prop。在组合模式下：

1. DiffView 遍历 `files`，为每个文件调用 `useDiffData`（模块级 `diffCache` 自动去重）
2. 每个文件渲染一个 `file-block`（file header + hunk lines）
3. 通过文件路径 ID 定位实现 `scrollToFile`
4. `loading` 状态取所有文件加载状态聚合（任一未完成即显示 loading）

选择此方案的原因：
- 无需新增后端 Tauri 命令
- 利用已有的模块级 `diffCache`（`useDiffData.ts` 中 Map）减少重复请求
- `useDiffData` 的缓存（cacheKey = `${projectId}|${diffSource}|${filePath}`）天然支持多文件迭代

DiffView props 变化：

```typescript
interface DiffViewProps {
  projectId?: string;
  diffSource?: DiffSource;
  filePath: string;          // 单文件模式下的文件路径
  files?: CommitFileChange[]; // ← 新增：组合模式下的文件列表
  combined?: boolean;        // ← 新增
  initialMode?: ViewMode;
  scrollToPath?: string;     // ← 新增：组合模式下滚动定位目标
}
```

### 7. editorStore.ts — 清理

- 移除 `kind: 'gitLog'` 的 `TabData` 分支（`GitLogTabData` 类型及其 `case "gitLog"` 分支）
- 移除 `TabKind` 联合类型中的 `'gitLog'`
- 兼容性：持久化状态中可能残留 `gitLog` tab，`mergeTabData` 遇到未知 kind 时丢弃该 tab

### 8. 键盘快捷键

在 `GitLogPanelWrapper` 中通过 `useEffect` + `keydown` 事件监听实现：

| 快捷键 | 作用 |
|--------|------|
| J     | 下一个 commit |
| K     | 上一个 commit |
| j     | 文件列表中下一个文件 |
| k     | 文件列表中上一个文件 |
| c     | 切换组合模式 |

- `input`/`textarea` 聚焦时跳过快捷键
- 面板关闭时快捷键不生效（Wrapper 未挂载，符合预期——gitLog 面板是操作目标）
- **不提供** `g` 全局快捷键（全局快捷键需在 AppLayout 层实现，超出本次 PRD 范围）

### 9. 数据流

```
GitLogPanelWrapper
 ├─ useGitLog(commands) → { commits, loading, hasMore, loadMore, refresh }
 ├─ useCommitDetail(commands, selectedHash) → { detail, files, loading }
 ├─ useSingletonDiff(...) → { openFileInDiff, ensureDiffTab, closeDiff }
 ├─ useState: selectedHash, selectedExpanded, searchQuery, combined
 │
 ├─ handleSelectCommit(hash)
 │   └─ setSelectedHash → useCommitDetail 自动刷新
 │   └─ setSelectedExpanded(true) / toggle if same hash
 │
 ├─ handleOpenDiff(filePath)
 │   └─ openFileInDiff(filePath)
 │        ├─ 单文件: ensureDiffTab(filePath) → diffSource更新为当前commit+file
 │        └─ 组合: ensureDiffTab(filePath) → diffSource不变, combined=true, scrollToFile
 │
 ├─ handlePinFile(filePath)
 │   └─ editorStore.addTab({ id: 'diff_pinned_<path>', kind: 'diff', ... }) — 独立 diff tab
 │
 ├─ handleToggleCombined()
 │   └─ setCombined → 若 Diff tab 已打开则 refresh combined 状态
 │
 └─ render: GitLogPanel (纯展示组件, 全部 props 注入)
```

## 边界情况与注意事项

1. **面板关闭再打开**：selectedHash、selectedExpanded 等 UI 状态重置（非持久化）。commits 数据由 `useGitLog` 重新加载。
2. **Diff tab 关闭再打开**：单例 ID 被移除后重新创建即可，无状态残留。
3. **WSL/Remote 项目**：DiffSource 构造逻辑复用现有 `handleOpenDiff` 逻辑，根据 `connectionContext.type` 分发。
4. **Diff tab 在组合/单文件间切换**：`ensureDiffTab` 检测 `combined` 状态，更新 tab data 中的 `combined` 字段。
5. **commit 切换时 activePath 无效**：当切换到不包含当前 activeFile 的 commit 时，自动 reset 到该 commit 的第一文件。
6. **组合模式 diff 缓存**：`useDiffData` 的模块级 `diffCache` 使用 `cacheKey = "${projectId}|${diffSource}|${filePath}"`，同一 session 内相同 commit+file 只请求一次。
7. **双文件对比**：钉住文件创建的 diff tab（id: `diff_pinned_<path>`）与单例 ID 不同，不会被 `ensureDiffTab` 覆盖。