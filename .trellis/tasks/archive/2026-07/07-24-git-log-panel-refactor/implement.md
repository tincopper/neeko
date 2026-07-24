# Git Log 面板重构优化 — 实施计划

## 阶段划分

分 4 个阶段执行，按顺序推进。每阶段独立可验证，完成后需通过质量门禁。

---

## 阶段 1：面板注册

添加 `gitLog` dock panel ID，使其可在右侧面板区域打开/关闭。

### 1.1 — panelMeta.ts 注册

**文件**: `src/shared/dock/panelMeta.ts`

- 在 `DOCK_PANEL_META` 中新增 `gitLog` 条目：`defaultZone: 'right'`, `defaultOrder: 6`
- 在 `DockPanelId` 联合类型中添加 `'gitLog'`

### 1.2 — registry.ts UI 绑定

**文件**: `src/app/dock/registry.ts`

- 在 `UI_BINDINGS` 中添加 `gitLog`：`title: 'Git Log'`, `icon: 'GitBranch'`
- `component`: `lazy(() => import('./DockPanelWrappers').then(m => ({ default: m.GitLogPanelWrapper })))`
- `minPanelSize: 280`

### 1.3 — DockPanelWrappers.tsx 占位 Wrapper

**文件**: `src/app/dock/DockPanelWrappers.tsx`

- 新增 `GitLogPanelWrapper`（zero-props React.FC），内容为临时占位：
  ```tsx
  export const GitLogPanelWrapper: React.FC = () => {
    return <div className="flex h-full items-center justify-center text-text-muted">Git Log Panel (WIP)</div>;
  };
  ```
- 导出 `GitLogPanelWrapper`

### 阶段 1 验证

- [ ] `pnpm type-check` 通过
- [ ] Dock bar 出现 Git Log 按钮，点击可打开/关闭右侧面板
- [ ] 面板显示 "Git Log Panel (WIP)" 占位内容

---

## 阶段 2：GitLogPanel 重构（内联展开）

将 GitLogPanel 从自包含全屏组件重构为纯展示组件，实现 commit 内联展开/折叠。

### 2.1 — GitLogPanel.tsx 重构

**文件**: `src/features/git/components/gitlog/GitLogPanel.tsx`

变更：
- 组件改为纯展示（全部数据/回调由 props 注入）
- 移除内部 `useGitLog`、`useCommitDetail` 调用
- 移除 `handleDividerMouseDown` 和左右分栏布局（divider drag resize）
- 移除 `CommitDetailPanel` 渲染
- 移除 `handleOpenDiff` 和 `handleAction` 逻辑
- Props 接口：

```typescript
interface GitLogPanelProps {
  commits: CommitEntry[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  refresh: () => void;
  selectedHash: string | null;
  selectedExpanded: boolean;
  searchQuery: string;
  combined: boolean;
  detail: CommitDetail | null;
  files: CommitFileChange[];
  detailLoading: boolean;
  detailError: string | null;
  onSelectCommit: (hash: string) => void;
  onOpenDiff: (filePath: string) => void;
  onPinFile: (filePath: string) => void;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  onToggleCombined: (combined: boolean) => void;
}
```

- 布局改为纵向：`LogToolbar` → `CommitList`（带 Graph + 内联展开）

### 2.2 — CommitList.tsx 内联展开

**文件**: `src/features/git/components/gitlog/CommitList.tsx`

- 新增 props：`selectedExpanded`, `detail`, `files`, `detailLoading`, `onOpenDiff`, `onPinFile`, `combined`
- 选中且 expanded 的 commit row 下方渲染 `commit-expand` 区域
- 展开区域结构：
  - erow: hash + type badge + refs
  - esubj: commit subject（大字号）
  - erow: author · parents · Diff tab 状态
  - efiles: 文件列表（status图标 + path + +n/-n 统计）
- 点击展开区域文件：`e.stopPropagation()` → `onOpenDiff(filePath)`
- 双击文件：`e.stopPropagation()` → `onPinFile(filePath)`
- `commit-row` 的 onClick 中判断 `if (e.target.closest('.commit-expand')) return;` 避免误折叠
- TSX 结构参考 prototype.html 的渲染输出

### 2.3 — CommitDetailPanel.tsx 引用清理

**文件**: `src/features/git/components/gitlog/CommitDetailPanel.tsx`

- 保留文件（供未来其他场景复用），但确认 `GitLogPanel.tsx` 中已移除其导入

### 2.4 — GitLogPanelWrapper 连接数据

**文件**: `src/app/dock/DockPanelWrappers.tsx`

用真实实现替换阶段 1 的占位：
- 调用 `useActiveProject()` 获取 `commands/connectionContext`
- 调用 `useGitLog(commands)` 获取 commits 数据
- 调用 `useCommitDetail(commands, selectedHash)` 获取 detail/files
- 管理 `useState`: selectedHash, selectedExpanded, searchQuery, combined
- 实现 `handleSelectCommit(hash)`：
  - same hash → toggle `selectedExpanded`
  - diff hash → `selectedExpanded = true` + `setSelectedHash(hash)`
- 实现 `handleOpenDiff(filePath)`：在阶段 3 接入 useSingletonDiff
- 实现 `handlePinFile(filePath)`：创建 `diff_pinned_<path>` 独立 diff tab
- 渲染 `<GitLogPanel>` 传入所有 props

### 阶段 2 验证

- [ ] 面板中点击 commit 展开内联详情，再次点击折叠
- [ ] 展开区域内容正确（hash、subject、author、parents、文件列表）
- [ ] 点击展开区域内的文件触发 onOpenDiff（但此时 Diff tab 尚未实现，仅打印 log 或 toast）
- [ ] 点击展开区域空白处不触发折叠
- [ ] 搜索过滤正常（searchQuery 过滤 commits）
- [ ] `pnpm type-check` 通过

---

## 阶段 3：Diff Tab 单例复用 + 组合查看

### 3.1 — DiffTabData 类型扩展

**文件**: `src/features/editor/types.ts`

- 在 `DiffTabData` 中新增 `combined?: boolean`

**文件**: `src/shared/store/editorStore.ts`

- 在 `mergeTabData` 的 `case "diff"` 分支中增加 `combined` 字段合并逻辑

### 3.2 — useSingletonDiff Hook

**文件**: `src/features/git/hooks/useSingletonDiff.ts`（新增）

```typescript
const DIFF_TAB_ID = 'diff_singleton';

function useSingletonDiff(project, selectedHash, files, connectionContext) {
  const tabKey = useProjectStore.getState().activeProjectId ?? project?.id;

  function buildDiffSource(filePath: string): DiffSource {
    // 复用现有 handleOpenDiff 中的 connectionContext.type 分发逻辑
    // type: 'commit' | 'wsl-commit' | 'remote-commit'
  }

  function ensureDiffTab(filePath?: string, combined?: boolean) {
    const store = useEditorStore.getState();
    const existing = /* find tab by DIFF_TAB_ID */;
    if (existing) {
      store.updateTab(tabKey, DIFF_TAB_ID, {
        filePath: filePath ?? existing.data.filePath,
        fileName: filePath?.split('/').pop() ?? existing.data.fileName,
        diffSource: buildDiffSource(filePath ?? existing.data.filePath),
        combined: combined ?? false,
      });
      store.activateTab(tabKey, DIFF_TAB_ID);
    } else {
      const path = filePath ?? files[0]?.path ?? '';
      store.addTab(tabKey, {
        id: DIFF_TAB_ID,
        projectId: tabKey,
        title: combined
          ? `Diff · ${selectedHash.slice(0,7)} · ${files.length} files`
          : `Diff · ${path.split('/').pop()}`,
        order: 200,
        data: { kind: 'diff', filePath: path, fileName: path.split('/').pop(), diffSource: buildDiffSource(path), combined },
      });
      store.activateTab(tabKey, DIFF_TAB_ID);
    }
  }

  function openFileInDiff(filePath: string) {
    ensureDiffTab(filePath, false);  // 单文件模式
  }

  function openCombined() {
    ensureDiffTab(undefined, true);  // 组合模式
  }

  return { openFileInDiff, openCombined, ensureDiffTab, DIFF_TAB_ID };
}
```

### 3.3 — DiffView.tsx 组合模式支持

**文件**: `src/features/git/components/diff/DiffView.tsx`

- 扩展 props：`combined?: boolean`, `files?: CommitFileChange[]`, `scrollToPath?: string`
- 组合模式下：
  1. 遍历 `files` 数组
  2. 为每个文件调用 `useDiffData({ ..., filePath: f.path })`（模块级 `diffCache` 去重）
  3. 每个文件渲染一个 `file-block`：
     ```tsx
     <section className="file-block" id={`fileblock-${f.path.replaceAll('/', '_')}`}>
       <div className="file-block-head">
         <span className={`status ${f.status}`}>{f.status}</span>
         <span className="path">{f.path}</span>
         <span className="pill">+{f.additions} -{f.deletions}</span>
       </div>
       {/* DiffTable 组件渲染该文件 hunks */}
     </section>
     ```
  4. `scrollToPath` 变化时 `scrollIntoView` 定位对应 file-block
- 单文件模式：行为不变（现有逻辑）

### 3.4 — GitLogPanelWrapper 集成 useSingletonDiff

- 调用 `useSingletonDiff(project, selectedHash, files, connectionContext)`
- `handleOpenDiff(filePath)` 替换为 `openFileInDiff(filePath)`
- `handleToggleCombined(on)` 中：
  - `setCombined(on)`
  - 若 `on === true` → `openCombined()`
  - 若 `on === false` → `ensureDiffTab(currentFile, false)`

### 3.5 — editorStore.ts 清理 gitLog tab 类型

**文件**: `src/features/editor/types.ts`
- `TabKind` 联合类型中移除 `'gitLog'`
- 移除 `GitLogTabData` 接口

**文件**: `src/shared/store/editorStore.ts`
- `mergeTabData` 中移除 `case "gitLog"` 分支
- 添加 `default` 兜底：未知 kind → 返回原始 data（持久化兼容）

### 阶段 3 验证

- [ ] 单击文件复用同一个 Diff tab（id 始终为 `diff_singleton`）
- [ ] 不同文件切换时 Diff tab 标题更新
- [ ] 切换 commit 后 Diff tab 内容刷新（diffSource.commitHash 更新）
- [ ] 组合模式：Diff tab 展示所有文件纵向排列
- [ ] 组合模式：点击文件后 scrollIntoView 定位
- [ ] 组合模式开关关闭后回到单文件模式
- [ ] 双击文件创建独立 diff tab（id: `diff_pinned_<path>`）
- [ ] `pnpm type-check` 通过

---

## 阶段 4：键盘快捷键 + 回归测试

### 4.1 — 键盘快捷键

**文件**: `src/app/dock/DockPanelWrappers.tsx`

在 `GitLogPanelWrapper` 中添加 `useEffect` + `keydown` 监听：

| 键 | 行为 |
|----|------|
| J  | 下一个 commit: `selectCommit(list[ci + 1].hash)` |
| K  | 上一个 commit: `selectCommit(list[ci - 1].hash)` |
| j  | 下一个文件: `openFileInDiff(files[fi + 1].path)` |
| k  | 上一个文件: `openFileInDiff(files[fi - 1].path)` |
| c  | 切换 combined: `setCombined(!combined)` |

- `input`/`textarea` 聚焦时跳过
- `J/K` 使用大写键码区分（避免与 vim 导航冲突）
- 面板关闭时 Wrapper 未挂载，快捷键自然失效（符合预期）

### 4.2 — 回归测试

- 确认 gitCommit 面板功能不受影响（打开/关闭/commit 提交）
- 确认 PRs 面板功能不受影响
- 已打开 Diff tab 后切换到其他 tab，再切回 Diff tab 仍显示正确内容
- WSL 项目：打开 Git Log 面板，确认 commands 正常注入
- `pnpm lint` 通过
- `pnpm test:run` 通过
- `cargo test --manifest-path src-tauri/Cargo.toml` 通过

### 阶段 4 验证

- [ ] J/K 切换 commit，j/k 切换文件，c 切换组合
- [ ] gitCommit 面板不变
- [ ] `pnpm lint && pnpm type-check && pnpm test:run` 全部通过

---

## 回滚计划

每阶段完成后通过 git commit 记录：

```bash
git add -A
git commit -m "feat(git-log): phase N — <阶段描述>"
```

若某阶段导致问题：
```bash
git revert <hash>
```

## 质量门禁（每阶段必须通过）

```bash
pnpm lint
pnpm type-check
pnpm test:run
cargo test --manifest-path src-tauri/Cargo.toml
```