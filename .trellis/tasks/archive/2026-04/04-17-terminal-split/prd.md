# Terminal Split (tmux-style)

## Goal

在终端区域支持 tmux 风格的面板分割（横向/纵向），替代原计划的 SideTerminal 方案。所有终端类型（Local / WSL / Remote）均需支持。

## Requirements

### 核心功能

1. 在终端区域支持横向（左右）和纵向（上下）分割
2. 每个 pane 是独立终端实例（独立 PTY session）
3. 所有终端类型均支持 split：Local / WSL / Remote
4. 有 focus 状态标识，键盘输入发送到 focus pane
5. 可以关闭单个 pane（最后一个 pane = 回到单终端状态）
6. Pane 间可拖拽调整大小（ratio）
7. Split 上限保护：最多 4 个 pane

### 替代 SideTerminal

8. Split 功能完全替代原计划的 SideTerminal
9. 移除/不实现 `sideMode` 相关逻辑
10. 原 `side_terminal_width` 字段清理

### UI 入口

11. Overlay 按钮：focused pane 右上角显示 split-h / split-v / close 按钮
12. Pane focused 时始终显示 toolbar，失去 focus 后 300ms fade-out
13. 键盘快捷键留待后续迭代

### UX 质量要求

14. 所有 icon-only 按钮必须有 `aria-label`
15. Drag handle 可见区域 4px，hit area 扩展到 12px
16. Active pane 使用 2px 边框 + ring shadow 标识
17. Pane 最小尺寸保护：min-width 120px / min-height 80px，ratio 限制 0.2~0.8
18. Disabled split 按钮使用 `opacity-50 cursor-not-allowed`
19. 新 pane 创建时显示 loading 指示，PTY ready 后切换到终端
20. Drag handle hover 高亮 + 拖拽中 body `user-select: none`
21. PaneToolbar z-index: 20，drag handle z-index: 10

## Acceptance Criteria

- [ ] 用户可在终端 pane 右上角点击按钮进行横向/纵向分割
- [ ] 分割后每个 pane 有独立 shell 会话
- [ ] 点击 pane 切换 focus，focus pane 有 2px 边框 + ring 标识
- [ ] 可拖拽 pane 间的分隔线调整大小（ratio 限制 0.2~0.8）
- [ ] 可关闭任意 pane，剩余 pane 自动填满空间
- [ ] Resize 窗口时所有 pane 正确 refit
- [ ] Local / WSL / Remote 终端均可 split
- [ ] 达到 4 pane 上限时 split 按钮 disabled（opacity-50 + cursor-not-allowed）
- [ ] Overlay 按钮有 aria-label，drag handle hit area >= 12px
- [ ] 新 pane 创建时有 loading 状态过渡

## Definition of Done

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes

## Out of Scope

- Split 布局持久化（后续迭代）
- 键盘快捷键触发 split（后续迭代）
- 跨 Tab 拖拽 pane
- Pane 间文本快捷拷贝
- Worktree 终端 split（Worktree 模式暂不支持）

## Decision (ADR-lite)

**Context**: 需要在终端内支持多 pane 分割，同时项目原计划的 SideTerminal 未完全实现。

**Decision**:
1. 采用**二叉树 Split 模型**，业界标准方案（iTerm2 / Windows Terminal / Warp 均采用）
2. **替代 SideTerminal**：SideTerminal 基础设施未完成，直接用 split 覆盖其使用场景
3. **终端类型无关的 SplitLayout 抽象**：通过 `renderPane` 回调适配 Local / WSL / Remote
4. **不引入新依赖**：复用项目已有的 mousedown/mousemove/mouseup resize 模式
5. **仅 overlay 按钮**作为 MVP 交互入口，键盘快捷键后续迭代
6. **最多 4 个 pane** 保护，防止过度 split

**Consequences**:
- 需要扩展三种终端组件的 cache key 体系（追加 `:${paneId}`）
- SplitLayout 作为通用组件，未来可复用于其他 split 场景
- 后续可渐进添加快捷键、布局持久化、Worktree split

## Technical Approach

### 数据模型：二叉树

```typescript
type PaneId = string;

type PaneNode =
  | { type: 'leaf'; paneId: PaneId }
  | {
      type: 'split';
      direction: 'horizontal' | 'vertical';
      ratio: number; // 0.0 ~ 1.0, first child 占比
      first: PaneNode;
      second: PaneNode;
    };

interface SplitState {
  root: PaneNode;
  activePaneId: PaneId;
  paneCount: number;
}
```

### Layout 标识（terminal-type agnostic）

| 终端类型 | Layout ID | Cache Key (per pane) |
|---------|-----------|---------------------|
| Local | `${projectId}:${tabId}` | `${projectId}:${tabId}:${paneId}` |
| WSL | `wsl:${distro}:${projectId}` | `wsl:${distro}:${projectId}:${paneId}` |
| Remote | `remote:${entryId}:${projectId}` | `remote:${entryId}:${projectId}:${paneId}` |

### 组件架构

```
SplitLayout (通用递归组件，终端类型无关)
├── Props: layoutId, renderPane, maxPanes, onActivePaneChange
├── 管理: PaneNode 树状态, resize handle, focus tracking
└── 渲染:
    ├── split 节点 → flex container + drag handle + 递归子节点
    └── leaf 节点 → renderPane(paneId) + PaneToolbar overlay

MainContent
├── Local 项目 → <SplitLayout renderPane={paneId => <TerminalView paneId={paneId} .../>} />
├── WSL 项目 → <SplitLayout renderPane={paneId => <WSLTerminalView paneId={paneId} .../>} />
└── Remote 项目 → <SplitLayout renderPane={paneId => <RemoteTerminalView paneId={paneId} .../>} />
```

### Hook: useSplitLayout

```typescript
// useSplitLayout(layoutId: string, maxPanes?: number)
// 返回:
//   state: SplitState
//   splitPane(paneId, direction): void   — 将 leaf 分裂为 split
//   closePane(paneId): void              — 移除 leaf，父节点提升另一子节点
//   setRatio(splitPath, ratio): void     — 拖拽时更新比例
//   setActivePaneId(paneId): void        — 切换 focus
//   canSplit: boolean                    — paneCount < maxPanes
//   resetLayout(): void                  — 重置为单 pane（Tab 切换时）
```

### PaneToolbar（overlay 按钮）

- 定位：focused pane 右上角，`position: absolute`，`z-20`
- 按钮：split-horizontal | split-vertical | close（仅 paneCount > 1 时显示 close）
- 每个按钮必须有 `aria-label`（如 `aria-label="Split Horizontal"`）
- 显示策略：pane focused 时始终显示，失去 focus 后 300ms fade-out（`transition-opacity duration-300`）
- 样式：半透明背景（`bg-bg-secondary/80 backdrop-blur-sm`），圆角，与终端主题一致
- canSplit=false 时 split 按钮 `opacity-50 cursor-not-allowed`，`title="Maximum panes reached"`

### Resize 策略

- 复用项目已有 mousedown/mousemove/mouseup 模式（sidebar-context 风格）
- Drag handle：可见区域 4px，hit area 扩展到 12px（透明 padding）
- Drag handle cursor：横向 `cursor: col-resize`，纵向 `cursor: row-resize`
- Drag handle 反馈：hover 时 `bg-accent-blue/50`，拖拽中保持高亮
- 拖拽中：`body.style.userSelect = 'none'`，拖拽结束恢复
- 拖拽中仅更新 CSS flex ratio（纯前端 reflow）
- Ratio 限制：`0.2 ~ 0.8`，防止 pane 被压缩到无法使用
- 拖拽结束时触发所有受影响 pane 的 PTY resize
### Focus Pane 交互

- 点击 pane 内容区设置为 active pane
- Active pane：`ring-2 ring-accent-blue/50 border-2 border-accent-blue`
- 非 active pane：`border-2 border-transparent`
- 键盘输入路由到 active pane 对应的 PTY session（xterm 天然支持，focus 到对应 term 即可）

### Pane 尺寸保护

- 单个 pane 最小尺寸：`min-width: 120px`、`min-height: 80px`
- Split 前检查：如果当前 pane 尺寸不足以容纳两个最小 pane，阻止 split 并提示

### Loading 状态

- 新 pane 创建时（PTY session 建立中）显示居中 "Connecting..." 文字
- PTY ready 后切换到终端视图
- 避免 skeleton 或复杂动画，保持终端风格简洁

### 树操作示例

**Split:**
```
Before: { type: 'leaf', paneId: 'p1' }

splitPane('p1', 'horizontal')

After: {
  type: 'split', direction: 'horizontal', ratio: 0.5,
  first: { type: 'leaf', paneId: 'p1' },
  second: { type: 'leaf', paneId: 'p2' }  // new pane, new PTY
}
```

**Close:**
```
Before: {
  type: 'split', direction: 'horizontal', ratio: 0.5,
  first: { type: 'leaf', paneId: 'p1' },
  second: { type: 'leaf', paneId: 'p2' }
}

closePane('p2')

After: { type: 'leaf', paneId: 'p1' }  // 父 split 提升剩余子节点
```

## Implementation Plan

### PR1: Split 核心基础设施
- `PaneNode` / `SplitState` 类型定义（types.ts）
- `useSplitLayout` hook（树操作 + 状态管理）
- `SplitLayout` 递归渲染组件（含 drag handle）
- `PaneToolbar` 组件（overlay split/close 按钮）
- 单元测试：树操作纯函数（split/close/setRatio/countPanes）

### PR2: Local 终端 Split 集成
- TerminalView 接受 `paneId` 参数
- 扩展 cache key 为 `${projectId}:${tabId}:${paneId}`
- MainContent Local 区域集成 SplitLayout
- Tab 关闭时清理所有 pane 的 cache
- 集成测试

### PR3: WSL / Remote 终端 Split 集成
- WSLTerminalView 接受 `paneId` 参数，扩展 cache key
- RemoteTerminalView 接受 `paneId` 参数，扩展 cache key
- MainContent WSL/Remote 区域集成 SplitLayout
- 移除 `sideMode` 相关 props 和逻辑

### PR4: 清理 & 收尾
- 移除 SideTerminal 相关测试桩（useKeyboardShortcuts.test.ts）
- 移除 `side_terminal_width` 字段（types.ts / SessionStore）
- 全面测试

## Technical Notes

### 受影响文件清单

**新增：**
- `src/hooks/useSplitLayout.ts` — split 树状态管理 hook
- `src/components/terminal/SplitLayout.tsx` — 递归渲染组件
- `src/components/terminal/PaneToolbar.tsx` — overlay 按钮组件
- `src/hooks/__tests__/useSplitLayout.test.ts` — 树操作单元测试

**修改：**
- `src/types.ts` — 添加 PaneNode / SplitState 类型
- `src/components/terminal/TerminalView.tsx` — 接受 paneId, 扩展 cache key
- `src/components/terminal/WSLTerminalView.tsx` — 接受 paneId, 扩展 cache key, 移除 sideMode
- `src/components/terminal/RemoteTerminalView.tsx` — 接受 paneId, 扩展 cache key, 移除 sideMode
- `src/components/MainContent.tsx` — 集成 SplitLayout 替代直接渲染终端组件
- `src/hooks/useTerminalTabs.ts` — Tab 关闭时清理该 Tab 下所有 pane cache

**移除/重写：**
- `src/hooks/__tests__/useKeyboardShortcuts.test.ts` — 移除 SideTerminal 相关跳过测试
- `src/types.ts` SessionStore 中 `side_terminal_width` 字段
